import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

interface OrderTicketActionsProps {
  canBuy: boolean;
  canSell: boolean;
  holdingQty: number;
  maxBuyQty: number | null;
  overBuyCap: boolean;
  overSellCap: boolean;
  submit: (side: 'BUY' | 'SELL') => Promise<void>;
}

export const OrderTicketActions = ({
  canBuy,
  canSell,
  holdingQty,
  maxBuyQty,
  overBuyCap,
  overSellCap,
  submit,
}: OrderTicketActionsProps): ReactElement => (
  <div className="panel__body order-ticket-form__actions">
    <Button
      disabled={!canBuy}
      aria-disabled={!canBuy}
      variant="danger"
      dense
      onClick={() => {
        void submit('BUY');
      }}
      aria-label="매수 주문"
      title={
        overBuyCap
          ? `매수가능 수량 초과 — 최대 ${maxBuyQty === null ? '—' : thousandSeparator(maxBuyQty)}주`
          : undefined
      }
    >
      매수
      {/* 단축키 칩 — 버튼이 disabled 일 때 키 입력도 무시되므로 시각적으로도 약화시켜 인지 일관성 유지. */}
      <kbd className="kbd" aria-hidden style={{ opacity: canBuy ? 1 : 0.4 }}>
        F3
      </kbd>
    </Button>
    <Button
      disabled={!canSell}
      aria-disabled={!canSell}
      variant="sell"
      dense
      onClick={() => {
        void submit('SELL');
      }}
      aria-label="매도 주문"
      title={
        holdingQty === 0
          ? '보유 수량 없음'
          : overSellCap
            ? `보유 수량 초과 — 최대 ${thousandSeparator(holdingQty)}주`
            : undefined
      }
    >
      매도
      <kbd className="kbd" aria-hidden style={{ opacity: canSell ? 1 : 0.4 }}>
        F4
      </kbd>
    </Button>
  </div>
);
