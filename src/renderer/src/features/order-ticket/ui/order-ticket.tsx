import { useBalanceWithLots } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, dialog, NumberInput, Select } from '@renderer/shared/ui';
import { deriveNextBuyNth } from '@shared/trading/next-nth';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useOrderActions } from '../model/use-order-actions';

export interface OrderTicketSelection {
  pdno: string;
  name: string;
  /** 호가창 클릭으로 prefill 된 가격 (선택). */
  suggestedPrice?: number;
  suggestedSide?: 'BUY' | 'SELL';
}

export interface OrderTicketProps {
  selection: OrderTicketSelection;
  /** PROD 환경일 때 true — 원터치 off + 확인 모달 강제. */
  isProd: boolean;
  /** 사용자가 원터치(확인 모달 생략) 설정을 켰는지. PROD에서는 무시됨. */
  oneClick: boolean;
  onPlaced?: (result: { odno: string; side: 'BUY' | 'SELL' }) => void;
}

type Division = 'LIMIT' | 'MARKET';

/**
 * 수동 매수/매도 주문 폼.
 * - 종목은 상위 페이지의 검색/선택으로만 변경 — 티켓 내부에는 종목 변경 UI 없음
 * - selection.suggestedPrice 변경 시 price 필드 자동 업데이트(prefill)
 * - 확인이 필요한 상황(PROD 또는 oneClick=false)에서는 dialog.openAsync + renderActions로 확인 모달
 * - 매수: 예수금/가격 → maxBuyQty, 매도: 보유수량 → holdingQty. 초과 시 버튼 disable + 안내.
 */
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

  const lots = lotsByPdno[selection.pdno] ?? [];
  const nextNth = deriveNextBuyNth(lots);

  if (appliedSuggestionKey !== suggestionKey) {
    setAppliedSuggestionKey(suggestionKey);
    if (selection.suggestedPrice !== undefined) {
      setPriceStr(String(selection.suggestedPrice));
    }
  }

  const qty = Number(qtyStr);
  const price = division === 'MARKET' ? 0 : Number(priceStr);
  const validQty = Number.isInteger(qty) && qty > 0;
  const validPrice = division === 'MARKET' || (Number.isInteger(price) && price > 0);

  // 매수 상한 — 지정가일 때만 계산 가능. 시장가는 가격이 확정되지 않으므로 UI 상한 미적용.
  const maxBuyQty =
    division === 'LIMIT' && price > 0 && deposit > 0 ? Math.floor(deposit / price) : null;
  // 매도 상한 — 현재 활성 계좌의 해당 종목 보유수량.
  //   (ord_psbl_qty 가 이상적이나 현 잔고 응답에서 별도 노출되지 않아 hldg_qty 로 근사.)
  const holdingQty = positions.find((p) => p.code === selection.pdno)?.qty ?? 0;

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
      const r = result as { odno?: string } | undefined;
      dialog.success({
        title: '주문 완료',
        message: `${nextNth}차 ${sideLabel} 주문 완료 — ${selection.name} ${thousandSeparator(String(params.qty))}주 @ ${priceLabel}`,
      });
      if (r?.odno) props.onPlaced?.({ odno: r.odno, side: params.side });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dialog.error({
        title: '주문 실패',
        message: msg,
      });
    }
  };

  const submit = async (chosenSide: 'BUY' | 'SELL'): Promise<void> => {
    if (!(chosenSide === 'BUY' ? canBuy : canSell)) return;

    // safety 사전 체크 — 서버 가드 전에 즉시 안내
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
    const mustConfirm = isProd || !oneClick;
    if (!mustConfirm) {
      void executeOrder(params);
      return;
    }

    const sideLabel = chosenSide === 'BUY' ? '매수' : '매도';
    const divisionLabel = division === 'MARKET' ? '시장가' : '지정가';
    const priceLabel = division === 'MARKET' ? '시장가' : `${thousandSeparator(String(price))}원`;

    const confirmed = await dialog.openAsync({
      type: isProd ? 'WARNING' : 'INFO',
      title: '주문 확인',
      confirmText: `${sideLabel} 확정`,
      cancelText: '취소',
      isCancelWith: true,
      isOverlayPressClose: true,
      message: (
        <div className="order-confirm-summary">
          <dl className="order-confirm-summary__dl">
            <dt>종목</dt>
            <dd>
              <span className="num">{selection.pdno}</span> {selection.name}
            </dd>
            <dt>구분</dt>
            <dd>
              <span className={chosenSide === 'BUY' ? 'num-up' : 'num-down'}>{sideLabel}</span>
              {' · '}
              {divisionLabel}
              {chosenSide === 'BUY' ? (
                <>
                  {' · '}
                  <span className="chip">{nextNth}차</span>
                </>
              ) : null}
            </dd>
            <dt>수량</dt>
            <dd className="num">{thousandSeparator(String(qty))}주</dd>
            <dt>가격</dt>
            <dd className="num">{priceLabel}</dd>
          </dl>
          {isProd ? (
            <p className="order-confirm-summary__warning">
              실전 계좌로 실제 주문이 체결됩니다. 종목·수량·가격을 다시 확인하세요.
            </p>
          ) : null}
        </div>
      ),
    });

    if (confirmed) {
      void executeOrder(params);
    }
  };

  return (
    <form
      className="panel order-ticket-form"
      onSubmit={(e) => e.preventDefault()}
      aria-label="즉시 주문 티켓"
    >
      <div className="panel__title">
        즉시 주문 —{' '}
        {selection.name && selection.name !== selection.pdno
          ? `${selection.name} (${selection.pdno})`
          : selection.pdno}
      </div>
      <div className="order-ticket-form__scroll">
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
              onChange={(e) => setDivision(e.target.value as Division)}
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
        <div className="panel__body order-ticket-form__actions">
          <Button
            disabled={!canBuy}
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
            <kbd className="kbd">F3</kbd>
          </Button>
          <Button
            disabled={!canSell}
            className="hts-btn--down"
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
            <kbd className="kbd">F4</kbd>
          </Button>
        </div>
        <div className="panel__body muted order-ticket-form__summary">
          현재 선택: {division === 'MARKET' ? '시장가' : '지정가'} ·{' '}
          {qtyStr ? thousandSeparator(qtyStr) : '0'}주
          {division === 'LIMIT' && priceStr ? ` · ${thousandSeparator(priceStr)}원` : ''}
          {oneClick && !isProd ? ' · 원터치 ON' : ''}
          {overBuyCap ? (
            <div className="order-ticket-form__summary-alert num-down">
              매수 불가 — 예수금 부족 (최대{' '}
              {maxBuyQty === null ? '—' : thousandSeparator(maxBuyQty)}주)
            </div>
          ) : null}
          {overSellCap ? (
            <div className="order-ticket-form__summary-alert num-down">
              매도 불가 — 보유 수량 초과 (보유 {thousandSeparator(holdingQty)}주)
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
};
