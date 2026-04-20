import { trpc } from '@renderer/shared/api/trpc';
import type { SymbolMemo } from '../model/types';

interface UseSymbolMemoResult {
  memo: SymbolMemo;
  isPending: boolean;
  error: { message: string } | null;
}

/**
 * 종목 메모 조회.
 * 메모가 없으면 memo === null.
 */
export function useSymbolMemo(options: { pdno: string }): UseSymbolMemoResult {
  const query = trpc.symbolMemo.get.useQuery({ pdno: options.pdno });

  return {
    memo: query.data ?? null,
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
  };
}
