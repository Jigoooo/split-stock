import { useBalanceWithLots } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { useState, useTransition } from 'react';
import {
  type AllTradeHistoryRow,
  type AllTradeHistorySummary,
  buildTradeHistoryDayOptions,
  buildTradeHistoryRows,
  buildTradeHistorySummary,
  buildTradeHistoryYearOptions,
  createInitialTradeHistoryFilters,
  type DraftDay,
  type DraftFilters,
  getDaysInMonth,
  sortTradeHistoryLots,
  type TradeHistoryLot,
} from '../lib/all-trade-history';

export interface UseAllTradeHistoryResult {
  draft: DraftFilters;
  yearOptions: number[];
  dayOptions: number[];
  isApplying: boolean;
  isPending: boolean;
  error: { message: string } | null;
  summary: AllTradeHistorySummary;
  rows: AllTradeHistoryRow[];
  setSearch: (value: string) => void;
  setYear: (value: number) => void;
  setMonth: (value: number) => void;
  setDay: (value: DraftDay) => void;
  applyFilters: () => void;
}

export function useAllTradeHistory(accountId: number): UseAllTradeHistoryResult {
  const [draft, setDraft] = useState<DraftFilters>(() => createInitialTradeHistoryFilters());
  const [applied, setAppliedRaw] = useState<DraftFilters>(() => createInitialTradeHistoryFilters());
  const [isApplying, startTransition] = useTransition();
  const balance = useBalanceWithLots();

  const query = trpc.lots.tradeHistory.useQuery({
    accountId,
    year: applied.year,
    month: applied.month,
    ...(applied.day !== 'all' ? { day: applied.day } : {}),
    ...(applied.search.trim() !== '' ? { search: applied.search.trim() } : {}),
  });

  const priceByPdno: Record<string, number> = {};
  for (const position of balance.positions) {
    priceByPdno[position.code] = position.currentPrice;
  }

  const lots = sortTradeHistoryLots((query.data?.lots ?? []) as TradeHistoryLot[]);
  const summary = buildTradeHistorySummary(lots, priceByPdno);
  const rows = buildTradeHistoryRows(lots);
  const yearOptions = buildTradeHistoryYearOptions(draft.year);
  const dayOptions = buildTradeHistoryDayOptions(draft.year, draft.month);

  const setSearch = (value: string): void => {
    setDraft((prev) => ({ ...prev, search: value }));
  };
  const setYear = (value: number): void => {
    setDraft((prev) => {
      const maxDay = getDaysInMonth(value, prev.month);
      return {
        ...prev,
        year: value,
        day: prev.day === 'all' ? 'all' : Math.min(prev.day, maxDay),
      };
    });
  };
  const setMonth = (value: number): void => {
    setDraft((prev) => {
      const maxDay = getDaysInMonth(prev.year, value);
      return {
        ...prev,
        month: value,
        day: prev.day === 'all' ? 'all' : Math.min(prev.day, maxDay),
      };
    });
  };
  const setDay = (value: DraftDay): void => {
    setDraft((prev) => ({ ...prev, day: value }));
  };
  const applyFilters = (): void => {
    startTransition(() =>
      setAppliedRaw({
        ...draft,
        search: draft.search.trim(),
      }),
    );
  };

  return {
    draft,
    yearOptions,
    dayOptions,
    isApplying,
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    summary,
    rows,
    setSearch,
    setYear,
    setMonth,
    setDay,
    applyFilters,
  };
}
