import { type CycleStatusFilter, useTradeCycles } from '@renderer/entities/trade-cycle';
import {
  formatDateOnly,
  formatDateTimeLongKo,
  formatStockLabel,
  thousandSeparator,
} from '@renderer/shared/lib/formatter';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

export interface TradeHistoryListProps {
  accountId: number;
  pdno: string | null;
  status: CycleStatusFilter;
}

const TRADE_HISTORY_COLS = {
  nth: '5.2rem',
  symbol: '17.6rem',
  buyPrice: '9.6rem',
  qty: '8.4rem',
  sellPrice: '9.6rem',
  pnl: '10.4rem',
  pnlRate: '8.8rem',
  status: '8.8rem',
  boughtAt: '11.6rem',
  soldAt: '11.6rem',
} as const;

/**
 * 매매 사이클 리스트 — 종목별/전체 진행중/종료/전체.
 *
 * 표시 컬럼: 차수 / 종목 / 매수가 / 수량 / 매도가 / 손익 / 수익률 / 상태 / 매수일 / 매도일
 *
 * useTradeCycles 가 pdno 미지정 시 계좌 전체 사이클을 반환.
 */
export const TradeHistoryList = (props: TradeHistoryListProps): ReactElement => {
  const { accountId, pdno, status } = props;
  const { cycles, error, isPending } = useTradeCycles(
    pdno !== null ? { accountId, pdno, status } : { accountId, status },
  );
  const showSymbolColumn = pdno === null;

  return (
    <TableGrid.Root
      variant="hts"
      stickyHeader
      horizontalScroll
      aria-label={pdno ? `${pdno} 매매 사이클` : '전체 매매 사이클'}
      style={{ flex: 1, minHeight: 0 }}
    >
      {error ? (
        <div className="chip chip--down" role="alert" style={{ margin: '0.5rem' }}>
          {error.message}
        </div>
      ) : null}
      <TableGrid.Header>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.nth} numeric>
          차수
        </TableGrid.Cell>
        {showSymbolColumn ? (
          <TableGrid.Cell width={TRADE_HISTORY_COLS.symbol}>종목</TableGrid.Cell>
        ) : null}
        <TableGrid.Cell width={TRADE_HISTORY_COLS.buyPrice} numeric>
          매수가
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.qty} numeric>
          수량
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.sellPrice} numeric>
          매도가
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.pnl} numeric>
          손익
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.pnlRate} numeric>
          수익률
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.status}>상태</TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.boughtAt} className="muted date-time-cell">
          매수일
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.soldAt} className="muted date-time-cell">
          매도일
        </TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body>
        {isPending ? (
          <TableGrid.Row placeholder>
            <TableGrid.Cell className="muted">로드 중…</TableGrid.Cell>
          </TableGrid.Row>
        ) : cycles.length === 0 ? (
          <TableGrid.Row placeholder>
            <TableGrid.Cell className="muted">사이클 없음</TableGrid.Cell>
          </TableGrid.Row>
        ) : (
          cycles.map((cycle) => {
            const pnl = cycle.pnl;
            const sign = pnl === undefined ? 'flat' : pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'flat';
            const cls = sign === 'up' ? 'num-up' : sign === 'down' ? 'num-down' : 'num-flat';
            return (
              <TableGrid.Row key={cycle.id}>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.nth} numeric>
                  {cycle.nth}차
                </TableGrid.Cell>
                {showSymbolColumn ? (
                  <TableGrid.Cell width={TRADE_HISTORY_COLS.symbol}>
                    {formatStockLabel(cycle.name, cycle.pdno)}
                  </TableGrid.Cell>
                ) : null}
                <TableGrid.Cell width={TRADE_HISTORY_COLS.buyPrice} numeric>
                  {formatKrw(cycle.buyPrice)}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.qty} numeric>
                  {thousandSeparator(cycle.qty)}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.sellPrice} numeric>
                  {cycle.sellPrice !== undefined ? formatKrw(cycle.sellPrice) : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.pnl} numeric className={cls}>
                  {pnl !== undefined ? formatSigned(Math.round(pnl)) : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.pnlRate} numeric className={cls}>
                  {cycle.pnlRate !== undefined ? `${cycle.pnlRate.toFixed(2)}%` : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.status}>{cycle.status}</TableGrid.Cell>
                <TableGrid.Cell
                  width={TRADE_HISTORY_COLS.boughtAt}
                  className="muted date-time-cell"
                  title={formatDateTimeLongKo(cycle.boughtAt)}
                >
                  {formatDateOnly(cycle.boughtAt)}
                </TableGrid.Cell>
                <TableGrid.Cell
                  width={TRADE_HISTORY_COLS.soldAt}
                  className="muted date-time-cell"
                  {...(cycle.soldAt !== undefined
                    ? { title: formatDateTimeLongKo(cycle.soldAt) }
                    : {})}
                >
                  {cycle.soldAt !== undefined ? formatDateOnly(cycle.soldAt) : '-'}
                </TableGrid.Cell>
              </TableGrid.Row>
            );
          })
        )}
      </TableGrid.Body>
    </TableGrid.Root>
  );
};

function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${thousandSeparator(value)}`;
}

function formatKrw(value: number): string {
  return thousandSeparator(Math.round(value));
}
