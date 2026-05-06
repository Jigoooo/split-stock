import { BROKERS } from '@shared/contracts';
import type { Db } from '../db/client';
import { accounts } from '../db/schema';

/**
 * Phase 7 test fixture: LotsRepo / WatchEngine 등이 accountId → accounts.broker 자동
 * resolve 하므로 테스트에서 사전 등록 필요. 기본 KIS, 필요 시 KIWOOM 별도 호출.
 */
export function seedDomesticAccounts(
  db: Db,
  ids: number[] = [1, 2, 3, 7, 99],
  broker: string = BROKERS.KIS,
): void {
  for (const id of ids) {
    db.insert(accounts)
      .values({
        id,
        env: 'MOCK',
        broker,
        accountNo8: `${id}`.padStart(8, '0'),
        accountProdCd: '01',
        createdAt: new Date(),
      })
      .run();
  }
}
