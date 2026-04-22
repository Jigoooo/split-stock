import type { AppEnv, TradeExecutionEvent } from '@shared/contracts';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { orders, trades } from '../db/schema';
import type { AuthService } from '../kis/auth';
import { type DailyCcldOrder, inquireDailyCcld } from '../kis/domestic-stock';
import type { KisHttpClient } from '../kis/http-client';
import { realTimer, type Timer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';
import type { CredentialsRepo } from '../security/credentials-repo';

type OrderStatus = 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'REJECTED';

interface PendingOrderRow {
  id: number;
  accountId: number;
  odno: string;
  pdno: string;
  side: string;
  qty: number;
  price: number;
  status: string;
  placedAt: Date | number | string;
  filledAt: Date | number | string | null;
}

export interface ManualOrderReconcilerOptions {
  db: Db;
  credentialsRepo: CredentialsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
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
  remote: DailyCcldOrder;
}): ReconcileDecision | null {
  const totalFilledQty = Math.min(input.orderQty, Math.max(0, input.remote.totalFilledQty));
  const deltaFilledQty = Math.max(0, totalFilledQty - input.localFilledQty);
  const remainingQty =
    input.remote.remainingQty > 0
      ? input.remote.remainingQty
      : Math.max(0, input.orderQty - totalFilledQty);
  const executionPrice =
    input.remote.avgFillPrice > 0
      ? input.remote.avgFillPrice
      : input.remote.orderPrice > 0
        ? input.remote.orderPrice
        : input.localPrice;

  if (totalFilledQty > 0) {
    const nextStatus: OrderStatus = remainingQty > 0 ? 'PARTIAL' : 'FILLED';
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
  context: PendingSnapshotContext;
}): ReconcileDecision | null {
  if (input.context.serverPendingPresent) return null;
  if (input.context.now.getTime() - input.context.placedAt.getTime() < input.context.graceMs) {
    return null;
  }

  return {
    nextStatus: input.localFilledQty >= input.orderQty ? 'FILLED' : 'CANCELLED',
    totalFilledQty: input.localFilledQty,
    deltaFilledQty: 0,
    remainingQty: Math.max(0, input.orderQty - input.localFilledQty),
    executionPrice: input.localPrice,
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

  async poll(): Promise<void> {
    if (this.disposed || this.running) return;
    this.running = true;
    try {
      const pending = this.opts.db
        .select()
        .from(orders)
        .where(inArray(orders.status, ['PENDING', 'PARTIAL']))
        .all() as PendingOrderRow[];
      if (pending.length === 0) return;
      const pendingRowsByAccount = new Map<number, PendingOrderRow[]>();
      for (const row of pending) {
        const accountRows = pendingRowsByAccount.get(row.accountId) ?? [];
        accountRows.push(row);
        pendingRowsByAccount.set(row.accountId, accountRows);
      }

      const credentialsCache = new Map<
        number,
        {
          env: AppEnv;
          appKey: string;
          appSecret: string;
          accountNo8: string;
          accountProdCd: string;
        }
      >();
      const serverPendingByAccount = new Map<number, Set<string> | null>();
      const tokenCache = new Map<
        number,
        {
          env: AppEnv;
          token: string;
          appKey: string;
          appSecret: string;
          accountNo8: string;
          accountProdCd: string;
        }
      >();
      const now = new Date();

      for (const row of pending) {
        const credentials =
          credentialsCache.get(row.accountId) ??
          (() => {
            const loaded = this.opts.credentialsRepo.loadCredentials(row.accountId);
            if (loaded.isErr() || !loaded.value) {
              this.opts.logger.log({
                level: 'WARN',
                category: 'ORDER',
                message: 'manual-order-reconciler.credentials_missing',
                payload: { accountId: row.accountId, odno: row.odno },
              });
              return null;
            }
            credentialsCache.set(row.accountId, loaded.value);
            return loaded.value;
          })();
        if (!credentials) continue;

        const authContext = {
          env: credentials.env,
          token: '',
          appKey: credentials.appKey,
          appSecret: credentials.appSecret,
          accountNo8: credentials.accountNo8,
          accountProdCd: credentials.accountProdCd,
        } as const;
        const cachedToken = tokenCache.get(row.accountId);
        let resolvedAuthContext = cachedToken;
        if (!resolvedAuthContext) {
          const tokenResult = await this.opts.auth.getValidToken(
            credentials.env,
            credentials.appKey,
            credentials.appSecret,
          );
          if (tokenResult.isErr()) {
            this.opts.logger.log({
              level: 'WARN',
              category: 'ORDER',
              message: 'manual-order-reconciler.token_error',
              payload: { accountId: row.accountId, odno: row.odno, kind: tokenResult.error.kind },
            });
            continue;
          }
          resolvedAuthContext = {
            ...authContext,
            token: tokenResult.value.token,
          };
          tokenCache.set(row.accountId, resolvedAuthContext);
        }

        let serverPendingSet = serverPendingByAccount.get(row.accountId);
        if (serverPendingSet === undefined) {
          const accountRows = pendingRowsByAccount.get(row.accountId) ?? [];
          const oldestPlacedAt = accountRows.reduce((min, item) => {
            const placedAt = toDate(item.placedAt);
            return placedAt.getTime() < min.getTime() ? placedAt : min;
          }, toDate(row.placedAt));
          const pendingSnapshot = await inquireDailyCcld(
            {
              http: this.opts.httpByEnv[credentials.env],
              ...resolvedAuthContext,
            },
            {
              from: oldestPlacedAt,
              to: now,
              side: 'ALL',
              ccldDvsn: '02',
            },
          );
          if (pendingSnapshot.isErr()) {
            this.opts.logger.log({
              level: 'WARN',
              category: 'ORDER',
              message: 'manual-order-reconciler.pending_snapshot_failed',
              payload: {
                accountId: row.accountId,
                kind: pendingSnapshot.error.kind,
                msg: pendingSnapshot.error.msg,
              },
            });
            serverPendingSet = null;
          } else {
            serverPendingSet = new Set(pendingSnapshot.value.map((entry) => entry.odno));
          }
          serverPendingByAccount.set(row.accountId, serverPendingSet);
        }

        const placedAt = toDate(row.placedAt);
        const remoteResult = await inquireDailyCcld(
          {
            http: this.opts.httpByEnv[credentials.env],
            ...resolvedAuthContext,
          },
          {
            from: placedAt,
            to: now,
            orderNo: row.odno,
            side: row.side === 'SELL' ? 'SELL' : 'BUY',
          },
        );
        if (remoteResult.isErr()) {
          this.opts.logger.log({
            level: 'WARN',
            category: 'ORDER',
            message: 'manual-order-reconciler.fetch_failed',
            payload: {
              accountId: row.accountId,
              odno: row.odno,
              kind: remoteResult.error.kind,
              msg: remoteResult.error.msg,
            },
          });
          continue;
        }

        const remote = remoteResult.value.find((entry) => entry.odno === row.odno);
        const localTrades = this.opts.db
          .select()
          .from(trades)
          .where(eq(trades.orderId, row.id))
          .all();
        const localFilledQty = localTrades.reduce((sum, trade) => sum + trade.qty, 0);
        const absenceDecision = resolveServerPendingAbsenceDecision({
          localFilledQty,
          orderQty: row.qty,
          localPrice: row.price,
          context: {
            serverPendingPresent: serverPendingSet?.has(row.odno) ?? true,
            now,
            placedAt,
            graceMs: this.stalePendingGraceMs,
          },
        });
        const decision = remote
          ? (resolveManualOrderDecision({
              localStatus: row.status === 'PARTIAL' ? 'PARTIAL' : 'PENDING',
              orderQty: row.qty,
              localFilledQty,
              localPrice: row.price,
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
            pdno: remote.pdno,
            name: remote.name,
            side: remote.side,
            status: decision.nextStatus === 'FILLED' ? 'FILLED' : 'PARTIAL',
            filledQty: decision.deltaFilledQty,
            totalFilledQty: decision.totalFilledQty,
            remainingQty: decision.remainingQty,
            price: decision.executionPrice,
            occurredAt: now.getTime(),
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
