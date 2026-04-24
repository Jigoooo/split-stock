import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { NumberInput, Select } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { Division } from '../model/order-ticket-types';

interface OrderTicketFieldsProps {
  deposit: number;
  division: Division;
  holdingQty: number;
  maxBuyQty: number | null;
  nextNth: number;
  overBuyCap: boolean;
  overSellCap: boolean;
  priceStr: string;
  qtyStr: string;
  setDivision: (division: Division) => void;
  setPriceStr: (value: string) => void;
  setQtyStr: (value: string) => void;
}

export const OrderTicketFields = ({
  deposit,
  division,
  holdingQty,
  maxBuyQty,
  nextNth,
  overBuyCap,
  overSellCap,
  priceStr,
  qtyStr,
  setDivision,
  setPriceStr,
  setQtyStr,
}: OrderTicketFieldsProps): ReactElement => (
  <div className="panel__body order-ticket-form__content">
    <div className="order-ticket-form__meta">
      <span className="muted">매수 차수</span>
      <span className="chip">{nextNth}차</span>
    </div>
    <div className="order-ticket-form__field">
      <span className="order-ticket-form__label">구분</span>
      <Select
        id="order-division"
        value={division}
        onChange={(event) => setDivision(event.target.value as Division)}
        aria-label="주문 구분"
        dense
      >
        <option value="LIMIT">지정가</option>
        <option value="MARKET">시장가</option>
      </Select>
    </div>
    <label className="order-ticket-form__field" htmlFor="order-qty">
      <span className="order-ticket-form__label">수량</span>
      <NumberInput
        id="order-qty"
        value={qtyStr}
        onValueChange={setQtyStr}
        aria-label="주문 수량"
        dense
        aria-invalid={overBuyCap || overSellCap}
      />
      <span className="muted order-ticket-form__hint">
        <span>
          매수가능 <span className="num">{thousandSeparator(deposit)}원</span>
          {maxBuyQty !== null ? (
            <>
              {' / '}
              <span className={overBuyCap ? 'num-down' : 'num'}>
                최대 {thousandSeparator(maxBuyQty)}주
              </span>
            </>
          ) : null}
        </span>
        <span>
          보유{' '}
          <span className={overSellCap ? 'num-down' : 'num'}>
            {thousandSeparator(holdingQty)}주
          </span>
        </span>
      </span>
    </label>
    <label className="order-ticket-form__field" htmlFor="order-price">
      <span className="order-ticket-form__label">가격</span>
      <NumberInput
        id="order-price"
        value={division === 'MARKET' ? '' : priceStr}
        disabled={division === 'MARKET'}
        emptyDisplay="시장가"
        onValueChange={setPriceStr}
        aria-label="주문 가격"
        dense
      />
    </label>
  </div>
);
