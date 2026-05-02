import type {
  CryptoAutoConfig,
  CryptoAutoEvent,
  CryptoAutoGuardConfig,
  CryptoAutoIntent,
  CryptoAutoMode,
  CryptoKrwMarketCode,
  CryptoLot,
  CryptoAutoEvent as SharedCryptoAutoEvent,
} from '@shared/contracts';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cryptoAutoConfigs, cryptoAutoEvents, cryptoAutoLots } from '../db/schema';

export const DEFAULT_CRYPTO_AUTO_CONFIG: CryptoAutoGuardConfig = {
  exchange: 'UPBIT',
  accountEnv: 'PROD',
  mode: 'disabled',
  emergencyDisabled: true,
  baseOrderKrw: '5000',
  maxOrderKrw: '5000',
  maxTotalExposureKrw: '50000',
  minOrderTotalKrw: '5000',
  addTriggerPct: '0.03',
  takeProfitPct: '0.02',
  maxOpenLots: 3,
  cooldownMs: 60_000,
  staleCancelCap: 3,
  requireReadOnlySmoke: true,
  requireDryRunHistoryBeforeLive: true,
};

type PersistEventInput = {
  accountId: number;
  market: CryptoKrwMarketCode;
  mode: CryptoAutoMode;
  kind: SharedCryptoAutoEvent['kind'];
  action: SharedCryptoAutoEvent['action'];
  reason: string;
  intent?: CryptoAutoIntent | null;
  result?: unknown;
  idempotencyKey?: string | null;
  createdAt?: number;
};

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapConfigRow(
  accountId: number,
  market: CryptoKrwMarketCode,
  row: typeof cryptoAutoConfigs.$inferSelect | undefined,
): CryptoAutoConfig {
  if (!row) {
    return {
      ...DEFAULT_CRYPTO_AUTO_CONFIG,
      accountId,
      market,
      lastDryRunAt: null,
      lastReadonlySmokeAt: null,
      lastLiveActionAt: null,
      updatedAt: 0,
    };
  }
  return {
    accountId: row.accountId,
    market: row.market as CryptoKrwMarketCode,
    exchange: 'UPBIT',
    accountEnv: 'PROD',
    mode: row.mode as CryptoAutoMode,
    emergencyDisabled: row.emergencyDisabled,
    baseOrderKrw: row.baseOrderKrw,
    maxOrderKrw: row.maxOrderKrw,
    maxTotalExposureKrw: row.maxTotalExposureKrw,
    minOrderTotalKrw: row.minOrderTotalKrw,
    addTriggerPct: row.addTriggerPct,
    takeProfitPct: row.takeProfitPct,
    maxOpenLots: row.maxOpenLots,
    cooldownMs: row.cooldownMs,
    staleCancelCap: row.staleCancelCap,
    requireReadOnlySmoke: row.requireReadOnlySmoke,
    requireDryRunHistoryBeforeLive: row.requireDryRunHistoryBeforeLive,
    lastDryRunAt: row.lastDryRunAt?.getTime() ?? null,
    lastReadonlySmokeAt: row.lastReadonlySmokeAt?.getTime() ?? null,
    lastLiveActionAt: row.lastLiveActionAt?.getTime() ?? null,
    updatedAt: row.updatedAt.getTime(),
  };
}

function mapLot(row: typeof cryptoAutoLots.$inferSelect): CryptoLot {
  return {
    id: row.id,
    accountId: row.accountId,
    exchange: 'UPBIT',
    market: row.market as CryptoKrwMarketCode,
    sequence: row.sequence,
    quantity: row.quantity,
    avgEntryKrw: row.avgEntryKrw,
    allocatedKrw: row.allocatedKrw,
    realizedPnl: row.realizedPnl,
    feesPaid: row.feesPaid,
    status: row.status as CryptoLot['status'],
    openedAt: row.openedAt.getTime(),
    closedAt: row.closedAt?.getTime() ?? null,
    updatedAt: row.updatedAt.getTime(),
  };
}

function mapEvent(row: typeof cryptoAutoEvents.$inferSelect): CryptoAutoEvent {
  return {
    id: row.id,
    accountId: row.accountId,
    exchange: 'UPBIT',
    market: row.market as CryptoKrwMarketCode,
    mode: row.mode as CryptoAutoMode,
    kind: row.kind as CryptoAutoEvent['kind'],
    action: row.action as CryptoAutoEvent['action'],
    reason: row.reason,
    intent: parseJson(row.intentJson) as CryptoAutoIntent | null,
    result: parseJson(row.resultJson),
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.getTime(),
  };
}

export class CryptoAutoTradingRepo {
  constructor(private readonly db: Db) {}

