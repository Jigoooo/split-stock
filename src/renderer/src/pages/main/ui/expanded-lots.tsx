import type { LotEntry } from '@renderer/entities/account';
import {
  formatDateOnly,
  formatDateTimeLongKo,
  thousandSeparator,
} from '@renderer/shared/lib/formatter';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { formatKrw } from '../lib/position-row-format';

interface ExpandedLotsProps {
  lots: LotEntry[];
}

const EXPANDED_LOTS_COLS = {
  nth: '5.2rem',
  buyPrice: '10rem',
  qty: '8rem',
  amount: '12rem',
  status: '9.6rem',
  boughtAt: '11.6rem',
} as const;

export const ExpandedLots = ({ lots }: ExpandedLotsProps): ReactElement => {
  if (lots.length === 0) {
    return (
      <div
        className="muted"
        style={{
          padding: '0.4rem 1rem',
          fontSize: '1.05rem',
          background: 'var(--hts-accent-bg, rgba(0,0,0,0.02))',
        }}
      >
        보유 차수 없음
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '0.45rem 0.7rem 0.65rem',
        background: 'linear-gradient(180deg, rgba(246,248,252,0.96), rgba(239,243,249,0.98))',
        borderTop: '1px solid var(--hts-line, rgba(0,0,0,0.06))',
        borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.1))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65)',
      }}
    >
      <TableGrid.Root
        variant="hts"
        stickyHeader={false}
        overlayScrollbar={false}
        horizontalScroll
        style={{ height: 'auto', width: '100%' }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.nth}>차수</TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.buyPrice} numeric>
            매입가
          </TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.qty} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.amount} numeric>
            투입금액
          </TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.status}>상태</TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.boughtAt} className="date-time-cell">
            매수일
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {lots.map((lot) => (
            <TableGrid.Row key={`${lot.nth}-${lot.boughtAt}`}>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.nth}>{lot.nth}차</TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.buyPrice} numeric>
                {formatKrw(lot.buyPrice)}
              </TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.qty} numeric>
                {thousandSeparator(lot.qty)}
              </TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.amount} numeric>
                {thousandSeparator(Math.round(lot.amountKrw))}
              </TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.status}>{lot.status}</TableGrid.Cell>
              <TableGrid.Cell
                width={EXPANDED_LOTS_COLS.boughtAt}
                className="muted date-time-cell"
                title={formatDateTimeLongKo(lot.boughtAt)}
              >
                {formatDateOnly(lot.boughtAt)}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
        </TableGrid.Body>
      </TableGrid.Root>
    </div>
  );
};
