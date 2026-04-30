import { useBalanceWithLots, usePositionOverlay } from '@renderer/entities/account';
import { useStockList } from '@renderer/entities/stock';
import { trpc } from '@renderer/shared/api/trpc';
import type { MainSelectedStock } from './use-main-selection';

export interface MainSelectedEntry {
  pdno: string;
  name: string;
}

export function useMainTradingContext(
  selectedPdno: string | null,
  selectedStock: MainSelectedStock | null,
) {
  const envQuery = trpc.auth.getEnv.useQuery();
  const isProd = envQuery.data?.env === 'PROD';
  const balance = useBalanceWithLots();
  const stockList = useStockList('');
  const selectedPosition =
    selectedPdno !== null
      ? (balance.positions.find((position) => position.code === selectedPdno) ?? null)
      : null;
  const selectedEntry =
    selectedPdno !== null
      ? {
          pdno: selectedPdno,
          name:
            selectedStock?.name ??
            selectedPosition?.name ??
            stockList.entries.find((entry) => entry.pdno === selectedPdno)?.name ??
            selectedPdno,
        }
      : null;
  const tradeHistoryEntry =
    selectedEntry !== null && selectedPosition !== null
      ? { pdno: selectedEntry.pdno, name: selectedEntry.name }
      : null;
  const overlay = usePositionOverlay(selectedEntry?.pdno ?? null, { includeSold: true });

  return {
    isProd,
    overlayLines: overlay.lines,
    selectedEntry,
    tradeHistoryEntry,
  };
}
