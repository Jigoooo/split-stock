import {
  type BalanceWithLotsPosition,
  type BalanceWithLotsStrategyMeta,
  type BalanceWithLotsSummary,
  type LotEntry,
  useBalanceWithLots,
} from '@renderer/entities/account';

export interface PositionsGridRow {
  position: BalanceWithLotsPosition;
  lots: LotEntry[];
  /** 종목별 전략 maxStages — 없으면 0 (자동 OFF). */
  rowMaxStages: number;
  strategyMeta: BalanceWithLotsStrategyMeta | null;
}

export interface UsePositionsGridResult {
  isPending: boolean;
  error: { message: string } | null;
  mismatches: Array<{
    pdno: string;
    kisQty: number;
    lotQty: number;
    reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH';
  }>;
  rows: PositionsGridRow[];
  summary: BalanceWithLotsSummary;
  syncStatus: 'IN_SYNC' | 'MISMATCH';
  /** 그리드 전체 차수 컬럼 수 — 모든 rows 의 max 와 1 중 큰 값. 헤더/셀 컬럼 안정성 보장. */
  gridMaxStages: number;
}

/**
 * positions-grid 데이터 합성:
 *  - useBalanceWithLots 한 번만 호출 (positions+lots+strategies)
 *  - 행 단위 정규화 + 그리드 단위 maxStages 도출
 *  - 정렬은 서버 응답 순서 유지 (W6 에서 컬럼 정렬 추가 예정)
 */
export function usePositionsGrid(): UsePositionsGridResult {
  const {
    error,
    isPending,
    lotsByPdno,
    mismatches,
    positions,
    strategiesByPdno,
    summary,
    syncStatus,
  } = useBalanceWithLots();

  const rows: PositionsGridRow[] = positions.map((position) => ({
    position,
    lots: lotsByPdno[position.code] ?? [],
    rowMaxStages: strategiesByPdno[position.code]?.maxStages ?? 0,
    strategyMeta: strategiesByPdno[position.code] ?? null,
  }));

  // 그리드 전체 차수 컬럼 수 — 모든 rows 의 max(전략 maxStages, 보유 lot의 nth max) 중 max.
  // 행이 없으면 1 차로 fallback (헤더 자체는 항상 1차 노출).
  let gridMaxStages = 1;
  for (const row of rows) {
    if (row.rowMaxStages > gridMaxStages) gridMaxStages = row.rowMaxStages;
    for (const lot of row.lots) {
      if (lot.nth > gridMaxStages) gridMaxStages = lot.nth;
    }
  }

  return { error, gridMaxStages, isPending, mismatches, rows, summary, syncStatus };
}
