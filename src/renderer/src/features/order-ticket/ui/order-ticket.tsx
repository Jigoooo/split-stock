import { useBalanceWithLots } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { dialog } from '@renderer/shared/ui';
import { deriveNextBuyNth } from '@shared/trading/next-nth';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import type { Division, OrderTicketProps, OrderTicketSelection } from '../model/order-ticket-types';
import { useOrderActions } from '../model/use-order-actions';
import { OrderConfirmSummary } from './order-confirm-summary';
import { OrderTicketActions } from './order-ticket-actions';
import { OrderTicketFields } from './order-ticket-fields';
import { OrderTicketSummary } from './order-ticket-summary';

export type { OrderTicketSelection };

export const OrderTicket = (props: OrderTicketProps): ReactElement => {
  const { selection, isProd, oneClick } = props;
  const [division, setDivision] = useState<Division>('LIMIT');
  const [qtyStr, setQtyStr] = useState('1');
  const [priceStr, setPriceStr] = useState(
    selection.suggestedPrice ? String(selection.suggestedPrice) : '',
  );
  const suggestionKey = `${selection.pdno}:${selection.suggestedPrice ?? ''}`;
  const [appliedSuggestionKey, setAppliedSuggestionKey] = useState(suggestionKey);
  const actions = useOrderActions();
  const { lotsByPdno, positions, deposit } = useBalanceWithLots();
  const safetyQuery = trpc.safety.getState.useQuery(undefined, { staleTime: 0 });

  useEffect(() => {
    if (appliedSuggestionKey === suggestionKey) return;
    setAppliedSuggestionKey(suggestionKey);
    if (selection.suggestedPrice !== undefined) {
      setPriceStr(String(selection.suggestedPrice));
    }
  }, [appliedSuggestionKey, selection.suggestedPrice, suggestionKey]);

  const lots = lotsByPdno[selection.pdno] ?? [];
  const nextNth = deriveNextBuyNth(lots);
  const qty = Number(qtyStr);
  const price = division === 'MARKET' ? 0 : Number(priceStr);
  const validQty = Number.isInteger(qty) && qty > 0;
  const validPrice = division === 'MARKET' || (Number.isInteger(price) && price > 0);
  const maxBuyQty =
    division === 'LIMIT' && price > 0 && deposit > 0 ? Math.floor(deposit / price) : null;
  const holdingQty = positions.find((position) => position.code === selection.pdno)?.qty ?? 0;
  const overBuyCap = maxBuyQty !== null && validQty && qty > maxBuyQty;
  const overSellCap = validQty && qty > holdingQty;
  const canSubmitBase = validQty && validPrice && !actions.isPending;
  const canBuy = canSubmitBase && !overBuyCap;
  const canSell = canSubmitBase && !overSellCap && holdingQty > 0;

  const executeOrder = async (params: {
    side: 'BUY' | 'SELL';
    qty: number;
    price: number;
    division: Division;
  }): Promise<void> => {
    const sideLabel = params.side === 'BUY' ? '매수' : '매도';
    const priceLabel =
      params.division === 'MARKET' ? '시장가' : `${thousandSeparator(String(params.price))}원`;
    try {
      const result = await actions.place({
        pdno: selection.pdno,
        side: params.side,
        qty: params.qty,
        price: params.price,
        division: params.division,
      });
      const placed = result as { odno?: string } | undefined;
      dialog.success({
        title: '주문 완료',
        message: `${nextNth}차 ${sideLabel} 주문 완료 — ${selection.name} ${thousandSeparator(String(params.qty))}주 @ ${priceLabel}`,
      });
      if (placed?.odno) props.onPlaced?.({ odno: placed.odno, side: params.side });
    } catch (error) {
      dialog.error({
        title: '주문 실패',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const submit = async (chosenSide: 'BUY' | 'SELL'): Promise<void> => {
    if (!(chosenSide === 'BUY' ? canBuy : canSell)) return;

    const snap = safetyQuery.data;
    if (snap !== undefined) {
      if (!snap.master) {
        dialog.error({
          title: '자동매매 잠금',
          message: '글로벌 자동매매가 OFF 상태입니다. 헤더에서 자동매매를 켜주세요.',
        });
        return;
      }
      if (snap.bySymbol[selection.pdno] === false) {
        dialog.error({
          title: '종목 잠금',
          message: `${selection.name} 종목의 자동매매가 OFF 입니다.`,
        });
        return;
      }
      if (snap.errorLock.active) {
        dialog.error({
          title: '에러 잠금',
          message:
            snap.errorLock.reason ?? '에러 잠금 상태입니다. 잠금을 해제한 후 다시 시도하세요.',
        });
        return;
      }
    }

    const params = { side: chosenSide, qty, price, division };
    if (!isProd && oneClick) {
      void executeOrder(params);
      return;
    }

    const sideLabel = chosenSide === 'BUY' ? '매수' : '매도';
    const divisionLabel = division === 'MARKET' ? '시장가' : '지정가';
    const priceLabel = division === 'MARKET' ? '시장가' : `${thousandSeparator(String(price))}원`;
    const confirmed = await dialog.openAsync({
      type: isProd ? 'WARNING' : 'INFO',
      accentColor: chosenSide === 'BUY' ? 'var(--up)' : 'var(--down)',
      title: isProd ? `⚠ 실전(PROD) ${sideLabel} 확인` : '주문 확인',
      confirmText: isProd ? `⚠ 실전 ${sideLabel} 확정` : `${sideLabel} 확정`,
      cancelText: '취소',
      isCancelWith: true,
      isOverlayPressClose: !isProd,
      message: (
        <OrderConfirmSummary
          division={division}
          divisionLabel={divisionLabel}
          isProd={isProd}
          nextNth={nextNth}
          priceLabel={priceLabel}
          qty={qty}
          selection={selection}
          side={chosenSide}
          sideLabel={sideLabel}
        />
      ),
    });

    if (confirmed) {
      void executeOrder(params);
    }
  };

  return (
    <form
      className="panel order-ticket-form"
      onSubmit={(event) => event.preventDefault()}
      aria-label="즉시 주문 티켓"
    >
      <div className="panel__title">
        즉시 주문 —{' '}
        {selection.name && selection.name !== selection.pdno
          ? `${selection.name} (${selection.pdno})`
          : selection.pdno}
      </div>
      <div className="order-ticket-form__scroll">
        <OrderTicketFields
          deposit={deposit}
          division={division}
          holdingQty={holdingQty}
          maxBuyQty={maxBuyQty}
          nextNth={nextNth}
          overBuyCap={overBuyCap}
          priceStr={priceStr}
          qtyStr={qtyStr}
          setDivision={setDivision}
          setPriceStr={setPriceStr}
          setQtyStr={setQtyStr}
        />
        <OrderTicketSummary
          division={division}
          holdingQty={holdingQty}
          isProd={isProd}
          maxBuyQty={maxBuyQty}
          oneClick={oneClick}
          overBuyCap={overBuyCap}
          overSellCap={overSellCap}
          priceStr={priceStr}
          qtyStr={qtyStr}
          suggestedPrice={selection.suggestedPrice}
        />
        <OrderTicketActions
          canBuy={canBuy}
          canSell={canSell}
          holdingQty={holdingQty}
          maxBuyQty={maxBuyQty}
          overBuyCap={overBuyCap}
          overSellCap={overSellCap}
          submit={submit}
        />
      </div>
    </form>
  );
};
