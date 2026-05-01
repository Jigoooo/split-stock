import { and, asc, between, eq } from 'drizzle-orm';
import type { CsvColumn } from '../../shared/reporting/csv';
import { toCsv } from '../../shared/reporting/csv';
import type { Db } from '../db/client';
import { eventLogs, lots, orders, trades } from '../db/schema';

export interface DailyReportInput {
  from: Date;
  to: Date;
}

export interface DailyReportSummary {
  from: Date;
  to: Date;
  totalTrades: number;
  soldLots: number;
  realizedPnlKrw: number;
  winRate: number;
  avgHoldingDays: number;
  maxDrawdownKrw: number;
}

interface SoldLot {
  nth: number;
  buyPrice: number;
  sellPrice: number | null;
  qty: number;
  boughtAt: Date;
  soldAt: Date | null;
}

function toKrw(value: number): number {
  return Math.round(value);
}

function computeSoldLotPnlKrw(lot: Pick<SoldLot, 'buyPrice' | 'sellPrice' | 'qty'>): number {
  if (lot.sellPrice === null) return 0;
  return toKrw((lot.sellPrice - lot.buyPrice) * lot.qty);
}

/**
 * 실현손익/승률/최대 drawdown 등 핵심 KPI 계산.
 * SOLD 상태 차수만 대상 (확정 거래).
 */
export function computeDailyReportFromLots(
  soldLots: SoldLot[],
  tradesCount: number,
  range: DailyReportInput,
): DailyReportSummary {
  const winners = soldLots.filter((l) => l.sellPrice !== null && l.sellPrice > l.buyPrice);
  const pnl = soldLots.reduce((sum, l) => sum + computeSoldLotPnlKrw(l), 0);
  const winRate = soldLots.length === 0 ? 0 : winners.length / soldLots.length;

  // 평균 보유일 — soldAt - boughtAt
  const holdingDays = soldLots
    .filter((l): l is SoldLot & { soldAt: Date } => l.soldAt !== null)
    .map((l) => (l.soldAt.getTime() - l.boughtAt.getTime()) / 86_400_000);
  const avgHoldingDays =
    holdingDays.length === 0 ? 0 : holdingDays.reduce((s, d) => s + d, 0) / holdingDays.length;

  // 최대 drawdown — 시간순 누적 손익 곡선의 peak→trough 최대 낙폭
  const sorted = [...soldLots]
    .filter(
      (l): l is SoldLot & { sellPrice: number; soldAt: Date } =>
        l.sellPrice !== null && l.soldAt !== null,
    )
    .sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime());
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const l of sorted) {
    cumulative += computeSoldLotPnlKrw(l);
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    from: range.from,
    to: range.to,
    totalTrades: tradesCount,
    soldLots: soldLots.length,
    realizedPnlKrw: pnl,
    winRate,
    avgHoldingDays,
    maxDrawdownKrw: maxDrawdown,
  };
}

/**
 * 일자별 누적 실현손익 포인트 — Reports 차트용.
 * SOLD 차수만 대상, soldAt 기준 일자(YYYY-MM-DD) 버킷팅 후 누적.
 */
export interface DailyPnlPoint {
  date: string;
  cumulativePnlKrw: number;
}

export function computeDailyPnlPoints(soldLots: SoldLot[]): DailyPnlPoint[] {
  const sorted = [...soldLots]
    .filter(
      (l): l is SoldLot & { sellPrice: number; soldAt: Date } =>
        l.sellPrice !== null && l.soldAt !== null,
    )
    .sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime());
  const dailyMap = new Map<string, number>();
  for (const l of sorted) {
    const date = l.soldAt.toISOString().slice(0, 10);
    const pnl = computeSoldLotPnlKrw(l);
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + pnl);
  }
  let cumulative = 0;
  const points: DailyPnlPoint[] = [];
  for (const [date, dailyPnl] of [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    cumulative += dailyPnl;
    points.push({ date, cumulativePnlKrw: cumulative });
  }
  return points;
}

/**
 * 차수(nth)별 손익 분포 — Reports 막대 차트용.
 * SOLD 차수만 대상, nth 별 그룹 후 (sellPrice - buyPrice) * qty 합산.
 */
