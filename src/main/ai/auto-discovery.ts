import type { BrokerPort } from '../brokers/ports/broker-port';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { StockMasterSyncService } from '../trading/stock-master-sync';
import {
  emptyRangeCycleDiagnostics,
  type RangeCycleConditionPassCounts,
  type RangeCycleTierCounts,
  screenRangeCycleFitWithDiagnostics,
} from './algo/screen-range-cycle-fit';
import { ensureDailyCandles } from './ensure-candles';
import type { CachedKrxBaseInfo, CachedKrxDailyTrade } from './market-context-repo';
import type { MarketContextService } from './market-context-service';

export type ApiContextSource =
  | 'krx'
  | 'ksd'
  | 'fsc-stock-lending'
  | 'eia'
  | 'kosis'
  | 'ecos'
  | 'naver-datalab'
  | 'dart'
  | 'naver-news';

export type ApiContextStatus = 'used' | 'cache' | 'skipped' | 'failed';

export interface ApiContextDiagnostic {
  source: ApiContextSource;
  status: ApiContextStatus;
  count?: number;
  stale?: boolean;
  reason?: string | null;
}

export interface AutoDiscoveryDiagnostics {
  enabled: boolean;
  universeCount: number;
  basisDate: string | null;
  seedCount: number;
  candlesFetched: number;
  candlesFailed: number;
  candlesSkipped: boolean;
  screenedCount: number;
  addedCount: number;
  blockedCount: number;
  conditionPassCounts: RangeCycleConditionPassCounts;
  tierCounts: RangeCycleTierCounts;
  lowestIncludedScore: number | null;
  universeQuality?: AutoDiscoveryUniverseQuality;
  bucketCounts?: AutoDiscoveryBucketCounts;
  candleCoverage?: AutoDiscoveryCandleCoverage;
  emptyReason: string | null;
  sources: ApiContextDiagnostic[];
}

export interface AutoDiscoveryUniverseQuality {
  raw: number;
  eligible: number;
  excludedByMarket: number;
  excludedByCode: number;
  excludedByPrice: number;
  excludedByVolume: number;
  excludedByTradeValue: number;
  excludedByBaseInfo: number;
  excludedByAlreadyKnown: number;
  baseInfoMissing: number;
}

export interface AutoDiscoveryBucketCounts {
  market: Record<string, number>;
  marketCap: Record<string, number>;
  tradeValue: Record<string, number>;
  composite: Record<string, number>;
}

export interface AutoDiscoveryCandleCoverage {
  requested: number;
  fetched: number;
  failed: number;
  skipped: boolean;
  minCount: number;
}

export interface AutoDiscoveredCandidate {
  pdno: string;
  name: string;
}

export interface AutoDiscoveryResult {
  candidates: AutoDiscoveredCandidate[];
  diagnostics: AutoDiscoveryDiagnostics;
}

export interface DiscoverAutoCandidatesInput {
  db: Db;
  candlesRepo: DailyCandlesRepo;
  logger: EventLogger;
  stockMasterSync?: StockMasterSyncService | undefined;
  marketContextService?: MarketContextService | null | undefined;
  broker?: BrokerPort | null | undefined;
  excludePdnos?: ReadonlySet<string> | undefined;
  autoSeedCap?: number | undefined;
  autoCap?: number | undefined;
}

const DEFAULT_AUTO_SEED_CAP = 160;
const DEFAULT_AUTO_CAP = 50;
const MIN_SEED_TRADE_VALUE = 100_000_000;
const TRADE_VALUE_SCORE_CAP = 10_000_000_000;
const SEED_BUCKET_SOFT_SHARE = 0.35;
const OPTIONAL_CONTEXT_SOURCES: readonly ApiContextSource[] = [
  'ksd',
  'fsc-stock-lending',
  'eia',
  'kosis',
];

