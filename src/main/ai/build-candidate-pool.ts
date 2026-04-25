import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lots as lotsTable, stockMaster, watchOrders } from '../db/schema';

export interface CandidatePoolInput {
  db: Db;
  accountId: number;
  /** 최종 후보 풀 max — LLM 토큰 비용 통제. 기본 30. */
  cap?: number;
}

export interface CandidateEntry {
  pdno: string;
  name: string;
  sources: ReadonlyArray<'OWNED' | 'WATCH'>;
}

/**
 * AI 종목 추천을 위한 후보 풀 자동 조립.
 *
 * - OWNED: lots 테이블의 status=OPEN unique pdno (사용자가 들고 있는 종목)
 * - WATCH: watch_orders 테이블의 active(true) unique pdno (사용자가 자동감시 등록한 종목)
 *
 * 두 소스를 dedupe 한 뒤 cap(기본 30) 으로 자른다. 풀이 비면 빈 배열 반환 — 라우터에서 안내.
 *
 * 의도적 단순화:
 *   - 시총 상위 N 추가 X — KIS API 호출이 필요해 별도 파이프라인 필요. Phase 2 이후 확장.
 *   - 가격/거래량/변동성 같은 통계는 symbol-stats 가 별도 책임.
 */
export function buildCandidatePool(input: CandidatePoolInput): CandidateEntry[] {
  const cap = Math.max(1, input.cap ?? 30);
  const map = new Map<string, { name: string; sources: Set<'OWNED' | 'WATCH'> }>();

  // 보유 종목 (OPEN/BUYING).
  const ownedRows = input.db
    .selectDistinct({ pdno: lotsTable.pdno })
    .from(lotsTable)
    .where(and(eq(lotsTable.accountId, input.accountId), ne(lotsTable.status, 'SOLD')))
    .all();
  for (const row of ownedRows) {
    if (!map.has(row.pdno)) {
      map.set(row.pdno, { name: row.pdno, sources: new Set(['OWNED']) });
    } else {
      map.get(row.pdno)?.sources.add('OWNED');
    }
  }

  // 자동감시 종목 (활성 = status WATCHING/PAUSED).
  const watchRows = input.db
    .selectDistinct({ pdno: watchOrders.pdno })
    .from(watchOrders)
    .where(
      and(
        eq(watchOrders.accountId, input.accountId),
        inArray(watchOrders.status, ['WATCHING', 'PAUSED']),
      ),
    )
    .all();
  for (const row of watchRows) {
    if (!map.has(row.pdno)) {
      map.set(row.pdno, { name: row.pdno, sources: new Set(['WATCH']) });
    } else {
      map.get(row.pdno)?.sources.add('WATCH');
    }
  }

  if (map.size === 0) return [];

  // 종목명을 stock_master 에서 lookup (있으면 한국어명으로 보강).
  const pdnoArr = Array.from(map.keys());
  const names = input.db
    .select({ pdno: stockMaster.pdno, name: stockMaster.name })
    .from(stockMaster)
    .where(inArray(stockMaster.pdno, pdnoArr))
    .all();
  for (const n of names) {
    const entry = map.get(n.pdno);
    if (entry && n.name) entry.name = n.name;
  }

  return Array.from(map.entries())
    .slice(0, cap)
    .map(([pdno, v]) => ({ pdno, name: v.name, sources: Array.from(v.sources) }));
}
