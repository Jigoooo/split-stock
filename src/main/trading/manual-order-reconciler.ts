import type { DailyExecution, TradeExecutionEvent } from '@shared/contracts';
import { eq, inArray } from 'drizzle-orm';
import { realTimer, type Timer } from '../brokers/core/types';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { Db } from '../db/client';
import { lots, orders, trades } from '../db/schema';
import type { EventLogger } from '../logging/event-logger';
import { reconcileCancelledSellLot } from './partial-sell-lot-reconciliation';

type OrderStatus = 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'REJECTED';
type OrderDivision = 'LIMIT' | 'MARKET';

interface PendingOrderRow {
  id: number;
  accountId: number;
  lotId: number | null;
  odno: string;
  pdno: string;
  side: string;
  division: string;
  qty: number;
  price: number;
  status: string;
  placedAt: Date | number | string;
  filledAt: Date | number | string | null;
}

export interface ManualOrderReconcilerTarget {
  accountId?: number;
  brokerOrderId?: string;
  symbol?: string;
}

export interface ManualOrderReconcilerOptions {
  db: Db;
  /**
   * 계좌별 BrokerPort 를 lazy 로 얻는 getter. 미준비(null) 면 해당 계좌 행은 skip.
   *
   * Stage 4 변경: KIS 직접 의존(httpByEnv/auth/credentialsRepo + inquireDailyCcld)
   * 제거 → BrokerPort.listDailyExecutions 추상. Kiwoom 활성 시에도 동일 reconciler
   * 로직 재사용 (KIS ka10076 / Kiwoom 체결조회 매핑은 mapper 책임).
   */
  getBrokerForAccount: (accountId: number) => BrokerPort | null;
  logger: EventLogger;
  onTradeExecution: (event: TradeExecutionEvent) => void;
  timer?: Timer;
  pollMs?: number;
  stalePendingGraceMs?: number;
}

export interface ReconcileDecision {
  nextStatus: OrderStatus;
  totalFilledQty: number;
  deltaFilledQty: number;
  remainingQty: number;
  executionPrice: number;
}

interface PendingSnapshotContext {
  serverPendingPresent: boolean;
  now: Date;
  placedAt: Date;
  graceMs: number;
}

export function resolveManualOrderDecision(input: {
  localStatus: 'PENDING' | 'PARTIAL';
  orderQty: number;
  localFilledQty: number;
  localPrice: number;
  division?: OrderDivision;
  remote: DailyExecution;
}): ReconcileDecision | null {
  const totalFilledQty = Math.min(input.orderQty, Math.max(0, input.remote.totalFilledQty));
  const deltaFilledQty = Math.max(0, totalFilledQty - input.localFilledQty);
  const remainingQty =
    input.remote.remainingQty > 0
      ? input.remote.remainingQty
      : Math.max(0, input.orderQty - totalFilledQty);
  const division = input.division ?? 'LIMIT';
  const executionPrice = resolveExecutionPrice({
    division,
    localPrice: input.localPrice,
    remoteOrderPrice: input.remote.orderPrice,
    remoteAvgFillPrice: input.remote.avgFillPrice,
    totalFilledQty,
  });
  if (executionPrice === null) return null;

  if (totalFilledQty > 0) {
    const nextStatus: OrderStatus = input.remote.cancelled
      ? remainingQty > 0
        ? 'CANCELLED'
        : 'FILLED'
      : remainingQty > 0
        ? 'PARTIAL'
        : 'FILLED';
    if (deltaFilledQty === 0 && nextStatus === input.localStatus) return null;
    return { nextStatus, totalFilledQty, deltaFilledQty, remainingQty, executionPrice };
  }

  if (input.remote.rejectedQty > 0) {
    return {
      nextStatus: 'REJECTED',
      totalFilledQty: 0,
      deltaFilledQty: 0,
      remainingQty: input.orderQty,
      executionPrice,
    };
  }

  if (input.remote.cancelled) {
    return {
      nextStatus: 'CANCELLED',
      totalFilledQty: 0,
      deltaFilledQty: 0,
      remainingQty,
      executionPrice,
    };
  }

  return null;
}

