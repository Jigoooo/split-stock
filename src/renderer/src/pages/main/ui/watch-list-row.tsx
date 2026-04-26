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
}

export const WatchListRow = ({
  allowMutations,
  onContextMenu,
  onToggle,
  order,
  selected,
}: WatchListRowProps): ReactElement => (
  <TableGrid.Row
    selected={selected}
    onContextMenu={(event) => onContextMenu(event, order.id)}
    style={{ position: 'relative' }}
  >
    <TableGrid.Cell width={42}>
      <Checkbox
        checked={selected}
        onChange={() => onToggle(order.id)}
        aria-label={`선택 ${order.id}`}
        dense
      />
    </TableGrid.Cell>
    <TableGrid.Cell width={80} numeric>
      {order.pdno}
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
    {allowMutations ? (
      <button
        type="button"
        className="watch-list-more-btn"
        aria-label={`더보기 ${order.id}`}
        onClick={(event) => {
          event.stopPropagation();
          onContextMenu(event, order.id);
        }}
        style={{
          position: 'absolute',
          right: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'var(--hts-bg, #1a1a2e)',
          border: '1px solid var(--hts-line, rgba(255,255,255,0.15))',
          borderRadius: 3,
          color: 'inherit',
          cursor: 'pointer',
          fontSize: '1rem',
          lineHeight: 1,
          padding: '0.2rem 0.5rem',
          opacity: 0,
          transition: 'opacity 0.1s',
          zIndex: 1,
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.opacity = '1';
        }}
        onMouseLeave={(event) => {
          if (document.activeElement !== event.currentTarget) {
            event.currentTarget.style.opacity = '0';
          }
        }}
        onFocus={(event) => {
          event.currentTarget.style.opacity = '1';
        }}
        onBlur={(event) => {
          event.currentTarget.style.opacity = '0';
        }}
      >
        ···
      </button>
    ) : null}
  </TableGrid.Row>
);
