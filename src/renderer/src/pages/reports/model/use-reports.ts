import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export type CsvKind = 'trades' | 'lots' | 'events';

export interface ReportSummary {
  realizedPnlKrw: number;
  winRate: number;
  maxDrawdownKrw: number;
  soldLots: number;
  totalTrades: number;
  avgHoldingDays: number;
}

export interface DailyPnlPoint {
  date: string;
  cumulativePnlKrw: number;
}

export interface LotNthBar {
  nth: number;
  pnlKrw: number;
  tradeCount: number;
}

export interface WinRatePoint {
  date: string;
  winRate: number;
  soldLots: number;
}

export interface UseReportsResult {
  fromStr: string;
  setFromStr: (value: string) => void;
  toStr: string;
  setToStr: (value: string) => void;
  summaryPending: boolean;
  summaryError: { message: string } | null;
  summary: ReportSummary | null;
  dailyPnlPending: boolean;
  dailyPnlError: { message: string } | null;
  dailyPnlPoints: DailyPnlPoint[];
  pnlByLotNthPending: boolean;
  pnlByLotNthError: { message: string } | null;
  pnlByLotNth: LotNthBar[];
  winRateTimelinePending: boolean;
  winRateTimelineError: { message: string } | null;
  winRateTimeline: WinRatePoint[];
  exportCsv: (kind: CsvKind) => Promise<{ csv: string; filename: string }>;
}

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useReports(): UseReportsResult {
  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const [fromStr, setFromStr] = useState(toISODate(oneMonthAgo));
  const [toStr, setToStr] = useState(toISODate(today));

  const range = {
    from: new Date(`${fromStr}T00:00:00Z`),
    to: new Date(`${toStr}T23:59:59Z`),
  };

  const summaryQuery = trpc.reports.getSummary.useQuery(range);
  const dailyPnlQuery = trpc.reports.getDailyPnl.useQuery(range);
  const pnlByLotNthQuery = trpc.reports.getPnlByLotNth.useQuery(range);
  const winRateTimelineQuery = trpc.reports.getWinRateTimeline.useQuery(range);
  const utils = trpc.useUtils();

  const exportCsv = async (kind: CsvKind): Promise<{ csv: string; filename: string }> => {
    const result = await utils.reports.exportCsv.fetch({ ...range, kind });
    return {
      csv: result.csv,
      filename: `${kind}-${fromStr}_${toStr}.csv`,
    };
  };

  return {
    fromStr,
    setFromStr,
    toStr,
    setToStr,
    summaryPending: summaryQuery.isPending,
    summaryError: summaryQuery.error ? { message: summaryQuery.error.message } : null,
    summary: summaryQuery.data ?? null,
    dailyPnlPending: dailyPnlQuery.isPending,
    dailyPnlError: dailyPnlQuery.error ? { message: dailyPnlQuery.error.message } : null,
    dailyPnlPoints: dailyPnlQuery.data?.points ?? [],
    pnlByLotNthPending: pnlByLotNthQuery.isPending,
    pnlByLotNthError: pnlByLotNthQuery.error ? { message: pnlByLotNthQuery.error.message } : null,
    pnlByLotNth: pnlByLotNthQuery.data?.items ?? [],
    winRateTimelinePending: winRateTimelineQuery.isPending,
    winRateTimelineError: winRateTimelineQuery.error
      ? { message: winRateTimelineQuery.error.message }
      : null,
    winRateTimeline: winRateTimelineQuery.data?.points ?? [],
    exportCsv,
  };
}
