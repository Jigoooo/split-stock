import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { eventLogs, watchOrders } from '../db/schema';
import {
  LEGACY_WATCH_CONTRACTION_REASON,
  quarantineLegacyWatchRows,
} from './watch-legacy-quarantine';

function seedWatch(
  db: ReturnType<typeof createTestDb>,
  input: Partial<typeof watchOrders.$inferInsert>,
): number {
  const row = db
    .insert(watchOrders)
    .values({
      accountId: 1,
      pdno: '005930',
      source: 'CUSTOM',
      side: 'BUY',
      targetPrice: 60_000,
      comparator: 'LTE',
      orderType: 'LIMIT',
      qtyOrAmountMode: 'QTY',
      qty: 10,
      amountKrw: null,
      nth: null,
      sourceRefId: null,
      expiresAt: null,
      status: 'WATCHING',
      lastFailureReason: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      executedAt: null,
      ...input,
    })
    .returning()
    .all()[0];
  if (!row) throw new Error('seed failed');
  return row.id;
}

describe('quarantineLegacyWatchRows', () => {
  it('active SELL/GTE row를 CANCELLED로 격리하고 audit event를 남긴다', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const logger = {
      log: vi.fn((entry) =>
        db
          .insert(eventLogs)
          .values({
            ts: new Date(),
            level: entry.level,
            category: entry.category,
            message: entry.message,
            payloadJson: JSON.stringify(entry.payload ?? null),
            auditPayload: null,
          })
          .run(),
      ),
    };

    const sellId = seedWatch(db, { side: 'SELL', comparator: 'GTE', status: 'WATCHING' });
    seedWatch(db, { side: 'BUY', comparator: 'LTE', status: 'WATCHING', pdno: '000660' });

    const quarantined = quarantineLegacyWatchRows(db, logger);
    expect(quarantined).toBe(1);

    const sellRow = db
      .select()
      .from(watchOrders)
      .all()
      .find((row) => row.id === sellId);
    expect(sellRow?.status).toBe('CANCELLED');
    expect(sellRow?.lastFailureReason).toBe(LEGACY_WATCH_CONTRACTION_REASON);

    const events = db.select().from(eventLogs).all();
    expect(events.some((event) => event.message === 'watch.legacy.quarantined')).toBe(true);
  });
});
