import type { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import type { StockMasterRepo } from '../trading/stock-master-repo';
import type { EcosClient, EcosSeriesRequest } from './ecos-client';
import type { KrxClient, KrxMarket } from './krx-client';
import type {
  CachedEcosSeriesPoint,
  CachedKrxDailyTrade,
  MarketContextRepo,
} from './market-context-repo';

export interface MarketContextSourceStatus {
  isAvailable: boolean;
  isStale: boolean;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export interface MarketContextStatus {
  krx: MarketContextSourceStatus;
  ecos: MarketContextSourceStatus;
}

export interface MarketContextSnapshot {
  status: MarketContextStatus;
  krxByPdno: Map<string, CachedKrxDailyTrade>;
  ecos: CachedEcosSeriesPoint[];
}

export interface MarketContextServiceOptions {
  krxClient: KrxClient;
  ecosClient: EcosClient;
  repo: MarketContextRepo;
  settingsRepo: SettingsRepo;
  stockMasterRepo: StockMasterRepo;
  logger: EventLogger;
  now?: () => Date;
}

const STALE_MS = 24 * 60 * 60 * 1000;
const KRX_LOOKBACK_DAYS = 7;
const KRX_SUCCESS_KEY = 'market_context.krx.last_success_at';
const KRX_ERROR_KEY = 'market_context.krx.last_error';
const ECOS_SUCCESS_KEY = 'market_context.ecos.last_success_at';
const ECOS_ERROR_KEY = 'market_context.ecos.last_error';

type DefaultEcosSeries = Omit<EcosSeriesRequest, 'start' | 'end'>;

export const DEFAULT_ECOS_SERIES: readonly DefaultEcosSeries[] = [
  {
    indicator: 'usdKrw',
    statCode: '731Y001',
    itemCode: '0000001',
    frequency: 'D',
    count: 30,
  },
  {
    indicator: 'callRate',
    statCode: '817Y002',
    itemCode: '010101000',
    frequency: 'D',
    count: 30,
  },
] as const;

export class MarketContextService {
  constructor(private readonly opts: MarketContextServiceOptions) {}

  getStatus(): MarketContextStatus {
    return {
      krx: this.statusFor('krx'),
      ecos: this.statusFor('ecos'),
    };
  }

  async getContextForPdnos(pdnos: ReadonlyArray<string>): Promise<MarketContextSnapshot> {
    const normalized = [...new Set(pdnos.map((p) => p.padStart(6, '0')))];
    if (this.statusFor('krx').isStale && normalized.length > 0) {
      await this.refreshKrxForPdnos(normalized);
    }
    if (this.statusFor('ecos').isStale) {
      await this.refreshDefaultEcosSeries();
    }
    return {
      status: this.getStatus(),
      krxByPdno: this.opts.repo.getLatestKrxDailyTrade(normalized),
      ecos: this.opts.repo.getLatestEcosPoints(),
    };
  }

  async refreshKrxForPdnos(pdnos: ReadonlyArray<string>): Promise<{ inserted: number }> {
    if (!this.opts.krxClient.isAvailable()) {
      this.recordError('krx', 'KRX_API_KEY 미설정');
      return { inserted: 0 };
    }
    const grouped = new Map<KrxMarket, string[]>();
    for (const pdno of pdnos) {
      const market = this.resolveMarket(pdno);
      if (!market) continue;
      const codes = grouped.get(market);
      if (codes) codes.push(pdno);
      else grouped.set(market, [pdno]);
    }
    if (grouped.size === 0) {
      this.recordError('krx', 'KRX market 미확인');
      return { inserted: 0 };
    }
    let inserted = 0;
    try {
      for (const [market, codes] of grouped.entries()) {
        const remaining = new Set(codes);
        for (let offset = 0; offset <= KRX_LOOKBACK_DAYS && remaining.size > 0; offset++) {
          const basDd = ymdCompact(shiftDays(this.now(), -offset));
          const targets = [...remaining];
          const dailyRows = await this.opts.krxClient.getDailyTradeInfo({
            market,
            basDd,
            pdnos: targets,
          });
          if (dailyRows.length === 0) continue;

          inserted += this.opts.repo.upsertKrxDailyTrade(dailyRows);
          const foundPdnos = dailyRows.map((row) => row.pdno);
          for (const pdno of foundPdnos) remaining.delete(pdno);

          const baseRows = await this.opts.krxClient.getBaseInfo({
            market,
            basDd,
            pdnos: foundPdnos,
          });
          inserted += this.opts.repo.upsertKrxBaseInfo(baseRows);
        }
      }
      if (inserted > 0) {
        this.recordSuccess('krx');
      } else {
        this.recordError('krx', 'KRX 응답 데이터 없음');
      }
      return { inserted };
    } catch (cause) {
      this.recordError('krx', cause instanceof Error ? cause.message : String(cause));
      return { inserted };
    }
  }

  async refreshDefaultEcosSeries(): Promise<{ inserted: number }> {
    if (!this.opts.ecosClient.isAvailable()) {
      this.recordError('ecos', 'ECOS_API_KEY 미설정');
      return { inserted: 0 };
    }
    let inserted = 0;
    try {
      for (const series of DEFAULT_ECOS_SERIES) {
        const rows = await this.opts.ecosClient.getRecentSeries({
          ...series,
          start: ymdCompact(shiftDays(this.now(), -14)),
          end: ymdCompact(this.now()),
        });
        inserted += this.opts.repo.upsertEcosSeries(rows);
      }
      if (inserted > 0) {
        this.recordSuccess('ecos');
      } else {
        this.recordError('ecos', 'ECOS 응답 데이터 없음');
      }
      return { inserted };
    } catch (cause) {
      this.recordError('ecos', cause instanceof Error ? cause.message : String(cause));
      return { inserted };
    }
  }

  private statusFor(source: 'krx' | 'ecos'): MarketContextSourceStatus {
    const available =
      source === 'krx' ? this.opts.krxClient.isAvailable() : this.opts.ecosClient.isAvailable();
    const lastSuccessAt = this.readMs(source === 'krx' ? KRX_SUCCESS_KEY : ECOS_SUCCESS_KEY);
    const lastError = this.opts.settingsRepo.get(source === 'krx' ? KRX_ERROR_KEY : ECOS_ERROR_KEY);
    const isStale = lastSuccessAt === null || this.now().getTime() - lastSuccessAt >= STALE_MS;
    return {
      isAvailable: available,
      isStale,
      lastSuccessAt,
      lastError,
    };
  }

  private recordSuccess(source: 'krx' | 'ecos'): void {
    const successKey = source === 'krx' ? KRX_SUCCESS_KEY : ECOS_SUCCESS_KEY;
    const errorKey = source === 'krx' ? KRX_ERROR_KEY : ECOS_ERROR_KEY;
    this.opts.settingsRepo.set(successKey, String(this.now().getTime()));
    this.opts.settingsRepo.delete(errorKey);
  }

  private recordError(source: 'krx' | 'ecos', message: string): void {
    const key = source === 'krx' ? KRX_ERROR_KEY : ECOS_ERROR_KEY;
    this.opts.settingsRepo.set(key, message.slice(0, 500));
    this.opts.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: `market-context.${source}.refresh-failed`,
      payload: { message: message.slice(0, 300) },
    });
  }

  private resolveMarket(pdno: string): KrxMarket | null {
    const sector = this.opts.stockMasterRepo.find(pdno)?.sector;
    if (sector === 'KOSPI' || sector === 'KOSDAQ' || sector === 'KONEX') return sector;
    return null;
  }

  private readMs(key: string): number | null {
    const raw = this.opts.settingsRepo.get(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }
}

function shiftDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function ymdCompact(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