export function resolveServerPendingAbsenceDecision(input: {
  localFilledQty: number;
  orderQty: number;
  localPrice: number;
  localExecutionPrice?: number;
  division?: OrderDivision;
  context: PendingSnapshotContext;
}): ReconcileDecision | null {
  if (input.context.serverPendingPresent) return null;
  if (input.context.now.getTime() - input.context.placedAt.getTime() < input.context.graceMs) {
    return null;
  }

  const division = input.division ?? 'LIMIT';
  const executionPrice =
    input.localFilledQty > 0
      ? division === 'MARKET'
        ? input.localExecutionPrice && input.localExecutionPrice > 0
          ? input.localExecutionPrice
          : null
        : input.localExecutionPrice && input.localExecutionPrice > 0
          ? input.localExecutionPrice
          : input.localPrice
      : division === 'MARKET'
        ? 0
        : input.localPrice;
  if (executionPrice === null) return null;

  return {
    nextStatus: input.localFilledQty >= input.orderQty ? 'FILLED' : 'CANCELLED',
    totalFilledQty: input.localFilledQty,
    deltaFilledQty: 0,
    remainingQty: Math.max(0, input.orderQty - input.localFilledQty),
    executionPrice,
  };
}

export class ManualOrderReconciler {
  private readonly timer: Timer;
  private readonly pollMs: number;
  private readonly stalePendingGraceMs: number;
  private handle: { clear: () => void } | null = null;
  private running = false;
  private disposed = false;

  constructor(private readonly opts: ManualOrderReconcilerOptions) {
    this.timer = opts.timer ?? realTimer;
    this.pollMs = opts.pollMs ?? 3000;
    this.stalePendingGraceMs = opts.stalePendingGraceMs ?? 10_000;
  }

  start(): void {
    if (this.disposed || this.handle !== null) return;
    this.handle = this.timer.setInterval(() => {
      void this.poll();
    }, this.pollMs);
  }

