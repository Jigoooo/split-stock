import type {
  CryptoAutoConfig,
  CryptoAutoEvent,
  CryptoAutoGuardConfig,
  CryptoAutoIntent,
  CryptoAutoLotSource,
  CryptoAutoMode,
  CryptoAutoTemplate,
  CryptoAutoTemplateUpsertInput,
  CryptoAutoTradeHistoryFilter,
  CryptoAutoTradeHistoryItem,
  CryptoAutoWatch,
  CryptoAutoWatchEntryCondition,
  CryptoAutoWatchListFilter,
  CryptoAutoWatchStatus,
  CryptoAutoWatchUpsertInput,
  CryptoKrwMarketCode,
  CryptoLot,
  CryptoStrategyProfile,
  CryptoAutoEvent as SharedCryptoAutoEvent,
} from '@shared/contracts';
import {
  CryptoAutoTemplateUpsertInputSchema,
  CryptoAutoWatchEntryConditionSchema,
  CryptoAutoWatchUpsertInputSchema,
  CryptoStrategyProfileSchema,
  createCryptoStrategyRules,
} from '@shared/contracts';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  cryptoAutoConfigs,
  cryptoAutoEvents,
  cryptoAutoLots,
  cryptoAutoTemplates,
  cryptoAutoWatches,
  cryptoOrders,
} from '../db/schema';

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