  getConfig(accountId: number, market: CryptoKrwMarketCode): CryptoAutoConfig {
    const row = this.db
      .select()
      .from(cryptoAutoConfigs)
      .where(
        and(
          eq(cryptoAutoConfigs.accountId, accountId),
          eq(cryptoAutoConfigs.exchange, 'UPBIT'),
          eq(cryptoAutoConfigs.market, market),
        ),
      )
      .get();
    return mapConfigRow(accountId, market, row);
  }

  upsertConfig(
    accountId: number,
    market: CryptoKrwMarketCode,
    config: Partial<CryptoAutoGuardConfig>,
  ): CryptoAutoConfig {
    const previous = this.getConfig(accountId, market);
    const next = { ...previous, ...config, accountId, market };
    const now = new Date();
    this.db
      .insert(cryptoAutoConfigs)
      .values({
        accountId,
        exchange: 'UPBIT',
        market,
        mode: next.mode,
        emergencyDisabled: next.emergencyDisabled,
        baseOrderKrw: next.baseOrderKrw,
        maxOrderKrw: next.maxOrderKrw,
        maxTotalExposureKrw: next.maxTotalExposureKrw,
        minOrderTotalKrw: next.minOrderTotalKrw,
        addTriggerPct: next.addTriggerPct,
        takeProfitPct: next.takeProfitPct,
        maxOpenLots: next.maxOpenLots,
        cooldownMs: next.cooldownMs,
        staleCancelCap: next.staleCancelCap,
        requireReadOnlySmoke: next.requireReadOnlySmoke,
        requireDryRunHistoryBeforeLive: next.requireDryRunHistoryBeforeLive,
        lastDryRunAt: next.lastDryRunAt === null ? null : new Date(next.lastDryRunAt),
        lastReadonlySmokeAt:
          next.lastReadonlySmokeAt === null ? null : new Date(next.lastReadonlySmokeAt),
        lastLiveActionAt: next.lastLiveActionAt === null ? null : new Date(next.lastLiveActionAt),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cryptoAutoConfigs.accountId, cryptoAutoConfigs.exchange, cryptoAutoConfigs.market],
        set: {
          mode: next.mode,
          emergencyDisabled: next.emergencyDisabled,
          baseOrderKrw: next.baseOrderKrw,
          maxOrderKrw: next.maxOrderKrw,
          maxTotalExposureKrw: next.maxTotalExposureKrw,
          minOrderTotalKrw: next.minOrderTotalKrw,
          addTriggerPct: next.addTriggerPct,
          takeProfitPct: next.takeProfitPct,
          maxOpenLots: next.maxOpenLots,
          cooldownMs: next.cooldownMs,
          staleCancelCap: next.staleCancelCap,
          requireReadOnlySmoke: next.requireReadOnlySmoke,
          requireDryRunHistoryBeforeLive: next.requireDryRunHistoryBeforeLive,
          updatedAt: now,
        },
      })
      .run();
    return this.getConfig(accountId, market);
  }

  markReadonlySmokeSucceeded(
    accountId: number,
    market: CryptoKrwMarketCode,
    at = Date.now(),
  ): void {
    const config = this.getConfig(accountId, market);
    this.upsertConfig(accountId, market, config);
    this.db
      .update(cryptoAutoConfigs)
      .set({ lastReadonlySmokeAt: new Date(at), updatedAt: new Date(at) })
      .where(
        and(
          eq(cryptoAutoConfigs.accountId, accountId),
          eq(cryptoAutoConfigs.exchange, 'UPBIT'),
          eq(cryptoAutoConfigs.market, market),
        ),
      )
      .run();
  }

  markDryRun(accountId: number, market: CryptoKrwMarketCode, at = Date.now()): void {
    this.db
      .update(cryptoAutoConfigs)
      .set({ lastDryRunAt: new Date(at), updatedAt: new Date(at) })
      .where(
        and(
          eq(cryptoAutoConfigs.accountId, accountId),
          eq(cryptoAutoConfigs.exchange, 'UPBIT'),
          eq(cryptoAutoConfigs.market, market),
        ),
      )
      .run();
  }

  markLiveAction(accountId: number, market: CryptoKrwMarketCode, at = Date.now()): void {
    this.db
      .update(cryptoAutoConfigs)
      .set({ lastLiveActionAt: new Date(at), updatedAt: new Date(at) })
      .where(
        and(
          eq(cryptoAutoConfigs.accountId, accountId),
          eq(cryptoAutoConfigs.exchange, 'UPBIT'),
          eq(cryptoAutoConfigs.market, market),
        ),
      )
      .run();
  }

  listOpenLots(accountId: number, market: CryptoKrwMarketCode): CryptoLot[] {
    return this.db
      .select()
      .from(cryptoAutoLots)
      .where(
        and(
          eq(cryptoAutoLots.accountId, accountId),
          eq(cryptoAutoLots.exchange, 'UPBIT'),
          eq(cryptoAutoLots.market, market),
          eq(cryptoAutoLots.status, 'open'),
        ),
      )
      .orderBy(cryptoAutoLots.sequence)
      .all()
      .map(mapLot);
  }

  createLot(input: {
    accountId: number;
    market: CryptoKrwMarketCode;
    quantity: string;
    avgEntryKrw: string;
    allocatedKrw: string;
    openedAt?: number;
  }): CryptoLot {
    const now = new Date(input.openedAt ?? Date.now());
    const sequence = this.nextLotSequence(input.accountId, input.market);
    const result = this.db
      .insert(cryptoAutoLots)
      .values({
        accountId: input.accountId,
        exchange: 'UPBIT',
        market: input.market,
        sequence,
        quantity: input.quantity,
        avgEntryKrw: input.avgEntryKrw,
        allocatedKrw: input.allocatedKrw,
        realizedPnl: '0',
        feesPaid: '0',
        status: 'open',
        openedAt: now,
        closedAt: null,
        updatedAt: now,
      })
      .run();
    const id = Number(result.lastInsertRowid);
    const row = this.db.select().from(cryptoAutoLots).where(eq(cryptoAutoLots.id, id)).get();
    if (!row) throw new Error('crypto auto lot insert failed');
    return mapLot(row);
  }

  closeLot(input: {
    lotId: number;
    realizedPnl: string;
    feesPaid?: string;
    closedAt?: number;
  }): void {
    const now = new Date(input.closedAt ?? Date.now());
    this.db
      .update(cryptoAutoLots)
      .set({
        status: 'closed',
        realizedPnl: input.realizedPnl,
        ...(input.feesPaid !== undefined ? { feesPaid: input.feesPaid } : {}),
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(cryptoAutoLots.id, input.lotId))
      .run();
  }

  insertEvent(input: PersistEventInput): CryptoAutoEvent {
    const createdAt = new Date(input.createdAt ?? Date.now());
    const result = this.db
      .insert(cryptoAutoEvents)
      .values({
        accountId: input.accountId,
        exchange: 'UPBIT',
        market: input.market,
        mode: input.mode,
        kind: input.kind,
        action: input.action,
        reason: input.reason,
        intentJson:
          input.intent === undefined || input.intent === null ? null : JSON.stringify(input.intent),
        resultJson: input.result === undefined ? null : JSON.stringify(input.result),
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt,
      })
      .run();
    const id = Number(result.lastInsertRowid);
    const row = this.db.select().from(cryptoAutoEvents).where(eq(cryptoAutoEvents.id, id)).get();
    if (!row) throw new Error('crypto auto event insert failed');
    return mapEvent(row);
  }

  listRecentEvents(accountId: number, market: CryptoKrwMarketCode, limit = 50): CryptoAutoEvent[] {
    return this.db
      .select()
      .from(cryptoAutoEvents)
      .where(
        and(
          eq(cryptoAutoEvents.accountId, accountId),
          eq(cryptoAutoEvents.exchange, 'UPBIT'),
          eq(cryptoAutoEvents.market, market),
        ),
      )
      .orderBy(desc(cryptoAutoEvents.createdAt))
      .limit(Math.max(1, Math.min(200, Math.trunc(limit))))
      .all()
      .map(mapEvent);
  }

  countEventsSince(input: {
    accountId: number;
    market: CryptoKrwMarketCode;
    kind: CryptoAutoEvent['kind'];
    sinceMs: number;
  }): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(cryptoAutoEvents)
      .where(
        and(
          eq(cryptoAutoEvents.accountId, input.accountId),
          eq(cryptoAutoEvents.exchange, 'UPBIT'),
          eq(cryptoAutoEvents.market, input.market),
          eq(cryptoAutoEvents.kind, input.kind),
          gte(cryptoAutoEvents.createdAt, new Date(input.sinceMs)),
        ),
      )
      .get();
    return Number(row?.count ?? 0);
  }

  hasDryRunHistory(accountId: number, market: CryptoKrwMarketCode): boolean {
    return (
      this.countEventsSince({
        accountId,
        market,
        kind: 'dry-run',
        sinceMs: 0,
      }) > 0
    );
  }

  private nextLotSequence(accountId: number, market: CryptoKrwMarketCode): number {
    const row = this.db
      .select({ maxSequence: sql<number>`coalesce(max(${cryptoAutoLots.sequence}), 0)` })
      .from(cryptoAutoLots)
      .where(
        and(
          eq(cryptoAutoLots.accountId, accountId),
          eq(cryptoAutoLots.exchange, 'UPBIT'),
          eq(cryptoAutoLots.market, market),
        ),
      )
      .get();
    return Number(row?.maxSequence ?? 0) + 1;
  }
}