  stop(): void {
    if (!this.handle) return;
    this.handle.clear();
    this.handle = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  async poll(target?: ManualOrderReconcilerTarget): Promise<void> {
    if (this.disposed || this.running) return;
    this.running = true;
    try {
      let pending = this.opts.db
        .select()
        .from(orders)
        .where(inArray(orders.status, ['PENDING', 'PARTIAL']))
        .all() as PendingOrderRow[];
      if (target?.accountId !== undefined) {
        pending = pending.filter((row) => row.accountId === target.accountId);
      }
      if (target?.brokerOrderId !== undefined) {
        pending = pending.filter((row) => row.odno === target.brokerOrderId);
      }
      if (target?.symbol !== undefined) {
        pending = pending.filter((row) => row.pdno === target.symbol);
      }
      if (pending.length === 0) return;
      const pendingRowsByAccount = new Map<number, PendingOrderRow[]>();
      for (const row of pending) {
        const accountRows = pendingRowsByAccount.get(row.accountId) ?? [];
        accountRows.push(row);
        pendingRowsByAccount.set(row.accountId, accountRows);
      }

      const brokerCache = new Map<number, BrokerPort | null>();
      const serverPendingByAccount = new Map<number, Set<string> | null>();
      const now = new Date();

      for (const row of pending) {
        let broker = brokerCache.get(row.accountId);
        if (broker === undefined) {
          broker = this.opts.getBrokerForAccount(row.accountId);
          brokerCache.set(row.accountId, broker);
          if (!broker) {
            this.opts.logger.log({
              level: 'WARN',
              category: 'ORDER',
              message: 'manual-order-reconciler.broker_missing',
              payload: { accountId: row.accountId, odno: row.odno },
            });
          }
        }
        if (!broker) continue;

        let serverPendingSet = serverPendingByAccount.get(row.accountId);
        if (serverPendingSet === undefined) {
          const accountRows = pendingRowsByAccount.get(row.accountId) ?? [];
          const oldestPlacedAt = accountRows.reduce((min, item) => {
            const placedAt = toDate(item.placedAt);
            return placedAt.getTime() < min.getTime() ? placedAt : min;
          }, toDate(row.placedAt));
          const pendingSnapshot = await broker.listDailyExecutions({
            from: oldestPlacedAt,
            to: now,
            side: 'ALL',
            filledOnly: false,
          });
          if (pendingSnapshot.isErr()) {
            this.opts.logger.log({
              level: 'WARN',
              category: 'ORDER',
              message: 'manual-order-reconciler.pending_snapshot_failed',
              payload: {
                accountId: row.accountId,
                brokerId: broker.brokerId,
                kind: pendingSnapshot.error.kind,
                msg: pendingSnapshot.error.msg,
              },
            });
            serverPendingSet = null;
          } else {
            // 미체결만 추출 (remainingQty > 0 && !cancelled). KIS 의 ccldDvsn='02' 와 동등.
            serverPendingSet = new Set(
              pendingSnapshot.value
                .filter((entry) => entry.remainingQty > 0 && !entry.cancelled)
                .map((entry) => entry.brokerOrderId),
            );
          }
          serverPendingByAccount.set(row.accountId, serverPendingSet);
        }

        const placedAt = toDate(row.placedAt);
        const remoteResult = await broker.listDailyExecutions({
          from: placedAt,
          to: now,
          brokerOrderId: row.odno,
          side: row.side === 'SELL' ? 'SELL' : 'BUY',
        });
        if (remoteResult.isErr()) {
          this.opts.logger.log({
            level: 'WARN',
            category: 'ORDER',
            message: 'manual-order-reconciler.fetch_failed',
            payload: {
              accountId: row.accountId,
              odno: row.odno,
              brokerId: broker.brokerId,
              kind: remoteResult.error.kind,
              msg: remoteResult.error.msg,
            },
          });
          continue;
        }

        const remote = remoteResult.value.find((entry) => entry.brokerOrderId === row.odno);
        const localTrades = this.opts.db
          .select()
          .from(trades)
          .where(eq(trades.orderId, row.id))
          .all();
        const localFilledQty = localTrades.reduce((sum, trade) => sum + trade.qty, 0);
        const localExecutionPrice = weightedAvgTradePrice(localTrades);
        const absenceDecision = resolveServerPendingAbsenceDecision({
          localFilledQty,
          orderQty: row.qty,
          localPrice: row.price,
          localExecutionPrice,
          division: row.division === 'MARKET' ? 'MARKET' : 'LIMIT',
          context: {
            serverPendingPresent: serverPendingSet?.has(row.odno) ?? true,
            now,
            placedAt,
            graceMs: this.stalePendingGraceMs,
          },
        });
        const decision = remote
          ? resolveMarketFillWithoutPrice({
              division: row.division,
              localFilledQty,
              remote,
            })
            ? null
            : (resolveManualOrderDecision({
                localStatus: row.status === 'PARTIAL' ? 'PARTIAL' : 'PENDING',
                orderQty: row.qty,
                localFilledQty,
                localPrice: row.price,
                division: row.division === 'MARKET' ? 'MARKET' : 'LIMIT',
                remote,
              }) ?? absenceDecision)
          : absenceDecision;
        if (!decision) continue;

        if (decision.deltaFilledQty > 0) {
          if (!remote) continue;
          this.opts.db
            .insert(trades)
            .values({
              orderId: row.id,
              qty: decision.deltaFilledQty,
              price: decision.executionPrice,
              executedAt: now,
            })
            .run();

          this.opts.onTradeExecution({
            accountId: row.accountId,
            odno: row.odno,
            pdno: remote.symbol,
            name: remote.name,
            side: remote.side,
            status: decision.nextStatus === 'FILLED' ? 'FILLED' : 'PARTIAL',
            filledQty: decision.deltaFilledQty,
            totalFilledQty: decision.totalFilledQty,
            remainingQty: decision.remainingQty,
            lotId: row.lotId,
            nth: row.lotId !== null ? readLotNth(this.opts.db, row.lotId) : null,
            price: decision.executionPrice,
            occurredAt: now.getTime(),
          });
        }

        if (row.lotId !== null) {
          reconcileLinkedLot(this.opts.db, {
            decision,
            lotId: row.lotId,
            side: row.side === 'SELL' ? 'SELL' : 'BUY',
            now,
          });
        }

        this.opts.db
          .update(orders)
          .set({
            status: decision.nextStatus,
            filledAt:
              decision.nextStatus === 'FILLED' || decision.nextStatus === 'PARTIAL'
                ? now
                : row.filledAt
                  ? toDate(row.filledAt)
                  : null,
          })
          .where(eq(orders.id, row.id))
          .run();

        this.opts.logger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'manual-order-reconciler.updated',
          payload: {
            accountId: row.accountId,
            odno: row.odno,
            nextStatus: decision.nextStatus,
            serverPendingPresent: serverPendingSet?.has(row.odno) ?? null,
            deltaFilledQty: decision.deltaFilledQty,
            totalFilledQty: decision.totalFilledQty,
            remainingQty: decision.remainingQty,
          },
        });
      }
    } finally {
      this.running = false;
    }
  }
}

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function resolveExecutionPrice(input: {
  division: OrderDivision;
  localPrice: number;
  remoteOrderPrice: number;
  remoteAvgFillPrice: number;
  totalFilledQty: number;
}): number | null {
  if (input.remoteAvgFillPrice > 0) return input.remoteAvgFillPrice;
  if (input.division === 'MARKET') {
    return input.totalFilledQty > 0 ? null : 0;
  }
  if (input.remoteOrderPrice > 0) return input.remoteOrderPrice;
  return input.localPrice;
}

