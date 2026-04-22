import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, Checkbox, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useActiveOrders } from '../model/use-active-orders';

export interface ActiveOrdersPanelProps {
  /** 표시할 종목 필터 (선택). null이면 전체. */
  pdnoFilter?: string | null;
  /** pdnoFilter에 해당하는 종목명 (선택). 헤더 및 그리드 표시용. */
  nameFilter?: string | null;
}

export const ActiveOrdersPanel = (props: ActiveOrdersPanelProps): ReactElement => {
  const { pdnoFilter, nameFilter } = props;
  const { cancelError, cancelPending, cancelSelected, orders, selected, toggle } =
    useActiveOrders(pdnoFilter);

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div className="panel__title" style={{ flexShrink: 0 }}>
        미체결 주문 ({thousandSeparator(orders.length)}건)
        {pdnoFilter ? ` · ${nameFilter ? `${nameFilter} (${pdnoFilter})` : pdnoFilter}` : ''}
      </div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexShrink: 0 }}
      >
        <Button
          disabled={selected.size === 0 || cancelPending}
          onClick={() => void cancelSelected()}
          dense
        >
          선택 취소 ({thousandSeparator(selected.size)})
        </Button>
        {cancelError ? <span className="chip chip--down">{cancelError}</span> : null}
      </div>
      <TableGrid.Root
        variant="hts"
        stickyHeader
        aria-label="미체결 주문"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={48} />
          <TableGrid.Cell flex={1}>종목</TableGrid.Cell>
          <TableGrid.Cell flex={1}>구분</TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            남은/원주문
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            가격
          </TableGrid.Cell>
          <TableGrid.Cell flex={1}>상태</TableGrid.Cell>
          <TableGrid.Cell flex={1}>접수시각</TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {orders.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">미체결 없음</TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
          {orders.map((o) => (
            <TableGrid.Row key={o.odno}>
              <TableGrid.Cell width={48}>
                <Checkbox
                  checked={selected.has(o.odno)}
                  onChange={() => toggle(o.odno)}
                  aria-label={`선택 ${o.odno}`}
                  dense
                />
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {nameFilter && o.pdno === pdnoFilter ? nameFilter : o.pdno}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1}>
                <span className={o.side === 'BUY' ? 'num-up' : 'num-down'}>
                  {o.side} · {o.division}
                </span>
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                <div
                  style={{
                    display: 'grid',
                    gap: '0.15rem',
                    justifyItems: 'end',
                    lineHeight: 1.15,
                  }}
                >
                  <span className="num">
                    {thousandSeparator(o.remainingQty)} / {thousandSeparator(o.qty)}
                  </span>
                  <span className="muted" style={{ fontSize: '1rem' }}>
                    체결 {thousandSeparator(o.filledQty)}주
                  </span>
                </div>
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {o.division === 'MARKET' ? '시장가' : thousandSeparator(o.price)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1}>
                <span className={`chip ${o.status === 'PARTIAL' ? 'chip--up' : ''}`}>
                  {o.status === 'PARTIAL' ? '부분체결' : '미체결'}
                </span>
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric className="muted">
                {formatTs(o.placedAt)}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
        </TableGrid.Body>
      </TableGrid.Root>
    </div>
  );
};

function formatTs(ts: Date | number | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('ko-KR', { hour12: false });
}
