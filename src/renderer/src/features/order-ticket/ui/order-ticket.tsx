import type { ChangeEvent, ReactElement } from 'react';
import { useEffect, useState } from 'react';
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
  const actions = useOrderActions();

  useEffect(() => {
    if (selection.suggestedPrice !== undefined) {
      setPriceStr(String(selection.suggestedPrice));
    }
    if (selection.suggestedSide) setSide(selection.suggestedSide);
  }, [selection.suggestedPrice, selection.suggestedSide]);

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
        `${verb} ${qty}주 · ${division === 'MARKET' ? '시장가' : `${price.toLocaleString('ko-KR')}원`}\n\n` +
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
    <form className="panel" onSubmit={(e) => e.preventDefault()} aria-label="즉시 주문 티켓">
      <div className="panel__title">
        즉시 주문 — {selection.name} ({selection.pdno}){' '}
        {isProd ? <span className="chip chip--down">PROD</span> : null}
      </div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
        <label>
          구분:{' '}
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value as Division)}
            aria-label="주문 구분"
          >
            <option value="LIMIT">지정가</option>
            <option value="MARKET">시장가</option>
          </select>
        </label>
        <label>
          수량:{' '}
          <input
            type="number"
            min={1}
            step={1}
            value={qtyStr}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQtyStr(e.target.value)}
            aria-label="주문 수량"
          />
        </label>
        <label>
          가격:{' '}
          <input
            type="number"
            min={0}
            step={1}
            value={division === 'MARKET' ? '시장가' : priceStr}
            disabled={division === 'MARKET'}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPriceStr(e.target.value)}
            aria-label="주문 가격"
          />
        </label>
      </div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
      >
        <button
          type="button"
          className="hts-btn num-up"
          disabled={!canSubmit}
          onClick={() => {
            setSide('BUY');
            void submit('BUY');
          }}
          aria-label="매수 주문"
        >
          매수
        </button>
        <button
          type="button"
          className="hts-btn num-down"
          disabled={!canSubmit}
          onClick={() => {
            setSide('SELL');
            void submit('SELL');
          }}
          aria-label="매도 주문"
        >
          매도
        </button>
      </div>
      {actions.lastError ? (
        <div className="panel__body">
          <span className="chip chip--down" role="alert">
            {actions.lastError}
          </span>
        </div>
      ) : null}
      <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
        현재 선택: {side} · {division === 'MARKET' ? '시장가' : '지정가'} · {qtyStr}주
        {oneClick && !isProd ? ' · 원터치 ON' : ''}
      </div>
    </form>
  );
};
