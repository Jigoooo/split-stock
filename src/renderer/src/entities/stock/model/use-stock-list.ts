import { trpc } from '@renderer/shared/api/trpc';
import { createKoreanSearchRegex } from '@renderer/shared/lib/search';
import { useDeferredValue } from 'react';

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
  const deferredKeyword = useDeferredValue(keyword);
  const all = query.data?.entries ?? [];
  const trimmed = deferredKeyword.trim();
  const regex = trimmed ? createKoreanSearchRegex(trimmed) : null;
  const entries =
    regex?.source && regex.source !== '(?:)'
      ? all.filter((entry) => regex.test(entry.name) || entry.pdno.includes(trimmed))
      : all;

  return {
    entries,
    total: all.length,
    isLoading: query.isLoading,
    error: query.error ? { message: query.error.message } : null,
  };
}
