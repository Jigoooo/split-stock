import { trpc } from '@renderer/shared/api/trpc';
import type { CycleStatusFilter, TradeCycle } from '../model/types';

interface UseTradeCyclesOptions {
  accountId: number;
  pdno?: string;
  status: CycleStatusFilter;
}

interface UseTradeCyclesResult {
  cycles: TradeCycle[];
  isPending: boolean;
  error: { message: string } | null;
}

/**
 * 종목별 매매 사이클 조회.
 * - pdno 미지정 시 계좌의 모든 종목 반환.
 * - status: 'all' | 'open'(OPEN|BUYING) | 'closed'(SOLD).
 */
export function useTradeCycles(options: UseTradeCyclesOptions): UseTradeCyclesResult {
  const query = trpc.lots.cyclesByPdno.useQuery(
    {
      accountId: options.accountId,
      ...(options.pdno !== undefined ? { pdno: options.pdno } : {}),
      status: options.status,
    },
    {
      refetchInterval: 3000,
      staleTime: 0,
    },
  );

  return {
    cycles: (query.data?.cycles ?? []) as TradeCycle[],
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
  };
}
