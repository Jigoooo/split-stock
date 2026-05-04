import {
  formatDateTimeLongKo,
  formatTimeOnly,
  thousandSeparator,
} from '@renderer/shared/lib/formatter';
import { Button, Checkbox, TableGrid } from '@renderer/shared/ui';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { NormalizedOrder, OrdersPanelColumn } from '../model/normalized-order';

const COLUMN_WIDTHS: Record<OrdersPanelColumn, string> = {
  select: '5.2rem',
  time: '11.2rem',
  symbol: '11rem',
  side: '7rem',
  qty: '9.6rem',
  remaining: '14.8rem',
  executed: '9.6rem',
  price: '11rem',
  fee: '8rem',
  state: '9.6rem',
  placedAt: '11.2rem',
  manage: '12.4rem',
};

const COLUMN_LABELS: Record<OrdersPanelColumn, string> = {
  select: '',
  time: '시각',
  symbol: '종목',
  side: '구분',
  qty: '수량',
  remaining: '남은/원주문',
  executed: '체결',
  price: '가격',
  fee: '수수료',
  state: '상태',
  placedAt: '접수시각',
  manage: '관리',
};

const NUMERIC_COLUMNS: ReadonlySet<OrdersPanelColumn> = new Set([
  'qty',
  'remaining',
  'executed',
  'price',
  'fee',
]);

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
};

const TOOLBAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: '0.6rem',
  alignItems: 'center',
  flexShrink: 0,
};

const REMAINING_CELL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: '0.1rem',
  lineHeight: 1.2,
};

const STATE_CELL_STYLE: CSSProperties = {
  display: 'inline-flex',
  gap: '0.3rem',
  alignItems: 'center',
};

const MANAGE_CELL_STYLE: CSSProperties = { display: 'inline-flex', gap: '0.4rem' };

export interface OrdersPanelProps {
  /** Optional title shown in the panel header. Falls back to mode default. */
  title?: string;
  /** Normalized orders rendered in the table body. */
  orders: ReadonlyArray<NormalizedOrder>;
  /** Columns (in render order) the panel should display. */
  columns: ReadonlyArray<OrdersPanelColumn>;
  /** 'filled' = read-only history view, 'active' = open orders w/ cancel actions. */
  mode: 'filled' | 'active';
  /** Per-row cancel callback. Required when `manage` column is present and rows are cancellable. */
  onCancel?: (id: string) => void;
  /** Per-row detail open callback. Crypto wrapper supplies this for the modal. */
  onOpenDetail?: (id: string) => void;
  /** Optional row selection state (drives the `select` column). */
  selection?: {
    selectedIds: ReadonlySet<string>;
    onToggle: (id: string) => void;
  };
  /** Wrapper-supplied toolbar slot — e.g. KIS batch cancel button + warning chip. */
  selectionAction?: ReactNode;
  /** Empty body text. Defaults vary by mode. */
  emptyText?: string;
  /** Row-level loading flag for cancel pending. Disables cancel buttons when true. */
  cancelPending?: boolean;
  /** Optional aria-label override for the table grid. */
  tableAriaLabel?: string;
  /** Optional extra slot rendered after the table (e.g. crypto detail modal). */
  footerSlot?: ReactNode;
  /** Optional placeholder rendered when the panel is disabled (e.g. inactive account). */
  disabledPlaceholder?: ReactNode;
}

/**
 * Broker-agnostic orders table.
 *
 * Stock (`FilledPane`, `ActiveOrdersPanel`) and crypto (`CryptoOrdersPanel`)
 * wrappers convert their domain-specific shapes into `NormalizedOrder` and
 * compose this component. The base does not branch on broker — any
 * KIS-specific affordance (orgNo warning, batch cancel) lives in the wrapper
 * and is injected via `selectionAction` / per-row `warning`.
 */
