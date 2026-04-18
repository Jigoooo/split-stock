import { trpc } from '@renderer/shared/api/trpc';
import type { ReactElement } from 'react';
import { useState } from 'react';

export interface ActiveOrdersPanelProps {
  /** 표시할 종목 필터 (선택). null이면 전체. */
  pdnoFilter?: string | null;
}

export const ActiveOrdersPanel = (props: ActiveOrdersPanelProps): ReactElement => {
  const { pdnoFilter } = props;
  const utils = trpc.useUtils();
  const query = trpc.order.listActive.useQuery(undefined, { refetchInterval: 2000 });
  const cancelMany = trpc.order.cancelMany.useMutation({
    onSuccess: () => utils.order.listActive.invalidate(),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allOrders = query.data?.orders ?? [];
  const orders = pdnoFilter ? allOrders.filter((o) => o.pdno === pdnoFilter) : allOrders;

  const toggle = (odno: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(odno)) next.delete(odno);
      else next.add(odno);
      return next;
    });
  };

  const cancelSelected = async (): Promise<void> => {
    const odnos = Array.from(selected);
    if (odnos.length === 0) return;
    if (!window.confirm(`${odnos.length}건 일괄 취소하시겠습니까?`)) return;
    await cancelMany.mutateAsync({ odnos });
    setSelected(new Set());
  };

  return (
    <div className="panel">
      <div className="panel__title">
        미체결 주문 ({orders.length}건){pdnoFilter ? ` · ${pdnoFilter}` : ''}
      </div>
      <div className="panel__body" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <button
          type="button"
          className="hts-btn"
          disabled={selected.size === 0 || cancelMany.isPending}
          onClick={() => void cancelSelected()}
        >
          선택 취소 ({selected.size})
        </button>
        {cancelMany.error ? (
          <span className="chip chip--down">{cancelMany.error.message}</span>
        ) : null}
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
                <input
                  type="checkbox"
                  checked={selected.has(o.odno)}
                  onChange={() => toggle(o.odno)}
                  aria-label={`선택 ${o.odno}`}
                />
              </td>
              <td className="num">{o.pdno}</td>
              <td>
                <span className={o.side === 'BUY' ? 'num-up' : 'num-down'}>
                  {o.side} · {o.division}
                </span>
              </td>
              <td className="num">{o.qty.toLocaleString('ko-KR')}</td>
              <td className="num">
                {o.division === 'MARKET' ? '시장가' : o.price.toLocaleString('ko-KR')}
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