export async function discoverAutoCandidates(
  input: DiscoverAutoCandidatesInput,
): Promise<AutoDiscoveryResult> {
  const diagnostics: AutoDiscoveryDiagnostics = {
    enabled: true,
    universeCount: 0,
    basisDate: null,
    seedCount: 0,
    candlesFetched: 0,
    candlesFailed: 0,
    candlesSkipped: false,
    screenedCount: 0,
    addedCount: 0,
    ...emptyAutoScreeningDiagnostics(),
    emptyReason: null,
    sources: OPTIONAL_CONTEXT_SOURCES.map((source) => ({
      source,
      status: 'skipped',
      reason: 'client-not-wired',
    })),
  };

  if (input.stockMasterSync) {
    try {
      const synced = await input.stockMasterSync.syncIfStale();
      if (synced.isErr()) {
        input.logger.log({
          level: 'WARN',
          category: 'AI',
          message: 'ai.auto-discovery.stock-master-sync-failed',
          payload: { kind: synced.error.kind, msg: synced.error.msg },
        });
      }
    } catch (cause) {
      input.logger.log({
        level: 'WARN',
        category: 'AI',
        message: 'ai.auto-discovery.stock-master-sync-failed',
        payload: { reason: cause instanceof Error ? cause.message : String(cause) },
      });
    }
  }

  const universe = await getKrxUniverse(input.marketContextService);
  diagnostics.sources.push(...universe.sources);
  diagnostics.universeCount = universe.rows.length;
  diagnostics.basisDate = latestDate(universe.rows);
  input.logger.log({
    level: 'INFO',
    category: 'AI',
    message: 'ai.auto-discovery.universe-loaded',
    payload: {
      universeCount: diagnostics.universeCount,
      basisDate: diagnostics.basisDate,
      baseInfoCount: universe.baseInfoByKey.size,
      marketCounts: countMarketRows(universe.rows),
      sources: universe.sources,
      sample: previewKrxRows(universe.rows),
    },
  });

  const excludePdnos = input.excludePdnos ?? new Set<string>();
  const eligible = buildEligibleKrxRows(universe.rows, excludePdnos, universe.baseInfoByKey);
  diagnostics.universeQuality = eligible.quality;
  diagnostics.bucketCounts = eligible.bucketCounts;
  input.logger.log({
    level: 'INFO',
    category: 'AI',
    message: 'ai.auto-discovery.eligible-built',
    payload: {
      quality: eligible.quality,
      bucketCounts: eligible.bucketCounts,
      eligibleSample: previewKrxRows(eligible.rows),
    },
  });

  const seeds = selectSeedRows(eligible.rows, input.autoSeedCap ?? DEFAULT_AUTO_SEED_CAP);
  diagnostics.seedCount = seeds.length;
  input.logger.log({
    level: 'INFO',
    category: 'AI',
    message: 'ai.auto-discovery.seeds-selected',
    payload: {
      seedCount: seeds.length,
      seedCap: input.autoSeedCap ?? DEFAULT_AUTO_SEED_CAP,
      softShare: SEED_BUCKET_SOFT_SHARE,
      bucketCounts: countSeedBuckets(seeds),
      sample: previewSeedRows(seeds),
    },
  });
  if (seeds.length === 0) {
    diagnostics.emptyReason =
      universe.rows.length === 0 ? 'krx_unavailable' : 'no_seed_after_liquidity_filter';
    input.logger.log({
      level: 'WARN',
      category: 'AI',
      message: 'ai.auto-discovery.empty',
      payload: {
        emptyReason: diagnostics.emptyReason,
        universeCount: diagnostics.universeCount,
        quality: diagnostics.universeQuality,
        sources: diagnostics.sources,
      },
    });
    return { candidates: [], diagnostics };
  }

  const ensured = await ensureDailyCandles({
    pdnos: seeds.map((row) => row.pdno),
    candlesRepo: input.candlesRepo,
    broker: input.broker ?? null,
    logger: input.logger,
    minCount: 60,
  });
  diagnostics.candlesFetched = ensured.fetched;
  diagnostics.candlesFailed = ensured.failed;
  diagnostics.candlesSkipped = ensured.skipped;
  diagnostics.candleCoverage = {
    requested: seeds.length,
    fetched: ensured.fetched,
    failed: ensured.failed,
    skipped: ensured.skipped,
    minCount: 60,
  };
  input.logger.log({
    level: 'INFO',
    category: 'AI',
    message: 'ai.auto-discovery.candles-ensured',
    payload: { ...diagnostics.candleCoverage },
  });

  const screened = screenRangeCycleFitWithDiagnostics({
    db: input.db,
    candlesRepo: input.candlesRepo,
    cap: input.autoCap ?? DEFAULT_AUTO_CAP,
    ...(input.excludePdnos ? { excludePdnos: input.excludePdnos } : {}),
    candidatePdnos: seeds.map((row) => row.pdno),
  });
  diagnostics.screenedCount = screened.diagnostics.evaluatedCount;
  diagnostics.addedCount = screened.candidates.length;
  diagnostics.blockedCount = screened.diagnostics.blockedCount;
  diagnostics.conditionPassCounts = screened.diagnostics.conditionPassCounts;
  diagnostics.tierCounts = screened.diagnostics.tierCounts;
  diagnostics.lowestIncludedScore = screened.diagnostics.lowestIncludedScore;
  if (screened.candidates.length === 0) {
    diagnostics.emptyReason = ensured.skipped ? 'broker_unavailable_or_no_cache' : 'no_screen_pass';
  }
  input.logger.log({
    level: screened.candidates.length > 0 ? 'INFO' : 'WARN',
    category: 'AI',
    message: 'ai.auto-discovery.screened',
    payload: {
      screenedCount: diagnostics.screenedCount,
      addedCount: diagnostics.addedCount,
      blockedCount: diagnostics.blockedCount,
      emptyReason: diagnostics.emptyReason,
      conditionPassCounts: diagnostics.conditionPassCounts,
      tierCounts: diagnostics.tierCounts,
      lowestIncludedScore: diagnostics.lowestIncludedScore,
      sample: screened.candidates.slice(0, 12).map((row) => ({
        pdno: row.pdno,
        name: row.name,
        score: row.score,
        tier: row.tier,
        rangeCycleScore: row.rangeCycleScore,
        conditionPasses: row.conditionPasses,
        riskReasons: row.riskReasons,
      })),
    },
  });

  return {
    candidates: screened.candidates.map((row) => ({ pdno: row.pdno, name: row.name })),
    diagnostics,
  };
}