export interface BarChartItem {
  nth: number;
  pnlKrw: number;
  tradeCount: number;
}

export function computePnlByLotNth(soldLots: SoldLot[]): BarChartItem[] {
  const grouped = new Map<number, { pnl: number; count: number }>();
  for (const l of soldLots) {
    if (l.sellPrice === null) continue;
    const pnl = computeSoldLotPnlKrw(l);
    const cur = grouped.get(l.nth) ?? { pnl: 0, count: 0 };
    grouped.set(l.nth, { pnl: cur.pnl + pnl, count: cur.count + 1 });
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([nth, v]) => ({ nth, pnlKrw: v.pnl, tradeCount: v.count }));
}

export function computePnlByLotNthFromDb(db: Db, range: DailyReportInput): BarChartItem[] {
  const soldRows = db
    .select({
      nth: lots.nth,
      buyPrice: lots.buyPrice,
      sellPrice: lots.sellPrice,
      qty: lots.qty,
      boughtAt: lots.boughtAt,
      soldAt: lots.soldAt,
    })
    .from(lots)
    .where(and(eq(lots.status, 'SOLD'), between(lots.soldAt, range.from, range.to)))
    .all();
  return computePnlByLotNth(
    soldRows.map((r) => ({
      nth: r.nth,
      buyPrice: r.buyPrice,
      sellPrice: r.sellPrice,
      qty: r.qty,
      boughtAt: r.boughtAt,
      soldAt: r.soldAt,
    })),
  );
}

/**
 * 일자별 승률 추이 — Reports 라인 차트용.
 * 일자 버킷팅 후 (winners / total) 계산. 거래 없는 날은 포인트 미생성.
 */
export interface WinRatePoint {
  date: string;
  winRate: number; // 0~1
  soldLots: number;
}

export function computeWinRateTimeline(soldLots: SoldLot[]): WinRatePoint[] {
  const grouped = new Map<string, { winners: number; total: number }>();
  for (const l of soldLots) {
    if (l.sellPrice === null || l.soldAt === null) continue;
    const date = l.soldAt.toISOString().slice(0, 10);
    const cur = grouped.get(date) ?? { winners: 0, total: 0 };
    const isWin = l.sellPrice > l.buyPrice;
    grouped.set(date, { winners: cur.winners + (isWin ? 1 : 0), total: cur.total + 1 });
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      winRate: v.total === 0 ? 0 : v.winners / v.total,
      soldLots: v.total,
    }));
}

export function computeWinRateTimelineFromDb(db: Db, range: DailyReportInput): WinRatePoint[] {
  const soldRows = db
    .select({
      nth: lots.nth,
      buyPrice: lots.buyPrice,
      sellPrice: lots.sellPrice,
      qty: lots.qty,
      boughtAt: lots.boughtAt,
      soldAt: lots.soldAt,
    })
    .from(lots)
    .where(and(eq(lots.status, 'SOLD'), between(lots.soldAt, range.from, range.to)))
    .all();
  return computeWinRateTimeline(
    soldRows.map((r) => ({
      nth: r.nth,
      buyPrice: r.buyPrice,
      sellPrice: r.sellPrice,
      qty: r.qty,
      boughtAt: r.boughtAt,
      soldAt: r.soldAt,
    })),
  );
}

export function computeDailyPnlPointsFromDb(db: Db, range: DailyReportInput): DailyPnlPoint[] {
  const soldRows = db
    .select({
      nth: lots.nth,
      buyPrice: lots.buyPrice,
      sellPrice: lots.sellPrice,
      qty: lots.qty,
      boughtAt: lots.boughtAt,
      soldAt: lots.soldAt,
    })
    .from(lots)
    .where(and(eq(lots.status, 'SOLD'), between(lots.soldAt, range.from, range.to)))
    .all();
  return computeDailyPnlPoints(
    soldRows.map((r) => ({
      nth: r.nth,
      buyPrice: r.buyPrice,
      sellPrice: r.sellPrice,
      qty: r.qty,
      boughtAt: r.boughtAt,
      soldAt: r.soldAt,
    })),
  );
}

