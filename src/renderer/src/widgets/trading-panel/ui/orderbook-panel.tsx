import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { ReactElement } from 'react';
import type { LiveOrderbook } from '../model/use-live-feed';

export interface OrderbookPanelProps {
  orderbook: LiveOrderbook | null;
  currentPrice: number;
  onClickPrice: (price: number, side: 'BUY' | 'SELL') => void;
}

/**
 * 10단 호가창 — 매도(상단 10단) + 현재가 + 매수(하단 10단).
 * - 각 행 클릭 시 onClickPrice(price, side) 호출 → order-ticket prefill
 * - 잔량 bar: max 잔량 대비 상대 길이
 * - 한국식 색상 (매수 row=up 빨강, 매도 row=down 파랑)
 */
export const OrderbookPanel = (props: OrderbookPanelProps): ReactElement => {
  const { orderbook, currentPrice, onClickPrice } = props;
  if (!orderbook) {
    return (
      <div className="panel">
        <div className="panel__body muted">호가 로드 중…</div>
      </div>
    );
  }
  const maxQty = Math.max(
    1,
    ...orderbook.asks.map((l) => l.quantity),
    ...orderbook.bids.map((l) => l.quantity),
  );
  // 매도는 10→1로 내려오게 역순 표시 (HTS 관례: 매도 위/매수 아래, 매도 1단이 아래에 붙음)
  const asksReversed = [...orderbook.asks].reverse();

  return (
    <div className="panel orderbook-panel">
      <table className="hts-table orderbook-table" aria-label="호가 10단">
        <thead>
          <tr>
            <th className="num" style={{ width: '40%' }}>
              매도잔량
            </th>
            <th className="num">호가</th>
            <th className="num" style={{ width: '40%' }}>
              매수잔량
            </th>
          </tr>
        </thead>
        <tbody>
          {asksReversed.map((l) => (
            <OrderbookRow
              key={`ask-${l.price}`}
              leftQty={l.quantity}
              rightQty={0}
              price={l.price}
              maxQty={maxQty}
              side="SELL"
              current={l.price === currentPrice}
              onClick={() => onClickPrice(l.price, 'BUY')}
            />
          ))}
          {orderbook.bids.map((l) => (
            <OrderbookRow
              key={`bid-${l.price}`}
              leftQty={0}
              rightQty={l.quantity}
              price={l.price}
              maxQty={maxQty}
              side="BUY"
              current={l.price === currentPrice}
              onClick={() => onClickPrice(l.price, 'SELL')}
            />
          ))}
        </tbody>
      </table>
      <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
        총 매도 {thousandSeparator(orderbook.totalAskQty)} · 총 매수{' '}
        {thousandSeparator(orderbook.totalBidQty)}
      </div>
    </div>
  );
};

interface RowProps {
  leftQty: number;
  rightQty: number;
  price: number;
  maxQty: number;
  side: 'BUY' | 'SELL';
  current: boolean;
  onClick: () => void;
}

const OrderbookRow = ({
  leftQty,
  rightQty,
  price,
  maxQty,
  side,
  current,
  onClick,
}: RowProps): ReactElement => {
  const leftPct = Math.round((leftQty / maxQty) * 100);
  const rightPct = Math.round((rightQty / maxQty) * 100);
  const priceColor = side === 'SELL' ? 'num-down' : 'num-up';
  return (
    <tr
      onClick={onClick}
      style={{
        cursor: 'pointer',
        background: current ? 'rgba(45, 79, 202, 0.12)' : undefined,
      }}
    >
      <td className="num" style={{ position: 'relative' }}>
        {leftQty > 0 ? (
          <>
            <span
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: `${leftPct}%`,
                background: 'rgba(45, 79, 202, 0.18)',
              }}
            />
            <span style={{ position: 'relative' }}>{thousandSeparator(leftQty)}</span>
          </>
        ) : null}
      </td>
      <td
        className={`num ${priceColor}`}
        style={{ fontWeight: current ? 700 : 500, textAlign: 'center' }}
      >
        {thousandSeparator(price)}
      </td>
      <td className="num" style={{ position: 'relative' }}>
        {rightQty > 0 ? (
          <>
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${rightPct}%`,
                background: 'rgba(215, 51, 51, 0.18)',
              }}
            />
            <span style={{ position: 'relative' }}>{thousandSeparator(rightQty)}</span>
          </>
        ) : null}
      </td>
    </tr>
  );
};
