import type { TradeExecutionEvent } from '@shared/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { realTimer, type Timer } from '../brokers/core/types';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { Db } from '../db/client';
import { orders, trades } from '../db/schema';
import type { EventLogger } from '../logging/event-logger';
import {
  readLotNth,
  reconcileLinkedLot,
  toDate,
  weightedAvgTradePrice,
} from './manual-order-lot-reconciliation';
import {
  resolveManualOrderDecision,
  resolveMarketFillWithoutPrice,
  resolveServerPendingAbsenceDecision,
} from './manual-order-reconciliation-policy';

const STOCK_BROKER = 'KIS';

export type { ReconcileDecision } from './manual-order-reconciliation-policy';
export {
  resolveManualOrderDecision,
  resolveServerPendingAbsenceDecision,
} from './manual-order-reconciliation-policy';

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
        .where(and(eq(orders.broker, STOCK_BROKER), inArray(orders.status, ['PENDING', 'PARTIAL'])))
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
          .where(and(eq(trades.orderId, row.id), eq(trades.broker, STOCK_BROKER)))
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
              broker: STOCK_BROKER,
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
          .where(and(eq(orders.id, row.id), eq(orders.broker, STOCK_BROKER)))
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
