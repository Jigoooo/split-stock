import { type DomesticBroker, isDomesticBroker } from '@shared/contracts';
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { accounts } from './schema';

/**
 * Phase 6 follow-up (H1/H2 fix): 도메스틱 broker 단일 출처 helper.
 *
 * accounts.broker 가 KIS/KIWOOM 일 때 broker string 반환. 미존재 / UPBIT / 미인식 broker 면 null.
 * watchOrders / orders INSERT 시 broker 컬럼 결정에 사용. silent KIS fallback 금지 — caller 가
 * null 을 명시적 에러 (NOT_FOUND) 로 처리하도록 강제.
 */
export function getDomesticBrokerForAccount(db: Db, accountId: number): DomesticBroker | null {
  const row = db
    .select({ broker: accounts.broker })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();
  if (!row) return null;
  return isDomesticBroker(row.broker) ? row.broker : null;
}
