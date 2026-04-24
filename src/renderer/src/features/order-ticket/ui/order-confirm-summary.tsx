import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { ReactElement } from 'react';
import type { Division, OrderTicketSelection } from '../model/order-ticket-types';

interface OrderConfirmSummaryProps {
  division: Division;
  divisionLabel: string;
  isProd: boolean;
  nextNth: number;
  priceLabel: string;
  qty: number;
  selection: OrderTicketSelection;
  side: 'BUY' | 'SELL';
  sideLabel: string;
}

export const OrderConfirmSummary = ({
  division,
  divisionLabel,
  isProd,
  nextNth,
  priceLabel,
  qty,
  selection,
  side,
  sideLabel,
}: OrderConfirmSummaryProps): ReactElement => (
  <div className="order-confirm-summary">
    <dl className="order-confirm-summary__dl">
      <dt>종목</dt>
      <dd>
        <span className="num">{selection.pdno}</span> {selection.name}
      </dd>
      <dt>구분</dt>
      <dd>
        <span className={side === 'BUY' ? 'num-up' : 'num-down'}>{sideLabel}</span>
        {' · '}
        {divisionLabel}
        {side === 'BUY' ? (
          <>
            {' · '}
            <span className="chip">{nextNth}차</span>
          </>
        ) : null}
      </dd>
      <dt>수량</dt>
      <dd className="num">{thousandSeparator(String(qty))}주</dd>
      <dt>가격</dt>
      <dd className="num">{division === 'MARKET' ? '시장가' : priceLabel}</dd>
    </dl>
    {isProd ? (
      <p className="order-confirm-summary__warning">
        실전 계좌로 실제 주문이 체결됩니다. 종목·수량·가격을 다시 확인하세요.
      </p>
    ) : null}
  </div>
);