function parseEntryCondition(value: string | null): CryptoAutoWatchEntryCondition {
  if (!value) return { type: 'immediate', price: null };
  try {
    return CryptoAutoWatchEntryConditionSchema.parse(JSON.parse(value));
  } catch {
    return { type: 'immediate', price: null };
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
    source: row.source as CryptoAutoLotSource,
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

function mapTemplate(row: typeof cryptoAutoTemplates.$inferSelect): CryptoAutoTemplate {
  const parsed = CryptoStrategyProfileSchema.parse(JSON.parse(row.strategyJson));
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    strategy: parsed,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function strategyFromConfig(config: CryptoAutoConfig): CryptoStrategyProfile {
  return {
    version: 1,
    market: config.market,
    maxStages: config.maxOpenLots,
    ...createCryptoStrategyRules(config.maxOpenLots, {
      amountKrw: config.baseOrderKrw,
      dropPct: config.addTriggerPct,
      profitPct: config.takeProfitPct,
    }),
    autoBuyEnabled: config.mode !== 'disabled',
    autoBuyOrderType: 'MARKET',
    autoSellEnabled: config.mode !== 'disabled',
    autoSellOrderType: 'MARKET',
  };
}

function parseStrategyJson(
  market: CryptoKrwMarketCode,
  value: string | null,
): CryptoStrategyProfile | null {
  if (!value) return null;
  try {
    const parsed = CryptoStrategyProfileSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    return parsed.data.market === market ? parsed.data : { ...parsed.data, market };
  } catch {
    return null;
  }
}

function maxBuyAmount(profile: CryptoStrategyProfile): string {
  return profile.buyRules.reduce((max, rule) => {
    const left = Number(max);
    const right = Number(rule.amountKrw);
    return Number.isFinite(right) && right > left ? rule.amountKrw : max;
  }, profile.buyRules[0]?.amountKrw ?? '5000');
}

function previousStrategyJson(
  db: Db,
  accountId: number,
  market: CryptoKrwMarketCode,
): string | null {
  return (
    db
      .select({ strategyJson: cryptoAutoConfigs.strategyJson })
      .from(cryptoAutoConfigs)
      .where(
        and(
          eq(cryptoAutoConfigs.accountId, accountId),
          eq(cryptoAutoConfigs.exchange, 'UPBIT'),
          eq(cryptoAutoConfigs.market, market),
        ),
      )
      .get()?.strategyJson ?? null
  );
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
        strategyJson: previousStrategyJson(this.db, accountId, market),
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

  getStrategy(accountId: number, market: CryptoKrwMarketCode): CryptoStrategyProfile {
    const row = this.db
      .select({ strategyJson: cryptoAutoConfigs.strategyJson })
      .from(cryptoAutoConfigs)
      .where(
        and(
          eq(cryptoAutoConfigs.accountId, accountId),
          eq(cryptoAutoConfigs.exchange, 'UPBIT'),
          eq(cryptoAutoConfigs.market, market),
        ),
      )
      .get();
    return (
      parseStrategyJson(market, row?.strategyJson ?? null) ??
      strategyFromConfig(this.getConfig(accountId, market))
    );
  }

  upsertStrategy(
    accountId: number,
    market: CryptoKrwMarketCode,
    profile: CryptoStrategyProfile,
  ): CryptoStrategyProfile {
    const parsed = CryptoStrategyProfileSchema.parse({ ...profile, market });
    const firstBuy = parsed.buyRules[0];
    const secondBuy = parsed.buyRules[1];
    const firstSell = parsed.sellRules[0];
    const mode =
      parsed.autoBuyEnabled || parsed.autoSellEnabled
        ? this.getConfig(accountId, market).mode
        : 'disabled';
    this.upsertConfig(accountId, market, {
      mode,
      baseOrderKrw: firstBuy?.amountKrw ?? '5000',
      maxOrderKrw: maxBuyAmount(parsed),
      addTriggerPct: secondBuy?.triggerDropPct ?? '0.03',
      takeProfitPct: firstSell?.targetProfitPct ?? '0.02',
      maxOpenLots: parsed.maxStages,
    });
    this.db
      .update(cryptoAutoConfigs)
      .set({ strategyJson: JSON.stringify(parsed), updatedAt: new Date() })
      .where(
        and(
          eq(cryptoAutoConfigs.accountId, accountId),
          eq(cryptoAutoConfigs.exchange, 'UPBIT'),
          eq(cryptoAutoConfigs.market, market),
        ),
      )
      .run();
    return this.getStrategy(accountId, market);
  }

  listWatches(accountId: number, filter: CryptoAutoWatchListFilter = undefined): CryptoAutoWatch[] {
    this.ensureLegacyConfigWatches(accountId);
    const filters = [
      eq(cryptoAutoWatches.accountId, accountId),
      eq(cryptoAutoWatches.exchange, 'UPBIT'),
    ];
    if (filter?.market) filters.push(eq(cryptoAutoWatches.market, filter.market));
    if (filter?.status) filters.push(eq(cryptoAutoWatches.status, filter.status));
    if (!filter?.includeCancelled) {
      filters.push(sql`${cryptoAutoWatches.status} <> 'CANCELLED'`);
    }
    return this.db
      .select()
      .from(cryptoAutoWatches)
      .where(and(...filters))
      .orderBy(desc(cryptoAutoWatches.updatedAt))
      .all()
      .map((row) => this.mapWatch(row));
  }

  getWatch(accountId: number, id: number): CryptoAutoWatch | null {
    const row = this.db
      .select()
      .from(cryptoAutoWatches)
      .where(and(eq(cryptoAutoWatches.accountId, accountId), eq(cryptoAutoWatches.id, id)))
      .get();
    return row ? this.mapWatch(row) : null;
  }

  upsertWatch(accountId: number, input: CryptoAutoWatchUpsertInput): CryptoAutoWatch {
    const parsed = CryptoAutoWatchUpsertInputSchema.parse({ ...input, accountId });
    const strategy = CryptoStrategyProfileSchema.parse({
      ...parsed.strategy,
      market: parsed.market,
    });
    const guard = Object.fromEntries(
      Object.entries(parsed.guard).filter(([, value]) => value !== undefined),
    ) as Partial<CryptoAutoGuardConfig>;
    const config = this.upsertConfig(accountId, parsed.market, {
      ...guard,
      mode: parsed.status === 'WATCHING' ? 'live-small' : 'disabled',
    });
    this.upsertStrategy(accountId, parsed.market, strategy);

    const now = new Date();
    const values = {
      accountId,
      exchange: 'UPBIT',
      market: parsed.market,
      label: parsed.label ?? null,
      status: parsed.status,
      entryConditionJson: JSON.stringify(parsed.entryCondition),
      strategyJson: JSON.stringify(strategy),
      guardJson: JSON.stringify({ ...config, ...guard }),
      updatedAt: now,
    };

    if (parsed.id !== undefined) {
      this.db
        .update(cryptoAutoWatches)
        .set(values)
        .where(and(eq(cryptoAutoWatches.accountId, accountId), eq(cryptoAutoWatches.id, parsed.id)))
        .run();
      return (
        this.getWatch(accountId, parsed.id) ??
        this.upsertWatch(accountId, { ...parsed, id: undefined })
      );
    }

    const result = this.db
      .insert(cryptoAutoWatches)
      .values({ ...values, createdAt: now })
      .onConflictDoUpdate({
        target: [cryptoAutoWatches.accountId, cryptoAutoWatches.exchange, cryptoAutoWatches.market],
        set: values,
      })
      .run();
    const id = Number(result.lastInsertRowid);
    const row =
      this.db.select().from(cryptoAutoWatches).where(eq(cryptoAutoWatches.id, id)).get() ??
      this.db
        .select()
        .from(cryptoAutoWatches)
        .where(
          and(
            eq(cryptoAutoWatches.accountId, accountId),
            eq(cryptoAutoWatches.exchange, 'UPBIT'),
            eq(cryptoAutoWatches.market, parsed.market),
          ),
        )
        .get();
    if (!row) throw new Error('crypto auto watch upsert failed');
    return this.mapWatch(row);
  }

  pauseWatches(accountId: number, ids: number[]): number {
    return this.updateWatchStatuses(accountId, ids, 'PAUSED');
  }

  resumeWatches(accountId: number, ids: number[]): number {
    return this.updateWatchStatuses(accountId, ids, 'WATCHING');
  }

  deleteWatches(accountId: number, ids: number[]): number {
    return this.updateWatchStatuses(accountId, ids, 'CANCELLED');
  }

  listTradeHistory(
    accountId: number,
    filter: CryptoAutoTradeHistoryFilter = undefined,
  ): CryptoAutoTradeHistoryItem[] {
    const filters = [
      eq(cryptoAutoEvents.accountId, accountId),
      eq(cryptoAutoEvents.exchange, 'UPBIT'),
    ];
    if (filter?.market) filters.push(eq(cryptoAutoEvents.market, filter.market));
    if (filter?.status === 'failed') {
      filters.push(sql`${cryptoAutoEvents.kind} in ('blocked', 'decimal-error')`);
    } else if (filter?.status === 'open') {
      filters.push(sql`${cryptoAutoEvents.action} in ('plan-buy', 'plan-sell', 'cancel-stale')`);
    } else if (filter?.status === 'closed') {
      filters.push(sql`${cryptoAutoEvents.kind} in ('live-place', 'live-cancel')`);
    }
    const limit = Math.max(1, Math.min(200, Math.trunc(filter?.limit ?? 80)));
    return this.db
      .select()
      .from(cryptoAutoEvents)
      .where(and(...filters))
      .orderBy(desc(cryptoAutoEvents.createdAt))
      .limit(limit)
      .all()
      .map((row) => ({
        id: row.id,
        accountId: row.accountId,
        exchange: 'UPBIT',
        market: row.market as CryptoKrwMarketCode,
        status:
          row.kind === 'blocked' || row.kind === 'decimal-error'
            ? 'failed'
            : row.kind === 'live-cancel'
              ? 'closed'
              : 'event',
        action: row.action,
        reason: row.reason,
        mode: row.mode as CryptoAutoMode,
        createdAt: row.createdAt.getTime(),
      }));
  }

  listTemplates(accountId: number): CryptoAutoTemplate[] {
    return this.db
      .select()
      .from(cryptoAutoTemplates)
      .where(eq(cryptoAutoTemplates.accountId, accountId))
      .orderBy(desc(cryptoAutoTemplates.updatedAt))
      .all()
      .map(mapTemplate);
  }

  saveTemplate(accountId: number, input: CryptoAutoTemplateUpsertInput): CryptoAutoTemplate {
    const parsed = CryptoAutoTemplateUpsertInputSchema.parse({ ...input, accountId });
    const now = new Date();
    if (parsed.id !== undefined) {
      this.db
        .update(cryptoAutoTemplates)
        .set({
          name: parsed.name,
          strategyJson: JSON.stringify(parsed.strategy),
          updatedAt: now,
        })
        .where(
          and(eq(cryptoAutoTemplates.accountId, accountId), eq(cryptoAutoTemplates.id, parsed.id)),
        )
        .run();
      const row = this.db
        .select()
        .from(cryptoAutoTemplates)
        .where(
          and(eq(cryptoAutoTemplates.accountId, accountId), eq(cryptoAutoTemplates.id, parsed.id)),
        )
        .get();
      if (!row) throw new Error('crypto auto template update failed');
      return mapTemplate(row);
    }
    const result = this.db
      .insert(cryptoAutoTemplates)
      .values({
        accountId,
        name: parsed.name,
        strategyJson: JSON.stringify(parsed.strategy),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cryptoAutoTemplates.accountId, cryptoAutoTemplates.name],
        set: {
          strategyJson: JSON.stringify(parsed.strategy),
          updatedAt: now,
        },
      })
      .run();
    const id = Number(result.lastInsertRowid);
    const row =
      this.db.select().from(cryptoAutoTemplates).where(eq(cryptoAutoTemplates.id, id)).get() ??
      this.db
        .select()
        .from(cryptoAutoTemplates)
        .where(
          and(
            eq(cryptoAutoTemplates.accountId, accountId),
            eq(cryptoAutoTemplates.name, parsed.name),
          ),
        )
        .get();
    if (!row) throw new Error('crypto auto template upsert failed');
    return mapTemplate(row);
  }

  deleteTemplate(accountId: number, id: number): boolean {
    const result = this.db
      .delete(cryptoAutoTemplates)
      .where(and(eq(cryptoAutoTemplates.accountId, accountId), eq(cryptoAutoTemplates.id, id)))
      .run();
    return result.changes > 0;
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

  listOpenLots(
    accountId: number,
    market: CryptoKrwMarketCode,
    source?: CryptoAutoLotSource,
  ): CryptoLot[] {
    const filters = [
      eq(cryptoAutoLots.accountId, accountId),
      eq(cryptoAutoLots.exchange, 'UPBIT'),
      eq(cryptoAutoLots.market, market),
      eq(cryptoAutoLots.status, 'open'),
    ];
    if (source !== undefined) filters.push(eq(cryptoAutoLots.source, source));
    return this.db
      .select()
      .from(cryptoAutoLots)
      .where(and(...filters))
      .orderBy(cryptoAutoLots.sequence)
      .all()
      .map(mapLot);
  }

  createLot(input: {
    accountId: number;
    market: CryptoKrwMarketCode;
    source?: CryptoAutoLotSource;
    quantity: string;
    avgEntryKrw: string;
    allocatedKrw: string;
    openedAt?: number;
  }): CryptoLot {
    const now = new Date(input.openedAt ?? Date.now());
    const source = input.source ?? 'dry-run';
    const sequence = this.nextLotSequence(input.accountId, input.market, source);
    const result = this.db
      .insert(cryptoAutoLots)
      .values({
        accountId: input.accountId,
        exchange: 'UPBIT',
        market: input.market,
        source,
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

  private ensureLegacyConfigWatches(accountId: number): void {
    const configs = this.db
      .select()
      .from(cryptoAutoConfigs)
      .where(
        and(eq(cryptoAutoConfigs.accountId, accountId), eq(cryptoAutoConfigs.exchange, 'UPBIT')),
      )
      .all()
      .map((row) => mapConfigRow(accountId, row.market as CryptoKrwMarketCode, row));
    for (const config of configs) {
      const strategy = this.getStrategy(accountId, config.market);
      const now = new Date(config.updatedAt || Date.now());
      this.db
        .insert(cryptoAutoWatches)
        .values({
          accountId,
          exchange: 'UPBIT',
          market: config.market,
          label: null,
          status: config.mode === 'disabled' ? 'PAUSED' : 'WATCHING',
          entryConditionJson: JSON.stringify({ type: 'immediate', price: null }),
          strategyJson: JSON.stringify(strategy),
          guardJson: JSON.stringify(config),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            cryptoAutoWatches.accountId,
            cryptoAutoWatches.exchange,
            cryptoAutoWatches.market,
          ],
        })
        .run();
    }
  }

  private mapWatch(row: typeof cryptoAutoWatches.$inferSelect): CryptoAutoWatch {
    const market = row.market as CryptoKrwMarketCode;
    const config = this.getConfig(row.accountId, market);
    const strategy =
      parseStrategyJson(market, row.strategyJson) ?? this.getStrategy(row.accountId, market);
    const lastEvent = this.listRecentEvents(row.accountId, market, 1)[0] ?? null;
    const liveLots = this.listOpenLots(row.accountId, market, 'live');
    const openOrderCount =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(cryptoOrders)
        .where(
          and(
            eq(cryptoOrders.accountId, row.accountId),
            eq(cryptoOrders.exchange, 'UPBIT'),
            eq(cryptoOrders.market, market),
            sql`${cryptoOrders.state} in ('wait', 'watch')`,
          ),
        )
        .get()?.count ?? 0;
    return {
      id: row.id,
      accountId: row.accountId,
      exchange: 'UPBIT',
      market,
      label: row.label,
      status: row.status as CryptoAutoWatchStatus,
      entryCondition: parseEntryCondition(row.entryConditionJson),
      strategy,
      config,
      currentStage: liveLots.length,
      openOrderCount: Number(openOrderCount),
      lastDecision: lastEvent?.reason ?? null,
      lastDecisionAt: lastEvent?.createdAt ?? null,
      lastActionAt: config.lastLiveActionAt ?? lastEvent?.createdAt ?? null,
      blockedReasons: [],
      runtimeRunning: false,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  private updateWatchStatuses(
    accountId: number,
    ids: number[],
    status: CryptoAutoWatchStatus,
  ): number {
    if (ids.length === 0) return 0;
    const rows = this.db
      .select()
      .from(cryptoAutoWatches)
      .where(and(eq(cryptoAutoWatches.accountId, accountId), inArray(cryptoAutoWatches.id, ids)))
      .all();
    const now = new Date();
    this.db
      .update(cryptoAutoWatches)
      .set({ status, updatedAt: now })
      .where(and(eq(cryptoAutoWatches.accountId, accountId), inArray(cryptoAutoWatches.id, ids)))
      .run();
    for (const row of rows) {
      this.upsertConfig(accountId, row.market as CryptoKrwMarketCode, {
        mode: status === 'WATCHING' ? 'live-small' : 'disabled',
      });
    }
    return rows.length;
  }

  private nextLotSequence(
    accountId: number,
    market: CryptoKrwMarketCode,
    source: CryptoAutoLotSource,
  ): number {
    const row = this.db
      .select({ maxSequence: sql<number>`coalesce(max(${cryptoAutoLots.sequence}), 0)` })
      .from(cryptoAutoLots)
      .where(
        and(
          eq(cryptoAutoLots.accountId, accountId),
          eq(cryptoAutoLots.exchange, 'UPBIT'),
          eq(cryptoAutoLots.market, market),
          eq(cryptoAutoLots.source, source),
        ),
      )
      .get();
    return Number(row?.maxSequence ?? 0) + 1;
  }
}
