import type { TradeExecutionEvent } from '@shared/contracts';
import { BROKERS } from '@shared/contracts';
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

export type { ReconcileDecision } from './manual-order-reconciliation-policy';
export {
  resolveManualOrderDecision,
  resolveServerPendingAbsenceDecision,
} from './manual-order-reconciliation-policy';

interface PendingOrderRow {
  id: number;
  broker: string;
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
  /**
   * M2 self-healing: brokerForAccount 가 지속 null 일 때 PENDING row 가 영구 잔존하지
   * 않도록 placedAt 기준 grace 후 status='CANCELLED' 로 마킹. 기본 24h.
   *
   * 자격증명 미등록/만료/계좌 삭제 등으로 broker 가 사라진 row 가 매 cycle 마다 동일 WARN
   * 을 무한 반복하는 것을 막는다. 마킹 시 lot cleanup 은 수행 X — admin/사용자가 lot 상태
   * 점검 후 수동 정리.
   */
  staleBrokerMissingMs?: number;
}

export class ManualOrderReconciler {
  private readonly timer: Timer;
  private readonly pollMs: number;
  private readonly stalePendingGraceMs: number;
  private readonly staleBrokerMissingMs: number;
  private handle: { clear: () => void } | null = null;
  private running = false;
  private disposed = false;

  constructor(private readonly opts: ManualOrderReconcilerOptions) {
    this.timer = opts.timer ?? realTimer;
    this.pollMs = opts.pollMs ?? 3000;
    this.stalePendingGraceMs = opts.stalePendingGraceMs ?? 10_000;
    this.staleBrokerMissingMs = opts.staleBrokerMissingMs ?? 24 * 60 * 60 * 1000;
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
      // Phase 6 + M1: 도메스틱(KIS+KIWOOM) 만 명시 화이트리스트 + 행 단위 broker dispatch.
      // orders 테이블은 도메스틱 전용이지만, 미래에 외환/해외주식 broker 추가 시 무차별
      // 폴링 방지를 위해 명시 inArray 유지.
      let pending = this.opts.db
        .select()
        .from(orders)
        .where(
          and(
            inArray(orders.broker, [BROKERS.KIS, BROKERS.KIWOOM]),
            inArray(orders.status, ['PENDING', 'PARTIAL']),
          ),
        )
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
        if (!broker) {
          // M2 self-healing: placedAt 이후 staleBrokerMissingMs 경과한 PENDING row 를
          // CANCELLED 로 마킹해 영구 WARN 루프 차단. lot cleanup 은 수행 X (수동 정리 영역).
          const placedAt = toDate(row.placedAt);
          const ageMs = now.getTime() - placedAt.getTime();
          if (ageMs >= this.staleBrokerMissingMs) {
            this.opts.db
              .update(orders)
              .set({ status: 'CANCELLED' })
              .where(and(eq(orders.id, row.id), eq(orders.broker, row.broker)))
              .run();
            this.opts.logger.log({
              level: 'ERROR',
              category: 'ORDER',
              message: 'manual-order-reconciler.broker_missing.stale-cancelled',
              payload: {
                accountId: row.accountId,
                odno: row.odno,
                broker: row.broker,
                lotId: row.lotId,
                ageMs,
                placedAt: placedAt.toISOString(),
              },
            });
          }
          continue;
        }

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
          .where(and(eq(trades.orderId, row.id), eq(trades.broker, row.broker)))
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
              broker: row.broker,
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
          .where(and(eq(orders.id, row.id), eq(orders.broker, row.broker)))
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
