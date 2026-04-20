import { useBalanceWithLots } from '@renderer/entities/account';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, NumberInput, Select } from '@renderer/shared/ui';
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
 * - 종목/가격/수량/구분 입력, 매수/매도 버튼 분리
 * - selection.suggestedPrice 변경 시 price 필드 자동 업데이트(prefill)
 * - PROD에서는 확인 모달 강제(오입력 방지)
 */
export const OrderTicket = (props: OrderTicketProps): ReactElement => {
  const { selection, isProd, oneClick } = props;
  const [side, setSide] = useState<'BUY' | 'SELL'>(selection.suggestedSide ?? 'BUY');
  const [division, setDivision] = useState<Division>('LIMIT');
  const [qtyStr, setQtyStr] = useState('1');
  const [priceStr, setPriceStr] = useState(
    selection.suggestedPrice ? String(selection.suggestedPrice) : '',
  );
  const suggestionKey = `${selection.pdno}:${selection.suggestedPrice ?? ''}:${selection.suggestedSide ?? ''}`;
  const [appliedSuggestionKey, setAppliedSuggestionKey] = useState(suggestionKey);
  const actions = useOrderActions();
  const { lotsByPdno } = useBalanceWithLots();

  const lots = lotsByPdno[selection.pdno] ?? [];
  const openCount = lots.filter((l) => l.status === 'OPEN' || l.status === 'BUYING').length;
  const nextNth = openCount + 1;

  if (appliedSuggestionKey !== suggestionKey) {
    setAppliedSuggestionKey(suggestionKey);
    if (selection.suggestedPrice !== undefined) {
      setPriceStr(String(selection.suggestedPrice));
    }
    if (selection.suggestedSide) setSide(selection.suggestedSide);
  }

  const qty = Number(qtyStr);
  const price = division === 'MARKET' ? 0 : Number(priceStr);
  const validQty = Number.isInteger(qty) && qty > 0;
  const validPrice = division === 'MARKET' || (Number.isInteger(price) && price > 0);
  const canSubmit = validQty && validPrice && !actions.isPending;

  const submit = async (chosenSide: 'BUY' | 'SELL'): Promise<void> => {
    if (!canSubmit) return;
    const mustConfirm = isProd || !oneClick;
    if (mustConfirm) {
      const verb = chosenSide === 'BUY' ? '매수' : '매도';
      const msg =
        `${selection.pdno} (${selection.name})\n` +
        `${verb} ${thousandSeparator(qty)}주 · ${division === 'MARKET' ? '시장가' : `${thousandSeparator(price)}원`}\n\n` +
        `${isProd ? '⚠️ 실전 계좌로 ' : ''}주문하시겠습니까?`;
      if (!window.confirm(msg)) return;
    }
    const result = await actions.place({
      pdno: selection.pdno,
      side: chosenSide,
      qty,
      price,
      division,
    });
    const r = result as { odno?: string } | undefined;
    if (r?.odno) props.onPlaced?.({ odno: r.odno, side: chosenSide });
  };

  return (
    <form
      className="panel order-ticket-form"
      onSubmit={(e) => e.preventDefault()}
      aria-label="즉시 주문 티켓"
    >
      <div className="panel__title">
        즉시 주문 — {selection.name} ({selection.pdno})
      </div>
      <div className="order-ticket-form__scroll">
        <div className="panel__body" style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span className="muted" style={{ fontSize: '0.9rem' }}>매수 차수</span>
            <span className="chip" style={{ fontSize: '0.9rem' }}>{nextNth}차</span>
          </div>
          <label htmlFor="order-division" style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="muted">구분</span>
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
          </label>
          <label htmlFor="order-qty" style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="muted">수량</span>
            <NumberInput
              id="order-qty"
              value={qtyStr}
              onValueChange={setQtyStr}
              aria-label="주문 수량"
              dense
            />
          </label>
          <label htmlFor="order-price" style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="muted">가격</span>
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
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
        >
          <Button
            disabled={!canSubmit}
            variant="danger"
            dense
            onClick={() => {
              setSide('BUY');
              void submit('BUY');
            }}
            aria-label="매수 주문"
          >
            매수
          </Button>
          <Button
            disabled={!canSubmit}
            className="hts-btn--down"
            dense
            onClick={() => {
              setSide('SELL');
              void submit('SELL');
            }}
            aria-label="매도 주문"
          >
            매도
          </Button>
        </div>
        {actions.lastError ? (
          <div className="panel__body">
            <span className="chip chip--down" role="alert">
              {actions.lastError}
            </span>
          </div>
        ) : null}
        <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
          현재 선택: {side} · {division === 'MARKET' ? '시장가' : '지정가'} ·{' '}
          {qtyStr ? thousandSeparator(qtyStr) : '0'}주
          {division === 'LIMIT' && priceStr ? ` · ${thousandSeparator(priceStr)}원` : ''}
          {oneClick && !isProd ? ' · 원터치 ON' : ''}
        </div>
      </div>
    </form>
  );
};
