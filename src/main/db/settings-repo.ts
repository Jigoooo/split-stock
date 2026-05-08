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

export { BACKUP_AUTO_DEFAULTS, readBackupAutoConfig } from './settings-backup';
export type { CatchUpPendingBatch, CatchUpPendingItem } from './settings-catch-up';
export {
  clearCatchUpPending,
  readCatchUpPending,
  writeCatchUpPending,
} from './settings-catch-up';
export type {
  BalanceStageCellMode,
  CrosshairModeType,
  CrosshairSettings,
  DisplaySettings,
  LineStyleType,
  MaSettings,
  VolumeSettings,
} from './settings-display';
export { DISPLAY_DEFAULTS, readDisplayConfig } from './settings-display';
export type { FeeEnv } from './settings-fees';
export { FEES_DEFAULTS, readFeesConfig } from './settings-fees';
export type { ReorderMode } from './settings-keys';
export { SETTING_KEYS, watchGlobalEnabledKey } from './settings-keys';
export { PENDING_CANCEL_DEFAULTS, readPendingCancelConfig } from './settings-pending-cancel';
export type { PriceCorrectionStrategy } from './settings-price-correction';
export {
  PRICE_CORRECTION_DEFAULTS,
  readPriceCorrectionConfig,
} from './settings-price-correction';
export type { RealtimeConfig } from './settings-realtime';
export { REALTIME_DEFAULTS, readRealtimeConfig } from './settings-realtime';
export { readSafetyMaster, writeSafetyMaster } from './settings-safety';
export { readWatchGlobalEnabled } from './settings-watch';
