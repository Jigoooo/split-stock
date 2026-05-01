import type { WatchOrder } from '@renderer/entities/watch-order';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Checkbox, TableGrid } from '@renderer/shared/ui';
import type { MouseEvent, ReactElement } from 'react';
import {
  formatWatchDate,
  formatWatchDateTitle,
  sourceLabel,
  statusLabel,
} from '../lib/watch-list-format';

interface WatchListRowProps {
  allowMutations: boolean;
  onContextMenu: (event: React.MouseEvent, fallbackId: number) => void;
  onToggle: (id: number) => void;
  order: WatchOrder;
  selected: boolean;
  stockName: string | null;
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
  const stockLabel = stockName ? `${stockName} (${order.pdno})` : order.pdno;

  return (
    <TableGrid.Row selected={allowMutations && selected} {...rowInteractionProps}>
      {allowMutations ? (
        <TableGrid.Cell width="4.2rem">
          <Checkbox
            checked={selected}
            onChange={() => onToggle(order.id)}
            aria-label={`자동감시 ${stockLabel} 선택`}
            dense
          />
        </TableGrid.Cell>
      ) : null}
      <TableGrid.Cell width="16.8rem" title={stockLabel}>
        {stockLabel}
      </TableGrid.Cell>
      <TableGrid.Cell width="7.2rem">{sourceLabel(order.source)}</TableGrid.Cell>
      <TableGrid.Cell width="9rem" numeric>
        {thousandSeparator(order.targetPrice)}
      </TableGrid.Cell>
      <TableGrid.Cell width="9rem" numeric>
        {order.qtyOrAmountMode === 'QTY'
          ? thousandSeparator(order.qty ?? 0)
          : `${thousandSeparator(order.amountKrw ?? 0)}원`}
      </TableGrid.Cell>
      <TableGrid.Cell width="7.2rem">{order.orderType}</TableGrid.Cell>
      <TableGrid.Cell width="7.2rem">{statusLabel(order.status)}</TableGrid.Cell>
      <TableGrid.Cell
        width="17.6rem"
        className="muted date-time-cell"
        title={formatWatchDateTitle(order.createdAt)}
      >
        {formatWatchDate(order.createdAt)}
      </TableGrid.Cell>
      <TableGrid.Cell width="12rem" className="muted">
        {order.lastFailureReason ?? ''}
      </TableGrid.Cell>
    </TableGrid.Row>
  );
};
