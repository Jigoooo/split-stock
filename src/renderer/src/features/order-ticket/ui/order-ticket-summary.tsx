import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { ReactElement } from 'react';
import type { Division } from '../model/order-ticket-types';

interface OrderTicketSummaryProps {
  division: Division;
  holdingQty: number;
  isProd: boolean;
  maxBuyQty: number | null;
  oneClick: boolean;
  overBuyCap: boolean;
  overSellCap: boolean;
  priceStr: string;
  qtyStr: string;
  suggestedPrice?: number | undefined;
}

export const OrderTicketSummary = ({
  division,
  holdingQty,
  isProd,
  maxBuyQty,
  oneClick,
  overBuyCap,
  overSellCap,
  priceStr,
  qtyStr,
  suggestedPrice,
}: OrderTicketSummaryProps): ReactElement => {
  const suggestedPriceApplied =
    division === 'LIMIT' && suggestedPrice !== undefined && Number(priceStr) === suggestedPrice;

  return (
    <div className="panel__body order-ticket-form__summary" aria-live="polite">
      <div className="order-ticket-form__selection-line">
        <span className="muted">현재 선택:</span>
        <strong>
          {division === 'MARKET' ? '시장가' : '지정가'} · {qtyStr ? thousandSeparator(qtyStr) : '0'}
          주{division === 'LIMIT' && priceStr ? ` · ${thousandSeparator(priceStr)}원` : ''}
        </strong>
        {suggestedPriceApplied ? (
          <span className="chip order-ticket-form__source-chip">호가 반영</span>
        ) : null}
        {oneClick && !isProd ? <span className="chip">원터치 ON</span> : null}
      </div>
      {overBuyCap ? (
        <div className="order-ticket-form__summary-alert" role="alert">
          매수 시 예수금 부족 — 최대 {maxBuyQty === null ? '—' : thousandSeparator(maxBuyQty)}주
        </div>
      ) : null}
      {overSellCap ? (
        <div className="order-ticket-form__summary-alert" role="alert">
          매도 시 보유 수량 초과 — 보유 {thousandSeparator(holdingQty)}주
        </div>
      ) : null}
    </div>
  );
};
