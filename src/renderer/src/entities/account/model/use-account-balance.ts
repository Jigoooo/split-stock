import { trpc } from '@renderer/shared/api/trpc';

export interface AccountBalancePosition {
  code: string;
  name: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  evalAmount: number;
  pnlAmount: number;
  pnlRate: number;
}

export interface AccountBalanceData {
  positions: AccountBalancePosition[];
  deposit: number;
  totalEval: number;
}

export interface UseAccountBalanceResult {
  isPending: boolean;
  error: { message: string } | null;
  data: AccountBalanceData | null;
}

export function useAccountBalance(): UseAccountBalanceResult {
  const query = trpc.account.getBalance.useQuery();

  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    data: query.data
      ? {
          positions: query.data.positions,
          deposit: query.data.deposit,
          totalEval: query.data.totalEval,
        }
      : null,
  };
}
