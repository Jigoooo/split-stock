import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useState } from 'react';

export const DEFAULT_DEBOUNCE_MS = 300;
export const DEFAULT_PAGE_SIZE = 60;

export interface StockListEntry {
  pdno: string;
  name: string;
  sector: string | null;
}

export interface UseStockListResult {
  /** 모든 페이지의 플래튼 결과 */
  entries: StockListEntry[];
  /** 서버 기준 전체 매칭 개수 (첫 페이지 기준) */
  total: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  error: { message: string } | null;
  /** debounce 후 실제 서버에 보낸 키워드 */
  debouncedKeyword: string;
}

/**
 * 종목 마스터 무한스크롤 훅.
 * - keyword 입력 debounce 후 listStock.useInfiniteQuery 호출
 * - keyword가 바뀌면 TanStack Query가 cursor를 리셋해 1페이지부터 다시 로드
 */
export function useStockList(
  keyword: string,
  opts: { debounceMs?: number; pageSize?: number } = {},
): UseStockListResult {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const [debounced, setDebounced] = useState(keyword);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(keyword), debounceMs);
    return () => clearTimeout(handle);
  }, [keyword, debounceMs]);

  const trimmed = debounced.trim();
  const query = trpc.market.listStock.useInfiniteQuery(
    { keyword: trimmed || undefined, limit: pageSize },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: 0,
    },
  );

  const pages = query.data?.pages ?? [];
  const entries = pages.flatMap((p) => p.entries);
  const total = pages[0]?.total ?? 0;

  return {
    entries,
    total,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    fetchNextPage: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
    },
    error: query.error ? { message: query.error.message } : null,
    debouncedKeyword: trimmed,
  };
}