export function disabledAutoDiscoveryDiagnostics(): AutoDiscoveryDiagnostics {
  return {
    enabled: false,
    universeCount: 0,
    basisDate: null,
    seedCount: 0,
    candlesFetched: 0,
    candlesFailed: 0,
    candlesSkipped: false,
    screenedCount: 0,
    addedCount: 0,
    ...emptyAutoScreeningDiagnostics(),
    emptyReason: 'disabled',
    sources: [],
  };
}

function emptyAutoScreeningDiagnostics(): Pick<
  AutoDiscoveryDiagnostics,
  'blockedCount' | 'conditionPassCounts' | 'tierCounts' | 'lowestIncludedScore'
> {
  const screening = emptyRangeCycleDiagnostics();
  return {
    blockedCount: screening.blockedCount,
    conditionPassCounts: screening.conditionPassCounts,
    tierCounts: screening.tierCounts,
    lowestIncludedScore: screening.lowestIncludedScore,
  };
}

async function getKrxUniverse(service: MarketContextService | null | undefined): Promise<{
  rows: CachedKrxDailyTrade[];
  baseInfoByKey: Map<string, CachedKrxBaseInfo>;
  sources: ApiContextDiagnostic[];
}> {
  if (!service) {
    return {
      rows: [],
      baseInfoByKey: new Map(),
      sources: [{ source: 'krx', status: 'skipped', count: 0, reason: 'service-unavailable' }],
    };
  }
  const snapshot = await service.getKrxUniverseForAutoDiscovery(['KOSPI', 'KOSDAQ']);
  const sources: ApiContextDiagnostic[] = snapshot.statuses.map((status) => ({
    source: 'krx',
    status:
      status.status === 'fresh' ? 'used' : status.status === 'cache' ? 'cache' : status.status,
    count: status.count,
    stale: status.status === 'cache',
    reason: status.reason,
  }));
  return { rows: snapshot.rows, baseInfoByKey: snapshot.baseInfoByKey, sources };
}

export function selectKrxSeeds(
  rows: ReadonlyArray<CachedKrxDailyTrade>,
  excludePdnos: ReadonlySet<string>,
  cap = DEFAULT_AUTO_SEED_CAP,
  options: { baseInfoByKey?: ReadonlyMap<string, CachedKrxBaseInfo> } = {},
): CachedKrxDailyTrade[] {
  const eligible = buildEligibleKrxRows(rows, excludePdnos, options.baseInfoByKey ?? new Map());
  return selectSeedRows(eligible.rows, cap);
}

