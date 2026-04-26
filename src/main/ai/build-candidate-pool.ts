import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lots as lotsTable, stockMaster, watchOrders } from '../db/schema';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import { screenMagicSplitFit } from './algo/screen-magic-split-fit';

export type CandidateSource = 'OWNED' | 'WATCH' | 'MANUAL' | 'AUTO';

export interface CandidatePoolInput {
  db: Db;
  accountId: number;
  /** 최종 후보 풀 max — LLM 토큰 비용 통제. 기본 30. */
  cap?: number;
  /**
   * 사용자가 stock-picker 등에서 직접 골라 추가한 pdno 목록 — 보유/감시에 없어도 풀에 포함.
   * "관심은 있지만 아직 안 산 종목" 추천 가능하게 함.
   */
  extraPdnos?: ReadonlyArray<string>;
  /**
   * D 풀(자동 발굴) 활성화 — A∪B∪C 외에도 매직스플릿 사전 스크리닝 통과 종목을 합집합.
   * 기본 false. 모달 토글로 사용자가 켤 수 있음.
   */
  includeAutoDiscovery?: boolean;
  /** D 풀 스크리닝에 사용할 daily candles repo — includeAutoDiscovery=true 일 때만 필요. */
  candlesRepo?: DailyCandlesRepo;
  /** D 풀 cap — 자동 발굴된 종목 수 상한. 기본 50 (이후 cap 으로 또 잘림). */
  autoCap?: number;
}

export interface CandidateEntry {
  pdno: string;
  name: string;
  sources: ReadonlyArray<CandidateSource>;
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
  const map = new Map<string, { name: string; sources: Set<CandidateSource> }>();

  const addPdno = (pdno: string, source: CandidateSource): void => {
    if (!map.has(pdno)) {
      map.set(pdno, { name: pdno, sources: new Set([source]) });
    } else {
      map.get(pdno)?.sources.add(source);
    }
  };

  // 보유 종목 (OPEN/BUYING).
  const ownedRows = input.db
    .selectDistinct({ pdno: lotsTable.pdno })
    .from(lotsTable)
    .where(and(eq(lotsTable.accountId, input.accountId), ne(lotsTable.status, 'SOLD')))
    .all();
  for (const row of ownedRows) addPdno(row.pdno, 'OWNED');

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
  for (const row of watchRows) addPdno(row.pdno, 'WATCH');

  // 사용자가 직접 추가한 pdno (stock-picker 등) — 6자리 검증 + dedupe.
  if (input.extraPdnos && input.extraPdnos.length > 0) {
    for (const raw of input.extraPdnos) {
      const pdno = raw.padStart(6, '0');
      if (!/^\d{6}$/.test(pdno)) continue;
      addPdno(pdno, 'MANUAL');
    }
  }

  // D 풀 — 매직스플릿 사전 스크리닝 통과 종목 자동 발굴.
  // A∪B∪C 와 중복은 자동 dedupe. 결정론 알고리즘이라 LLM 호출 0회.
  if (input.includeAutoDiscovery && input.candlesRepo) {
    const exclude = new Set(map.keys());
    const screened = screenMagicSplitFit({
      db: input.db,
      candlesRepo: input.candlesRepo,
      cap: input.autoCap ?? 50,
      excludePdnos: exclude,
    });
    for (const s of screened) addPdno(s.pdno, 'AUTO');
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
