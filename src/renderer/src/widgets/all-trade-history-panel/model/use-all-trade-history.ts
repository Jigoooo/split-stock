import { useBalanceWithLots } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { useState, useTransition } from 'react';

type TradeHistoryStatus = 'OPEN' | 'BUYING' | 'SELLING' | 'SOLD';

interface TradeHistoryLot {
  id: number;
  pdno: string;
  name: string;
  nth: number;
  qty: number;
  amountKrw: number;
  status: TradeHistoryStatus;
  buyPrice: number;
  boughtAt: number;
  soldAt?: number;
  sellPrice?: number;
}

type DraftDay = number | 'all';

interface DraftFilters {
  search: string;
  year: number;
  month: number;
  day: DraftDay;
}

export interface AllTradeHistorySummary {
  count: number;
  buyAmount: number;
  evaluationAmount: number;
  pnlAmount: number;
  pnlRate: number;
}

export interface AllTradeHistoryRow {
  key: string;
  nthText: string;
  dateText: string;
  nameText: string;
  pdnoText: string;
  qtyText: string;
  buyPriceText: string;
  sideText: '매수' | '매도';
  sellPriceText: string;
  pnlText: string;
  pnlRateText: string;
  pnlClassName: string;
}

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
  const initial = createInitialFilters();
  const [draft, setDraft] = useState<DraftFilters>(initial);
  const [applied, setAppliedRaw] = useState<DraftFilters>(initial);
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

  const lots = ((query.data?.lots ?? []) as TradeHistoryLot[]).slice().sort((a, b) => {
    const relevantA = a.soldAt ?? a.boughtAt;
    const relevantB = b.soldAt ?? b.boughtAt;
    if (relevantB !== relevantA) return relevantB - relevantA;
    if (a.pdno !== b.pdno) return a.pdno.localeCompare(b.pdno);
    return a.nth - b.nth;
  });

  const summary = buildSummary(lots, priceByPdno);
  const rows = buildRows(lots);
  const yearOptions = buildYearOptions(draft.year);
  const dayOptions = buildDayOptions(draft.year, draft.month);

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

function buildSummary(
  lots: TradeHistoryLot[],
  priceByPdno: Record<string, number>,
): AllTradeHistorySummary {
  let buyAmount = 0;
  let evaluationAmount = 0;
  let pnlAmount = 0;

  for (const lot of lots) {
    buyAmount += lot.amountKrw;
    const settledAmount =
      lot.status === 'SOLD'
        ? (lot.sellPrice ?? lot.buyPrice) * lot.qty
        : (priceByPdno[lot.pdno] ?? lot.buyPrice) * lot.qty;
    const pnl =
      lot.status === 'SOLD'
        ? settledAmount - lot.amountKrw
        : priceByPdno[lot.pdno] !== undefined
          ? settledAmount - lot.amountKrw
          : 0;
    const evaluation =
      lot.status === 'SOLD'
        ? settledAmount
        : priceByPdno[lot.pdno] !== undefined
          ? settledAmount
          : lot.amountKrw;

    evaluationAmount += evaluation;
    pnlAmount += pnl;
  }

  return {
    count: lots.length,
    buyAmount,
    evaluationAmount,
    pnlAmount,
    pnlRate: buyAmount > 0 ? (pnlAmount / buyAmount) * 100 : 0,
  };
}

function buildRows(lots: TradeHistoryLot[]): AllTradeHistoryRow[] {
  const rows: AllTradeHistoryRow[] = [];

  for (const lot of lots) {
    const nameText = lot.name !== '' ? lot.name : lot.pdno;
    const pdnoText = lot.name !== '' ? lot.pdno : '';
    rows.push({
      key: `${lot.id}:buy`,
      nthText: `${lot.nth}차`,
      dateText: formatDate(lot.boughtAt),
      nameText,
      pdnoText,
      qtyText: thousandSeparator(lot.qty),
      buyPriceText: thousandSeparator(lot.buyPrice),
      sideText: '매수',
      sellPriceText: '',
      pnlText: '',
      pnlRateText: '',
      pnlClassName: 'num-flat',
    });

    if (lot.status !== 'SOLD') continue;

    const realizedAmount = (lot.sellPrice ?? lot.buyPrice) * lot.qty;
    const pnl = realizedAmount - lot.amountKrw;
    const pnlRate = lot.amountKrw > 0 ? (pnl / lot.amountKrw) * 100 : 0;

    rows.push({
      key: `${lot.id}:sell`,
      nthText: `${lot.nth}차`,
      dateText: formatDate(lot.soldAt ?? lot.boughtAt),
      nameText,
      pdnoText,
      qtyText: thousandSeparator(lot.qty),
      buyPriceText: thousandSeparator(lot.buyPrice),
      sideText: '매도',
      sellPriceText: lot.sellPrice !== undefined ? thousandSeparator(lot.sellPrice) : '',
      pnlText: formatSigned(pnl),
      pnlRateText: `${pnlRate.toFixed(2)}%`,
      pnlClassName: getNumberClassName(pnl),
    });
  }
  return rows;
}

function createInitialFilters(): DraftFilters {
  const now = new Date();
  return {
    search: '',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: 'all',
  };
}

function buildYearOptions(anchorYear: number): number[] {
  return Array.from({ length: 7 }, (_, index) => anchorYear - index);
}

function buildDayOptions(year: number, month: number): number[] {
  return Array.from({ length: getDaysInMonth(year, month) }, (_, index) => index + 1);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatDate(epochMs: number): string {
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${thousandSeparator(Math.abs(value))}`;
}

function getNumberClassName(value: number): string {
  if (value > 0) return 'num-up';
  if (value < 0) return 'num-down';
  return 'num-flat';
}
