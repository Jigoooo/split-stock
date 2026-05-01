import type { WatchOrder } from '@renderer/entities/watch-order';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Checkbox, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { formatWatchDate, sourceLabel, statusLabel } from '../lib/watch-list-format';

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
  const contextMenuProps = allowMutations
    ? { onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => onContextMenu(event, order.id) }
    : {};
  const stockLabel = stockName ? `${stockName} (${order.pdno})` : order.pdno;

  return (
    <TableGrid.Row selected={allowMutations && selected} {...contextMenuProps}>
      {allowMutations ? (
        <TableGrid.Cell width={42}>
          <Checkbox
            checked={selected}
            onChange={() => onToggle(order.id)}
            aria-label={`자동감시 ${stockLabel} 선택`}
            dense
          />
        </TableGrid.Cell>
      ) : null}
      <TableGrid.Cell width={168} title={stockLabel}>
        {stockLabel}
      </TableGrid.Cell>
      <TableGrid.Cell width={72}>{sourceLabel(order.source)}</TableGrid.Cell>
      <TableGrid.Cell width={90} numeric>
        {thousandSeparator(order.targetPrice)}
      </TableGrid.Cell>
      <TableGrid.Cell width={90} numeric>
        {order.qtyOrAmountMode === 'QTY'
          ? thousandSeparator(order.qty ?? 0)
          : `${thousandSeparator(order.amountKrw ?? 0)}원`}
      </TableGrid.Cell>
      <TableGrid.Cell width={72}>{order.orderType}</TableGrid.Cell>
      <TableGrid.Cell width={72}>{statusLabel(order.status)}</TableGrid.Cell>
      <TableGrid.Cell width={148} className="muted">
        {formatWatchDate(order.createdAt)}
      </TableGrid.Cell>
      <TableGrid.Cell width={120} className="muted">
        {order.lastFailureReason ?? ''}
      </TableGrid.Cell>
    </TableGrid.Row>
  );
};
