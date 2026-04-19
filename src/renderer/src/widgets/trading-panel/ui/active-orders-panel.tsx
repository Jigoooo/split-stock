import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, Checkbox } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useActiveOrders } from '../model/use-active-orders';

export interface ActiveOrdersPanelProps {
  /** 표시할 종목 필터 (선택). null이면 전체. */
  pdnoFilter?: string | null;
}

export const ActiveOrdersPanel = (props: ActiveOrdersPanelProps): ReactElement => {
  const { pdnoFilter } = props;
  const { cancelError, cancelPending, cancelSelected, orders, selected, toggle } =
    useActiveOrders(pdnoFilter);

  return (
    <div className="panel">
      <div className="panel__title">
        미체결 주문 ({thousandSeparator(orders.length)}건){pdnoFilter ? ` · ${pdnoFilter}` : ''}
      </div>
      <div className="panel__body" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <Button
          disabled={selected.size === 0 || cancelPending}
          onClick={() => void cancelSelected()}
          dense
        >
          선택 취소 ({thousandSeparator(selected.size)})
        </Button>
        {cancelError ? <span className="chip chip--down">{cancelError}</span> : null}
      </div>
      <table className="hts-table" aria-label="미체결 주문">
        <thead>
          <tr>
            <th style={{ width: '3rem' }} />
            <th>종목</th>
            <th>구분</th>
            <th className="num">수량</th>
            <th className="num">가격</th>
            <th>상태</th>
            <th>접수시각</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted" style={{ textAlign: 'center' }}>
                미체결 없음
              </td>
            </tr>
          ) : null}
          {orders.map((o) => (
            <tr key={o.odno}>
              <td>
                <Checkbox
                  checked={selected.has(o.odno)}
                  onChange={() => toggle(o.odno)}
                  aria-label={`선택 ${o.odno}`}
                  dense
                />
              </td>
              <td className="num">{o.pdno}</td>
              <td>
                <span className={o.side === 'BUY' ? 'num-up' : 'num-down'}>
                  {o.side} · {o.division}
                </span>
              </td>
              <td className="num">{thousandSeparator(o.qty)}</td>
              <td className="num">
                {o.division === 'MARKET' ? '시장가' : thousandSeparator(o.price)}
              </td>
              <td>{o.status}</td>
              <td className="muted num">{formatTs(o.placedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function formatTs(ts: Date | number | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('ko-KR', { hour12: false });
}
