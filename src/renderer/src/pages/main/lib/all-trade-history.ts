import {
  formatDateOnly,
  formatDateTimeLongKo,
  thousandSeparator,
} from '@renderer/shared/lib/formatter';

export type TradeHistoryStatus = 'OPEN' | 'BUYING' | 'SELLING' | 'SOLD';

export interface TradeHistoryLot {
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

export type DraftDay = number | 'all';

export interface DraftFilters {
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
  dateTitleText: string;
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

export function sortTradeHistoryLots(lots: readonly TradeHistoryLot[]): TradeHistoryLot[] {
  return [...lots].sort((a, b) => {
    const relevantA = a.soldAt ?? a.boughtAt;
    const relevantB = b.soldAt ?? b.boughtAt;
    if (relevantB !== relevantA) return relevantB - relevantA;
    if (a.pdno !== b.pdno) return a.pdno.localeCompare(b.pdno);
    return a.nth - b.nth;
  });
}

export function buildTradeHistorySummary(
  lots: readonly TradeHistoryLot[],
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

export function buildTradeHistoryRows(lots: readonly TradeHistoryLot[]): AllTradeHistoryRow[] {
  const rows: AllTradeHistoryRow[] = [];

  for (const lot of lots) {
    const nameText = lot.name !== '' ? lot.name : lot.pdno;
    const pdnoText = lot.name !== '' ? lot.pdno : '';
    rows.push({
      key: `${lot.id}:buy`,
      nthText: `${lot.nth}차`,
      dateText: formatDateOnly(lot.boughtAt),
      dateTitleText: formatDateTimeLongKo(lot.boughtAt),
      nameText,
      pdnoText,
      qtyText: thousandSeparator(lot.qty),
      buyPriceText: formatKrw(lot.buyPrice),
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
      dateText: formatDateOnly(lot.soldAt ?? lot.boughtAt),
      dateTitleText: formatDateTimeLongKo(lot.soldAt ?? lot.boughtAt),
      nameText,
      pdnoText,
      qtyText: thousandSeparator(lot.qty),
      buyPriceText: formatKrw(lot.buyPrice),
      sideText: '매도',
      sellPriceText: lot.sellPrice !== undefined ? formatKrw(lot.sellPrice) : '',
      pnlText: formatSignedKrw(pnl),
      pnlRateText: `${pnlRate.toFixed(2)}%`,
      pnlClassName: getNumberClassName(pnl),
    });
  }

  return rows;
}

export function createInitialTradeHistoryFilters(): DraftFilters {
  const now = new Date();
  return {
    search: '',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: 'all',
  };
}

export function buildTradeHistoryYearOptions(anchorYear: number): number[] {
  return Array.from({ length: 7 }, (_, index) => anchorYear - index);
}

export function buildTradeHistoryDayOptions(year: number, month: number): number[] {
  return Array.from({ length: getDaysInMonth(year, month) }, (_, index) => index + 1);
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatKrw(value: number): string {
  return thousandSeparator(Math.round(value));
}

function formatSignedKrw(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatKrw(Math.abs(value))}`;
}

function getNumberClassName(value: number): string {
  if (value > 0) return 'num-up';
  if (value < 0) return 'num-down';
  return 'num-flat';
}
