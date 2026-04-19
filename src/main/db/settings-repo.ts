import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { settings } from './schema';

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get(key: string): string | null {
    const rows = this.db.select().from(settings).where(eq(settings.key, key)).all();
    return rows[0]?.value ?? null;
  }

  set(key: string, value: string): void {
    const existing = this.db.select().from(settings).where(eq(settings.key, key)).all();
    const now = new Date();
    if (existing.length > 0) {
      this.db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key)).run();
    } else {
      this.db.insert(settings).values({ key, value, updatedAt: now }).run();
    }
  }

  delete(key: string): void {
    this.db.delete(settings).where(eq(settings.key, key)).run();
  }

  list(): Array<{ key: string; value: string }> {
    return this.db.select({ key: settings.key, value: settings.value }).from(settings).all();
  }
}

export type ReorderMode = 'NONE' | 'MARKET' | 'LIMIT_AT_LAST_PRICE';

export const SETTING_KEYS = {
  LAST_ACTIVE_ENV: 'last_active_env',
  /** 미체결 자동 취소 활성화 여부 ('true'/'false'). */
  PENDING_CANCEL_ENABLED: 'pending_cancel_enabled',
  /** 미체결 지정가 주문 자동 취소 타임아웃 (분, 1~60). */
  PENDING_CANCEL_TIMEOUT_MIN: 'pending_cancel_timeout_min',
  /** 자동 취소 재시도 최대 횟수 (1~30) 또는 'unlimited'. */
  PENDING_CANCEL_MAX_RETRIES: 'pending_cancel_max_retries',
  /** 취소 후 재주문 모드: 'NONE'|'MARKET'|'LIMIT_AT_LAST_PRICE'. */
  PENDING_CANCEL_REORDER_MODE: 'pending_cancel_reorder_mode',
  /** 실 계좌 매입 수수료 (%) */
  FEES_REAL_BUY: 'fees.real.buy',
  /** 실 계좌 매도 수수료 (%) */
  FEES_REAL_SELL: 'fees.real.sell',
  /** 실 계좌 제세금 (%) */
  FEES_REAL_TAX: 'fees.real.tax',
  /** 모의 계좌 매입 수수료 (%) */
  FEES_MOCK_BUY: 'fees.mock.buy',
  /** 모의 계좌 매도 수수료 (%) */
  FEES_MOCK_SELL: 'fees.mock.sell',
  /** 모의 계좌 제세금 (%) */
  FEES_MOCK_TAX: 'fees.mock.tax',
  /** 지정가 매수 호가 자동 보정 전략: 'AGGRESSIVE'|'CONSERVATIVE'. */
  PRICE_CORRECTION_BUY: 'price_correction.buy',
  /** 지정가 매도 호가 자동 보정 전략: 'AGGRESSIVE'|'CONSERVATIVE'. */
  PRICE_CORRECTION_SELL: 'price_correction.sell',
} as const;

export const PENDING_CANCEL_DEFAULTS = {
  enabled: true,
  timeoutMin: 10,
  maxRetries: 5 as number | null,
  reorderMode: 'NONE' as ReorderMode,
} as const;

export type FeeEnv = 'real' | 'mock';

export const FEES_DEFAULTS = {
  real: { buy: 0.015, sell: 0.015, tax: 0.2 },
  mock: { buy: 0.35, sell: 0.35, tax: 0.2 },
} as const;

export function readFeesConfig(
  repo: SettingsRepo,
  env: FeeEnv,
): {
  buy: number;
  sell: number;
  tax: number;
} {
  const buyKey = env === 'real' ? SETTING_KEYS.FEES_REAL_BUY : SETTING_KEYS.FEES_MOCK_BUY;
  const sellKey = env === 'real' ? SETTING_KEYS.FEES_REAL_SELL : SETTING_KEYS.FEES_MOCK_SELL;
  const taxKey = env === 'real' ? SETTING_KEYS.FEES_REAL_TAX : SETTING_KEYS.FEES_MOCK_TAX;

  const defaults = FEES_DEFAULTS[env];

  const buyRaw = repo.get(buyKey);
  const buy = buyRaw !== null ? Number(buyRaw) : defaults.buy;

  const sellRaw = repo.get(sellKey);
  const sell = sellRaw !== null ? Number(sellRaw) : defaults.sell;

  const taxRaw = repo.get(taxKey);
  const tax = taxRaw !== null ? Number(taxRaw) : defaults.tax;

  return { buy, sell, tax };
}

export function readPendingCancelConfig(repo: SettingsRepo): {
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number | null;
  reorderMode: ReorderMode;
} {
  const enabledRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_ENABLED);
  const enabled = enabledRaw !== null ? enabledRaw === 'true' : PENDING_CANCEL_DEFAULTS.enabled;

  const minRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_TIMEOUT_MIN);
  const minutes = minRaw !== null ? Number(minRaw) : PENDING_CANCEL_DEFAULTS.timeoutMin;
  const clampedMin =
    Number.isFinite(minutes) && minutes >= 1 && minutes <= 60
      ? minutes
      : PENDING_CANCEL_DEFAULTS.timeoutMin;

  const retriesRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_MAX_RETRIES);
  let maxRetries: number | null;
  if (retriesRaw === null) {
    maxRetries = PENDING_CANCEL_DEFAULTS.maxRetries;
  } else if (retriesRaw === 'unlimited') {
    maxRetries = null;
  } else {
    const n = Number(retriesRaw);
    maxRetries = Number.isFinite(n) && n >= 1 && n <= 30 ? n : PENDING_CANCEL_DEFAULTS.maxRetries;
  }

  const reorderRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_REORDER_MODE);
  const validReorderModes: ReorderMode[] = ['NONE', 'MARKET', 'LIMIT_AT_LAST_PRICE'];
  const reorderMode: ReorderMode =
    reorderRaw !== null && validReorderModes.includes(reorderRaw as ReorderMode)
      ? (reorderRaw as ReorderMode)
      : PENDING_CANCEL_DEFAULTS.reorderMode;

  return { enabled, timeoutMs: clampedMin * 60_000, maxRetries, reorderMode };
}

export type PriceCorrectionStrategy = 'AGGRESSIVE' | 'CONSERVATIVE';

export const PRICE_CORRECTION_DEFAULTS = {
  buy: 'AGGRESSIVE' as PriceCorrectionStrategy,
  sell: 'AGGRESSIVE' as PriceCorrectionStrategy,
} as const;

export function readPriceCorrectionConfig(repo: SettingsRepo): {
  buy: PriceCorrectionStrategy;
  sell: PriceCorrectionStrategy;
} {
  const validStrategies: PriceCorrectionStrategy[] = ['AGGRESSIVE', 'CONSERVATIVE'];

  const buyRaw = repo.get(SETTING_KEYS.PRICE_CORRECTION_BUY);
  const buy: PriceCorrectionStrategy =
    buyRaw !== null && validStrategies.includes(buyRaw as PriceCorrectionStrategy)
      ? (buyRaw as PriceCorrectionStrategy)
      : PRICE_CORRECTION_DEFAULTS.buy;

  const sellRaw = repo.get(SETTING_KEYS.PRICE_CORRECTION_SELL);
  const sell: PriceCorrectionStrategy =
    sellRaw !== null && validStrategies.includes(sellRaw as PriceCorrectionStrategy)
      ? (sellRaw as PriceCorrectionStrategy)
      : PRICE_CORRECTION_DEFAULTS.sell;

  return { buy, sell };
}
