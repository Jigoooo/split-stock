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

export const SETTING_KEYS = {
  LAST_ACTIVE_ENV: 'last_active_env',
  /** 미체결 지정가 주문 자동 취소 타임아웃 (분, 1~60). */
  PENDING_CANCEL_TIMEOUT_MIN: 'pending_cancel_timeout_min',
  /** 자동 취소 재시도 최대 횟수 (1~30) 또는 'unlimited'. */
  PENDING_CANCEL_MAX_RETRIES: 'pending_cancel_max_retries',
} as const;

export const PENDING_CANCEL_DEFAULTS = {
  timeoutMin: 10,
  maxRetries: 5 as number | null,
} as const;

export function readPendingCancelConfig(repo: SettingsRepo): {
  timeoutMs: number;
  maxRetries: number | null;
} {
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

  return { timeoutMs: clampedMin * 60_000, maxRetries };
}
