import { trpc } from '@renderer/shared/api/trpc';
import type { TimeWindow } from '../model/types';

export interface UseTradingWindowsResult {
  isPending: boolean;
  error: { message: string } | null;
  windows: TimeWindow[];
}

/**
 * 계좌별 매매 시간대 슬롯 목록.
 * accountId가 null이면 빈 결과를 반환한다.
 */
export function useTradingWindows(accountId: number | null): UseTradingWindowsResult {
  const query = trpc.tradingWindows.list.useQuery(
    { accountId: accountId ?? 0 },
    { enabled: accountId !== null },
  );
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    windows: (query.data?.windows ?? []) as TimeWindow[],
  };
}
