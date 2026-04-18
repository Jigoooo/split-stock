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
}

export const SETTING_KEYS = {
  LAST_ACTIVE_ENV: 'last_active_env',
} as const;
