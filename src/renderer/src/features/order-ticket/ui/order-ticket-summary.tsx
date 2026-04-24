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
}: OrderTicketSummaryProps): ReactElement => (
  <div className="panel__body muted order-ticket-form__summary">
    현재 선택: {division === 'MARKET' ? '시장가' : '지정가'} ·{' '}
    {qtyStr ? thousandSeparator(qtyStr) : '0'}주
    {division === 'LIMIT' && priceStr ? ` · ${thousandSeparator(priceStr)}원` : ''}
    {oneClick && !isProd ? ' · 원터치 ON' : ''}
    {overBuyCap ? (
      <div className="order-ticket-form__summary-alert num-down">
        매수 불가 — 예수금 부족 (최대 {maxBuyQty === null ? '—' : thousandSeparator(maxBuyQty)}주)
      </div>
    ) : null}
    {overSellCap ? (
      <div className="order-ticket-form__summary-alert num-down">
        매도 불가 — 보유 수량 초과 (보유 {thousandSeparator(holdingQty)}주)
      </div>
    ) : null}
  </div>
);