function selectSeedRows(
  rows: ReadonlyArray<CachedKrxDailyTrade>,
  cap = DEFAULT_AUTO_SEED_CAP,
): CachedKrxDailyTrade[] {
  const limit = Math.max(1, cap);
  const buckets = new Map<string, { key: string; rows: CachedKrxDailyTrade[] }>();
  for (const row of rows) {
    const key = seedBucketKey(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(row);
    else buckets.set(key, { key, rows: [row] });
  }

  const bucketRows = Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    rows: bucket.rows.sort((a, b) => scoreKrxSeed(b) - scoreKrxSeed(a)),
  }));
  bucketRows.sort((a, b) => {
    const left = a.rows[0];
    const right = b.rows[0];
    if (!left || !right) return 0;
    return scoreKrxSeed(right) - scoreKrxSeed(left);
  });

  const out: CachedKrxDailyTrade[] = [];
  const selectedByBucket = new Map<string, number>();
  const maxPerBucket = Math.max(1, Math.ceil(limit * SEED_BUCKET_SOFT_SHARE));
  drainSeedBuckets(bucketRows, out, selectedByBucket, limit, maxPerBucket, true);
  drainSeedBuckets(bucketRows, out, selectedByBucket, limit, maxPerBucket, false);
  return out;
}

function drainSeedBuckets(
  buckets: Array<{ key: string; rows: CachedKrxDailyTrade[] }>,
  out: CachedKrxDailyTrade[],
  selectedByBucket: Map<string, number>,
  limit: number,
  maxPerBucket: number,
  enforceSoftCap: boolean,
): void {
  while (out.length < limit && buckets.some((bucket) => bucket.rows.length > 0)) {
    let progressed = false;
    for (const bucket of buckets) {
      if (out.length >= limit) break;
      if (bucket.rows.length === 0) continue;
      const count = selectedByBucket.get(bucket.key) ?? 0;
      if (enforceSoftCap && count >= maxPerBucket) continue;
      const row = bucket.rows.shift();
      if (!row) continue;
      out.push(row);
      selectedByBucket.set(bucket.key, count + 1);
      progressed = true;
    }
    if (!progressed) break;
  }
}

function scoreKrxSeed(row: CachedKrxDailyTrade): number {
  const tradeValue = Math.log10(Math.max(1, Math.min(row.tradeValue ?? 0, TRADE_VALUE_SCORE_CAP)));
  const volume = Math.log10(Math.max(1, row.volume ?? 0));
  const changeRate = Math.abs(row.changeRate ?? 0);
  const volatilityFit = changeRate <= 0.2 ? 2 : changeRate <= 6 ? 8 - Math.abs(changeRate - 2) : 1;
  return tradeValue * 6 + volume * 4 + volatilityFit * 5;
}

function buildEligibleKrxRows(
  rows: ReadonlyArray<CachedKrxDailyTrade>,
  excludePdnos: ReadonlySet<string>,
  baseInfoByKey: ReadonlyMap<string, CachedKrxBaseInfo>,
): {
  rows: CachedKrxDailyTrade[];
  quality: AutoDiscoveryUniverseQuality;
  bucketCounts: AutoDiscoveryBucketCounts;
} {
  const quality: AutoDiscoveryUniverseQuality = {
    raw: rows.length,
    eligible: 0,
    excludedByMarket: 0,
    excludedByCode: 0,
    excludedByPrice: 0,
    excludedByVolume: 0,
    excludedByTradeValue: 0,
    excludedByBaseInfo: 0,
    excludedByAlreadyKnown: 0,
    baseInfoMissing: 0,
  };
  const eligibleRows: CachedKrxDailyTrade[] = [];
  for (const row of rows) {
    const baseInfo = baseInfoByKey.get(baseInfoKey(row));
    if (!baseInfo) quality.baseInfoMissing += 1;
    const result = seedEligibility(row, excludePdnos, baseInfo);
    if (result === 'eligible') {
      eligibleRows.push(row);
      quality.eligible += 1;
      continue;
    }
    quality[result] += 1;
  }
  return { rows: eligibleRows, quality, bucketCounts: countSeedBuckets(eligibleRows) };
}

