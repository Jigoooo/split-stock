import { and, eq, inArray, not, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { watchOrders } from '../db/schema';
import type { EventLogger } from '../logging/event-logger';

/** Phase R0: stock(KIS) watch_orders 만 quarantine 대상. UPBIT 는 별도 crypto-* 모듈. */
const STOCK_BROKER = 'KIS' as const;

export const LEGACY_WATCH_CONTRACTION_REASON =
  'LEGACY_RULE_NOT_SUPPORTED_AFTER_RESERVATION_BUY_CONTRACTION' as const;
export const BOOSTER_FEATURE_REMOVED_REASON = 'BOOSTER_FEATURE_REMOVED' as const;

/**
 * 예약매수 전용 계약으로 축소된 이후 더 이상 실행되면 안 되는 legacy 감시 row를
 * 엔진 부팅 전에 안전 종료한다.
 */
export function quarantineLegacyWatchRows(db: Db, logger: EventLogger): number {
  const rows = db
    .select()
    .from(watchOrders)
    .where(
      and(
        eq(watchOrders.broker, STOCK_BROKER),
        inArray(watchOrders.status, ['WATCHING', 'PAUSED']),
        legacyWatchCondition(),
      ),
    )
    .all();

  for (const row of rows) {
    const reason =
      row.source === 'BOOSTER' ? BOOSTER_FEATURE_REMOVED_REASON : LEGACY_WATCH_CONTRACTION_REASON;
    db.update(watchOrders)
      .set({
        status: 'CANCELLED',
        lastFailureReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(watchOrders.broker, STOCK_BROKER), eq(watchOrders.id, row.id)))
      .run();
    logger.log({
      level: 'WARN',
      category: 'WATCH',
      message: 'watch.legacy.quarantined',
      payload: {
        accountId: row.accountId,
        watchId: row.id,
        pdno: row.pdno,
        source: row.source,
        reason,
      },
    });
  }

  return rows.length;
}

function legacyWatchCondition() {
  return or(
    eq(watchOrders.source, 'BOOSTER'),
    or(not(eq(watchOrders.side, 'BUY')), not(eq(watchOrders.comparator, 'LTE'))),
  );
}
