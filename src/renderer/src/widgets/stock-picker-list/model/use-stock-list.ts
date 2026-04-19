import { trpc } from '@renderer/shared/api/trpc';
import { createKoreanSearchRegex } from '@renderer/shared/lib/search';
import { useMemo } from 'react';

export interface StockListEntry {
  pdno: string;
  name: string;
  sector: string | null;
}

export interface UseStockListResult {
  entries: StockListEntry[];
  total: number;
  isLoading: boolean;
  error: { message: string } | null;
}

/**
 * 종목 마스터 전체를 한 번 받고 클라이언트에서 한글 퍼지/초성 필터링.
 * - 대용량이 아니므로(수천 건) staleTime을 길게 잡아 재요청 최소화
 * - keyword가 바뀌면 regex만 재계산, 네트워크 재요청 없음
 */
export function useStockList(keyword: string): UseStockListResult {
  const query = trpc.market.listAllStock.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });

  const all = query.data?.entries ?? [];

  const entries = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return all;
    const regex = createKoreanSearchRegex(trimmed);
    if (!regex.source || regex.source === '(?:)') return all;
    return all.filter((e) => regex.test(e.name) || e.pdno.includes(trimmed));
  }, [all, keyword]);

  return {
    entries,
    total: all.length,
    isLoading: query.isLoading,
    error: query.error ? { message: query.error.message } : null,
  };
}