function seedEligibility(
  row: CachedKrxDailyTrade,
  excludePdnos: ReadonlySet<string>,
  baseInfo: CachedKrxBaseInfo | undefined,
): keyof Omit<AutoDiscoveryUniverseQuality, 'raw' | 'eligible' | 'baseInfoMissing'> | 'eligible' {
  if (row.market !== 'KOSPI' && row.market !== 'KOSDAQ') return 'excludedByMarket';
  if (!/^\d{6}$/.test(row.pdno)) return 'excludedByCode';
  if (excludePdnos.has(row.pdno)) return 'excludedByAlreadyKnown';
  if ((row.close ?? 0) <= 0) return 'excludedByPrice';
  if ((row.volume ?? 0) <= 0) return 'excludedByVolume';
  if ((row.tradeValue ?? 0) < MIN_SEED_TRADE_VALUE) return 'excludedByTradeValue';
  if (baseInfo && !isCommonStock(baseInfo)) return 'excludedByBaseInfo';
  return 'eligible';
}

function isCommonStock(baseInfo: CachedKrxBaseInfo): boolean {
  const securityGroup = baseInfo.securityGroup?.trim() ?? '';
  const stockKind = baseInfo.stockKind?.trim() ?? '';
  if (securityGroup && !securityGroup.includes('주권')) return false;
  if (stockKind && !stockKind.includes('보통')) return false;
  return true;
}

function countSeedBuckets(rows: ReadonlyArray<CachedKrxDailyTrade>): AutoDiscoveryBucketCounts {
  const out: AutoDiscoveryBucketCounts = {
    market: {},
    marketCap: {},
    tradeValue: {},
    composite: {},
  };
  for (const row of rows) {
    increment(out.market, row.market);
    increment(out.marketCap, marketCapBucket(row.marketCap));
    increment(out.tradeValue, tradeValueBucket(row.tradeValue));
    increment(out.composite, seedBucketKey(row));
  }
  return out;
}

function countMarketRows(rows: ReadonlyArray<CachedKrxDailyTrade>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) increment(out, row.market);
  return out;
}

function previewKrxRows(rows: ReadonlyArray<CachedKrxDailyTrade>): Array<{
  pdno: string;
  name: string;
  market: string;
  tradeValue: number | null;
  marketCap: number | null;
  close: number | null;
  volume: number | null;
  bucket: string;
}> {
  return rows.slice(0, 12).map((row) => ({
    pdno: row.pdno,
    name: row.name,
    market: row.market,
    tradeValue: row.tradeValue,
    marketCap: row.marketCap,
    close: row.close,
    volume: row.volume,
    bucket: seedBucketKey(row),
  }));
}

function previewSeedRows(rows: ReadonlyArray<CachedKrxDailyTrade>): Array<{
  pdno: string;
  name: string;
  market: string;
  tradeValue: number | null;
  marketCap: number | null;
  score: number;
  bucket: string;
}> {
  return rows.slice(0, 20).map((row) => ({
    pdno: row.pdno,
    name: row.name,
    market: row.market,
    tradeValue: row.tradeValue,
    marketCap: row.marketCap,
    score: Math.round(scoreKrxSeed(row) * 10) / 10,
    bucket: seedBucketKey(row),
  }));
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function baseInfoKey(row: Pick<CachedKrxDailyTrade, 'market' | 'pdno'>): string {
  return `${row.market}:${row.pdno}`;
}

function seedBucketKey(row: CachedKrxDailyTrade): string {
  return [row.market, marketCapBucket(row.marketCap), tradeValueBucket(row.tradeValue)].join(':');
}

function marketCapBucket(value: number | null): string {
  const n = log10OrNull(value);
  if (n === null) return 'cap-unknown';
  if (n < 11.2) return 'cap-small';
  if (n < 12.2) return 'cap-mid';
  if (n < 13.2) return 'cap-large';
  return 'cap-mega';
}

function tradeValueBucket(value: number | null): string {
  if (value === null || value <= 0) return 'trade-unknown';
  if (value < 500_000_000) return 'trade-100m-500m';
  if (value < 2_000_000_000) return 'trade-500m-2b';
  if (value < 10_000_000_000) return 'trade-2b-10b';
  return 'trade-10b-plus';
}

function log10OrNull(value: number | null): number | null {
  if (value === null || value <= 0) return null;
  return Math.log10(value);
}

function latestDate(rows: ReadonlyArray<CachedKrxDailyTrade>): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (latest === null || row.date > latest) latest = row.date;
  }
  return latest;
}
