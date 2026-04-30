import type { BrokerPort } from '../brokers/ports/broker-port';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { StockMasterSyncService } from '../trading/stock-master-sync';
import { screenRangeCycleFit } from './algo/screen-range-cycle-fit';
import { ensureDailyCandles } from './ensure-candles';
import type { CachedKrxDailyTrade } from './market-context-repo';
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
  emptyReason: string | null;
  sources: ApiContextDiagnostic[];
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

const DEFAULT_AUTO_SEED_CAP = 80;
const DEFAULT_AUTO_CAP = 50;
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
          category: 'SYS',
          message: 'ai.auto-discovery.stock-master-sync-failed',
          payload: { kind: synced.error.kind, msg: synced.error.msg },
        });
      }
    } catch (cause) {
      input.logger.log({
        level: 'WARN',
        category: 'SYS',
        message: 'ai.auto-discovery.stock-master-sync-failed',
        payload: { reason: cause instanceof Error ? cause.message : String(cause) },
      });
    }
  }

  const universe = await getKrxUniverse(input.marketContextService);
  diagnostics.sources.push(...universe.sources);
  diagnostics.universeCount = universe.rows.length;
  diagnostics.basisDate = latestDate(universe.rows);

  const seeds = selectKrxSeeds(universe.rows, input.excludePdnos ?? new Set(), input.autoSeedCap);
  diagnostics.seedCount = seeds.length;
  if (seeds.length === 0) {
    diagnostics.emptyReason =
      universe.rows.length === 0 ? 'krx_unavailable' : 'no_seed_after_liquidity_filter';
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

  const screened = screenRangeCycleFit({
    db: input.db,
    candlesRepo: input.candlesRepo,
    cap: input.autoCap ?? DEFAULT_AUTO_CAP,
    ...(input.excludePdnos ? { excludePdnos: input.excludePdnos } : {}),
    candidatePdnos: seeds.map((row) => row.pdno),
  });
  diagnostics.screenedCount = screened.length;
  diagnostics.addedCount = screened.length;
  if (screened.length === 0) {
    diagnostics.emptyReason = ensured.skipped ? 'broker_unavailable_or_no_cache' : 'no_screen_pass';
  }

  return {
    candidates: screened.map((row) => ({ pdno: row.pdno, name: row.name })),
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
    emptyReason: 'disabled',
    sources: [],
  };
}

async function getKrxUniverse(
  service: MarketContextService | null | undefined,
): Promise<{ rows: CachedKrxDailyTrade[]; sources: ApiContextDiagnostic[] }> {
  if (!service) {
    return {
      rows: [],
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
  return { rows: snapshot.rows, sources };
}

function selectKrxSeeds(
  rows: ReadonlyArray<CachedKrxDailyTrade>,
  excludePdnos: ReadonlySet<string>,
  cap = DEFAULT_AUTO_SEED_CAP,
): CachedKrxDailyTrade[] {
  return rows
    .filter((row) => {
      if (!/^\d{6}$/.test(row.pdno) || excludePdnos.has(row.pdno)) return false;
      if ((row.close ?? 0) <= 0 || (row.volume ?? 0) <= 0 || (row.tradeValue ?? 0) <= 0) {
        return false;
      }
      return true;
    })
    .sort((a, b) => scoreKrxSeed(b) - scoreKrxSeed(a))
    .slice(0, Math.max(1, cap));
}

function scoreKrxSeed(row: CachedKrxDailyTrade): number {
  const tradeValue = Math.log10(Math.max(1, row.tradeValue ?? 0));
  const volume = Math.log10(Math.max(1, row.volume ?? 0));
  const marketCap = Math.log10(Math.max(1, row.marketCap ?? 0));
  const changeRate = Math.abs(row.changeRate ?? 0);
  const volatilityFit = changeRate <= 0.2 ? 2 : changeRate <= 6 ? 8 - Math.abs(changeRate - 2) : 1;
  const sizeFit = marketCap >= 10.8 && marketCap <= 13.8 ? 6 : 3;
  return tradeValue * 9 + volume * 4 + volatilityFit * 5 + sizeFit;
}

function latestDate(rows: ReadonlyArray<CachedKrxDailyTrade>): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (latest === null || row.date > latest) latest = row.date;
  }
  return latest;
}
