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
  const pnl = soldLots.reduce((sum, l) => {
    if (l.sellPrice === null) return sum;
    return sum + (l.sellPrice - l.buyPrice) * l.qty;
  }, 0);
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
    cumulative += (l.sellPrice - l.buyPrice) * l.qty;
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
