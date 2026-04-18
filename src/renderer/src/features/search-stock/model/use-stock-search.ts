import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useState } from 'react';

export const DEFAULT_DEBOUNCE_MS = 400;

export interface StockHit {
  pdno: string;
  name: string;
  sector: string | null;
}

export interface UseStockSearchResult {
  results: StockHit[];
  isLoading: boolean;
  error: { message: string } | null;
  debouncedTerm: string;
}

/**
 * 입력어 debounce 후 trpc.market.searchStock 호출.
 * - term.trim().length === 0 이면 쿼리 disabled (빈 상태)
 * - debounce 대기 중에는 이전 결과 유지 (flicker 방지)
 */
export function useStockSearch(
  term: string,
  opts: { debounceMs?: number; limit?: number } = {},
): UseStockSearchResult {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const [debounced, setDebounced] = useState(term);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(term), debounceMs);
    return () => clearTimeout(handle);
  }, [term, debounceMs]);

  const trimmed = debounced.trim();
  const enabled = trimmed.length > 0;
  const query = trpc.market.searchStock.useQuery(
    { term: trimmed || 'x', limit: opts.limit ?? 20 },
    { enabled },
  );

  return {
    results: enabled ? (query.data?.entries ?? []).map(toHit) : [],
    isLoading: enabled && query.isLoading,
    error: query.error ? { message: query.error.message } : null,
    debouncedTerm: trimmed,
  };
}

function toHit(e: { pdno: string; name: string; sector: string | null }): StockHit {
  return { pdno: e.pdno, name: e.name, sector: e.sector };
}