function resolveMarketFillWithoutPrice(input: {
  division: string;
  localFilledQty: number;
  remote: DailyExecution;
}): boolean {
  return (
    input.division === 'MARKET' &&
    input.remote.totalFilledQty > input.localFilledQty &&
    input.remote.avgFillPrice <= 0
  );
}

function weightedAvgTradePrice(rows: Array<{ qty: number; price: number }>): number {
  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
  if (totalQty <= 0) return 0;
  const totalAmount = rows.reduce((sum, row) => sum + row.qty * row.price, 0);
  return Math.round(totalAmount / totalQty);
}

function readLotNth(db: Db, lotId: number): number | null {
  const row = db.select({ nth: lots.nth }).from(lots).where(eq(lots.id, lotId)).get();
  return row?.nth ?? null;
}

function reconcileLinkedLot(
  db: Db,
  input: {
    decision: ReconcileDecision;
    lotId: number;
    now: Date;
    side: 'BUY' | 'SELL';
  },
): void {
  if (input.side === 'BUY') {
    if (input.decision.nextStatus === 'CANCELLED' && input.decision.totalFilledQty === 0) {
      db.delete(lots).where(eq(lots.id, input.lotId)).run();
      return;
    }

    db.update(lots)
      .set({
        buyPrice: input.decision.executionPrice,
        qty: input.decision.totalFilledQty,
        amountKrw: input.decision.executionPrice * input.decision.totalFilledQty,
        status: input.decision.nextStatus === 'PARTIAL' ? 'BUYING' : 'OPEN',
      })
      .where(eq(lots.id, input.lotId))
      .run();
    return;
  }

  if (input.decision.nextStatus === 'FILLED') {
    db.update(lots)
      .set({
        status: 'SOLD',
        soldAt: input.now,
        sellPrice: input.decision.executionPrice,
      })
      .where(eq(lots.id, input.lotId))
      .run();
    return;
  }

  if (input.decision.nextStatus === 'CANCELLED') {
    reconcileCancelledSellLot(db, {
      lotId: input.lotId,
      filledQty: input.decision.totalFilledQty,
      executionPrice: input.decision.executionPrice,
      now: input.now,
    });
  }
}
