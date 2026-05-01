import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { ALL_TRADE_HISTORY_COLS } from '../config/all-trade-history-cols';
import type { AllTradeHistoryRow } from '../lib/all-trade-history';

interface AllTradeHistoryTableProps {
  isPending: boolean;
  rows: AllTradeHistoryRow[];
}

export const AllTradeHistoryTable = ({
  isPending,
  rows,
}: AllTradeHistoryTableProps): ReactElement => (
  <TableGrid.Root
    variant="hts"
    stickyHeader
    horizontalScroll
    aria-label="모든 매매 내역 상세 목록"
    style={{ flex: 1, minHeight: 0 }}
  >
    <TableGrid.Header>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.nth} numeric>
        차수
      </TableGrid.Cell>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.date} className="date-time-cell">
        날짜
      </TableGrid.Cell>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.name}>종목명</TableGrid.Cell>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.qty} numeric>
        수량
      </TableGrid.Cell>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.buyPrice} numeric>
        매입단가
      </TableGrid.Cell>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.side}>매매구분</TableGrid.Cell>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.sellPrice} numeric>
        매도단가
      </TableGrid.Cell>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.pnl} numeric>
        평가손익
      </TableGrid.Cell>
      <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.pnlRate} numeric>
        수익률
      </TableGrid.Cell>
    </TableGrid.Header>
    <TableGrid.Body>
      {isPending && rows.length === 0 ? (
        <TableGrid.Row placeholder>
          <TableGrid.Cell className="muted">조회 중…</TableGrid.Cell>
        </TableGrid.Row>
      ) : rows.length === 0 ? (
        <TableGrid.Row placeholder>
          <TableGrid.Cell className="muted">매매 내역 없음</TableGrid.Cell>
        </TableGrid.Row>
      ) : (
        rows.map((row) => <AllTradeHistoryRowView key={row.key} row={row} />)
      )}
    </TableGrid.Body>
  </TableGrid.Root>
);

const AllTradeHistoryRowView = ({ row }: { row: AllTradeHistoryRow }): ReactElement => (
  <TableGrid.Row>
    <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.nth} numeric>
      {row.nthText}
    </TableGrid.Cell>
    <TableGrid.Cell
      width={ALL_TRADE_HISTORY_COLS.date}
      className="muted date-time-cell"
      title={row.dateTitleText}
    >
      {row.dateText}
    </TableGrid.Cell>
    <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.name}>{row.stockLabelText}</TableGrid.Cell>
    <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.qty} numeric>
      {row.qtyText}
    </TableGrid.Cell>
    <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.buyPrice} numeric>
      {row.buyPriceText}
    </TableGrid.Cell>
    <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.side}>{row.sideText}</TableGrid.Cell>
    <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.sellPrice} numeric>
      {row.sellPriceText}
    </TableGrid.Cell>
    <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.pnl} numeric className={row.pnlClassName}>
      {row.pnlText}
    </TableGrid.Cell>
    <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.pnlRate} numeric className={row.pnlClassName}>
      {row.pnlRateText}
    </TableGrid.Cell>
  </TableGrid.Row>
);
