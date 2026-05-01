import type { WatchOrder } from '@renderer/entities/watch-order';
import { formatStockLabel, thousandSeparator } from '@renderer/shared/lib/formatter';
import { Checkbox, TableGrid } from '@renderer/shared/ui';
import type { MouseEvent, ReactElement } from 'react';
import {
  formatWatchDate,
  formatWatchDateTitle,
  sourceLabel,
  statusLabel,
} from '../lib/watch-list-format';
import { WATCH_TABLE_COLS } from './watch-table-columns';

interface WatchListRowProps {
  allowMutations: boolean;
  onContextMenu: (event: React.MouseEvent, fallbackId: number) => void;
  onToggle: (id: number) => void;
  order: WatchOrder;
  selected: boolean;
  stockName: string | null;
}

function statusClass(status: WatchOrder['status']): string {
  return `watch-order-row watch-order-row--${status.toLowerCase()}`;
}

export const WatchListRow = ({
  allowMutations,
  onContextMenu,
  onToggle,
  order,
  selected,
  stockName,
}: WatchListRowProps): ReactElement => {
  const handleRowClick = (event: MouseEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('.hts-choice')) return;
    onToggle(order.id);
  };
  const rowInteractionProps = allowMutations
    ? {
        onClick: handleRowClick,
        onContextMenu: (event: MouseEvent<HTMLDivElement>) => onContextMenu(event, order.id),
      }
    : {};
  const stockLabel = formatStockLabel(stockName, order.pdno);

  return (
    <TableGrid.Row
      selected={allowMutations && selected}
      className={statusClass(order.status)}
      {...rowInteractionProps}
    >
      {allowMutations ? (
        <TableGrid.Cell width={WATCH_TABLE_COLS.select}>
          <Checkbox
            checked={selected}
            onChange={() => onToggle(order.id)}
            aria-label={`자동감시 ${stockLabel} 선택`}
            dense
          />
        </TableGrid.Cell>
      ) : null}
      <TableGrid.Cell width={WATCH_TABLE_COLS.stock} title={stockLabel}>
        {stockLabel}
      </TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.source}>{sourceLabel(order.source)}</TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.targetPrice} numeric>
        {thousandSeparator(order.targetPrice)}
      </TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.orderBasis} numeric>
        {order.qtyOrAmountMode === 'QTY'
          ? `${thousandSeparator(order.qty ?? 0)}주`
          : `${thousandSeparator(order.amountKrw ?? 0)}원`}
      </TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.orderType}>{order.orderType}</TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.status}>{statusLabel(order.status)}</TableGrid.Cell>
      <TableGrid.Cell
        width={WATCH_TABLE_COLS.createdAt}
        className="muted date-time-cell"
        title={formatWatchDateTitle(order.createdAt)}
      >
        {formatWatchDate(order.createdAt)}
      </TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.failureReason} className="muted">
        {order.lastFailureReason ?? ''}
      </TableGrid.Cell>
    </TableGrid.Row>
  );
};