export function computeDailyReport(db: Db, range: DailyReportInput): DailyReportSummary {
  const soldRows = db
    .select({
      nth: lots.nth,
      buyPrice: lots.buyPrice,
      sellPrice: lots.sellPrice,
      qty: lots.qty,
      boughtAt: lots.boughtAt,
      soldAt: lots.soldAt,
    })
    .from(lots)
    .where(and(eq(lots.status, 'SOLD'), between(lots.soldAt, range.from, range.to)))
    .all();

  const tradeRows = db
    .select({ id: trades.id })
    .from(trades)
    .where(between(trades.executedAt, range.from, range.to))
    .all();

  return computeDailyReportFromLots(
    soldRows.map((r) => ({
      nth: r.nth,
      buyPrice: r.buyPrice,
      sellPrice: r.sellPrice,
      qty: r.qty,
      boughtAt: r.boughtAt,
      soldAt: r.soldAt,
    })),
    tradeRows.length,
    range,
  );
}

export function exportTradesCsv(db: Db, range: DailyReportInput): string {
  const rows = db
    .select({
      id: trades.id,
      orderId: trades.orderId,
      qty: trades.qty,
      price: trades.price,
      executedAt: trades.executedAt,
      orderSide: orders.side,
      orderPdno: orders.pdno,
    })
    .from(trades)
    .leftJoin(orders, eq(trades.orderId, orders.id))
    .where(between(trades.executedAt, range.from, range.to))
    .orderBy(asc(trades.executedAt))
    .all();

  const columns: CsvColumn<(typeof rows)[number]>[] = [
    { key: 'executedAt', header: '체결시각', accessor: (r) => r.executedAt },
    { key: 'pdno', header: '종목코드', accessor: (r) => r.orderPdno },
    { key: 'side', header: '매매구분', accessor: (r) => r.orderSide },
    { key: 'qty', header: '수량', accessor: (r) => r.qty },
    { key: 'price', header: '단가', accessor: (r) => r.price },
    { key: 'orderId', header: '주문ID', accessor: (r) => r.orderId },
  ];
  return toCsv(rows, columns, { bom: true });
}

export function exportLotsCsv(db: Db, range: DailyReportInput): string {
  const rows = db
    .select()
    .from(lots)
    .where(between(lots.boughtAt, range.from, range.to))
    .orderBy(asc(lots.boughtAt))
    .all();

  const columns: CsvColumn<(typeof rows)[number]>[] = [
    { key: 'accountId', header: '계좌ID', accessor: (r) => r.accountId },
    { key: 'pdno', header: '종목코드', accessor: (r) => r.pdno },
    { key: 'nth', header: '차수', accessor: (r) => r.nth },
    { key: 'buyPrice', header: '매수가', accessor: (r) => r.buyPrice },
    { key: 'qty', header: '수량', accessor: (r) => r.qty },
    { key: 'status', header: '상태', accessor: (r) => r.status },
    { key: 'boughtAt', header: '매수시각', accessor: (r) => r.boughtAt },
    { key: 'sellPrice', header: '매도가', accessor: (r) => r.sellPrice },
    { key: 'soldAt', header: '매도시각', accessor: (r) => r.soldAt },
  ];
  return toCsv(rows, columns, { bom: true });
}

export interface EventsCsvFilter extends DailyReportInput {
  level?: 'INFO' | 'WARN' | 'ERROR';
  category?: 'AUTH' | 'ORDER' | 'FSM' | 'WS' | 'SYS';
}

export function exportEventsCsv(db: Db, filter: EventsCsvFilter): string {
  const baseRows = db
    .select()
    .from(eventLogs)
    .where(between(eventLogs.ts, filter.from, filter.to))
    .orderBy(asc(eventLogs.ts))
    .all();
  const filtered = baseRows
    .filter((r) => (filter.level ? r.level === filter.level : true))
    .filter((r) => (filter.category ? r.category === filter.category : true));

  const columns: CsvColumn<(typeof filtered)[number]>[] = [
    { key: 'ts', header: '시각', accessor: (r) => r.ts },
    { key: 'level', header: '레벨', accessor: (r) => r.level },
    { key: 'category', header: '카테고리', accessor: (r) => r.category },
    { key: 'message', header: '메시지', accessor: (r) => r.message },
    { key: 'payload', header: 'payload', accessor: (r) => r.payloadJson ?? '' },
  ];
  return toCsv(filtered, columns, { bom: true });
}