export const OrdersPanel = ({
  cancelPending = false,
  columns,
  disabledPlaceholder,
  emptyText,
  footerSlot,
  mode,
  onCancel,
  onOpenDetail,
  orders,
  selection,
  selectionAction,
  tableAriaLabel,
  title,
}: OrdersPanelProps): ReactElement => {
  if (disabledPlaceholder !== undefined) {
    return (
      <section className="panel" style={PANEL_STYLE} aria-label={title}>
        {title ? (
          <div className="panel__title" style={{ flexShrink: 0 }}>
            {title}
          </div>
        ) : null}
        <div className="panel__body muted">{disabledPlaceholder}</div>
      </section>
    );
  }

  const resolvedTitle =
    title ??
    (mode === 'active' ? '미체결 주문' : `내 체결 — 최근 ${thousandSeparator(orders.length)}건`);
  const resolvedEmpty = emptyText ?? (mode === 'active' ? '미체결 없음' : '체결 내역이 없습니다');
  const showToolbar = selectionAction !== undefined;

  return (
    <section className="panel" style={PANEL_STYLE} aria-label={title}>
      <div className="panel__title" style={{ flexShrink: 0 }}>
        {resolvedTitle}
      </div>
      {showToolbar ? (
        <div className="panel__body" style={TOOLBAR_STYLE}>
          {selectionAction}
        </div>
      ) : null}
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label={tableAriaLabel ?? resolvedTitle}
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          {columns.map((col) => {
            const width = COLUMN_WIDTHS[col];
            const numeric = NUMERIC_COLUMNS.has(col);
            const label = COLUMN_LABELS[col];
            if (col === 'select') {
              return <TableGrid.Cell key={col} width={width} minWidth={width} />;
            }
            return (
              <TableGrid.Cell
                key={col}
                width={width}
                minWidth={width}
                className={col === 'time' || col === 'placedAt' ? 'date-time-cell' : undefined}
                numeric={numeric || undefined}
              >
                {label}
              </TableGrid.Cell>
            );
          })}
        </TableGrid.Header>
        <TableGrid.Body>
          {orders.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell width="100%" className="muted">
                {resolvedEmpty}
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
          {orders.map((order) => (
            <TableGrid.Row key={order.id}>
              {columns.map((col) =>
                renderCell({
                  cancelPending,
                  col,
                  onCancel,
                  onOpenDetail,
                  order,
                  selection,
                }),
              )}
            </TableGrid.Row>
          ))}
        </TableGrid.Body>
      </TableGrid.Root>
      {footerSlot}
    </section>
  );
};

interface RenderCellArgs {
  cancelPending: boolean;
  col: OrdersPanelColumn;
  onCancel?: (id: string) => void;
  onOpenDetail?: (id: string) => void;
  order: NormalizedOrder;
  selection?: OrdersPanelProps['selection'];
}

const renderCell = ({
  cancelPending,
  col,
  onCancel,
  onOpenDetail,
  order,
  selection,
}: RenderCellArgs): ReactElement => {
  const width = COLUMN_WIDTHS[col];
  switch (col) {
    case 'select':
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width}>
          {selection ? (
            <Checkbox
              checked={selection.selectedIds.has(order.id)}
              onChange={() => selection.onToggle(order.id)}
              aria-label={`선택 ${order.id}`}
              dense
            />
          ) : null}
        </TableGrid.Cell>
      );
    case 'time':
    case 'placedAt':
      return (
        <TableGrid.Cell
          key={col}
          width={width}
          minWidth={width}
          className="muted date-time-cell"
          title={formatDateTimeLongKo(order.placedAt)}
        >
          {formatTimeOnly(order.placedAt)}
        </TableGrid.Cell>
      );
    case 'symbol':
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width}>
          {order.symbolLabel}
        </TableGrid.Cell>
      );
    case 'side':
      return (
        <TableGrid.Cell
          key={col}
          width={width}
          minWidth={width}
          className={order.side === 'BUY' ? 'num-up' : 'num-down'}
        >
          {order.side === 'BUY' ? '매수' : '매도'}
        </TableGrid.Cell>
      );
    case 'qty':
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width} numeric>
          {order.qtyLabel ?? thousandSeparator(order.qty)}
        </TableGrid.Cell>
      );
    case 'remaining':
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width} numeric>
          <div style={REMAINING_CELL_STYLE}>
            <span className="num" style={{ whiteSpace: 'nowrap' }}>
              {order.remainingLabel ?? thousandSeparator(order.remainingQty)} /{' '}
              {order.qtyLabel ?? thousandSeparator(order.qty)}
            </span>
            {order.filledQty > 0 ? (
              <span className="muted" style={{ fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                체결 {order.executedLabel ?? thousandSeparator(order.filledQty)}주
              </span>
            ) : null}
          </div>
        </TableGrid.Cell>
      );
    case 'executed':
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width} numeric>
          {order.executedLabel ?? thousandSeparator(order.filledQty)}
        </TableGrid.Cell>
      );
    case 'price':
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width} numeric>
          {order.priceLabel ?? thousandSeparator(order.price)}
        </TableGrid.Cell>
      );
    case 'fee':
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width} numeric>
          {order.feeLabel ?? '-'}
        </TableGrid.Cell>
      );
    case 'state': {
      const chipClass =
        order.stateVariant === 'up'
          ? 'chip chip--up'
          : order.stateVariant === 'down'
            ? 'chip chip--down'
            : 'chip';
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width}>
          <span style={STATE_CELL_STYLE}>
            <span className={chipClass}>{order.stateLabel}</span>
            {order.warning ? (
              <span className="chip chip--down" title={order.warning.title}>
                {order.warning.label}
              </span>
            ) : null}
          </span>
        </TableGrid.Cell>
      );
    }
    case 'manage':
      return (
        <TableGrid.Cell key={col} width={width} minWidth={width}>
          <span style={MANAGE_CELL_STYLE}>
            {onOpenDetail ? (
              <Button dense onClick={() => onOpenDetail(order.id)}>
                상세
              </Button>
            ) : null}
            {order.cancellable && onCancel ? (
              <Button dense disabled={cancelPending} onClick={() => onCancel(order.id)}>
                취소
              </Button>
            ) : null}
          </span>
        </TableGrid.Cell>
      );
    default:
      return <TableGrid.Cell key={col} width={width} minWidth={width} />;
  }
};
