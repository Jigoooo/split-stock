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
        aria-invalid={overBuyCap}
      />
      <span className="muted order-ticket-form__hint">
        <span>
          매수가능 <span className="num">{thousandSeparator(deposit)}원</span>
          {maxBuyQty !== null ? (
            <>
              {' / '}
              {overBuyCap ? (
                <button
                  type="button"
                  onClick={() => setQtyStr(String(maxBuyQty))}
                  title="수량을 매수가능 최대치로 자동 조정"
                  style={{
                    padding: '0.05rem 0.4rem',
                    border: '1px solid var(--up)',
                    borderRadius: '0.2rem',
                    background: 'var(--up-soft)',
                    color: 'var(--up)',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontWeight: 600,
                  }}
                >
                  최대 {thousandSeparator(maxBuyQty)}주로 조정
                </button>
              ) : (
                <span className="num">최대 {thousandSeparator(maxBuyQty)}주</span>
              )}
            </>
          ) : null}
        </span>
        <span>
          매도가능 <span className="num">{thousandSeparator(holdingQty)}주</span>
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
