import { useBalanceWithLots } from '@renderer/entities/account';
import { OrderConfirmDialog } from '@renderer/features/order-confirm-dialog';
import { SearchStockInput } from '@renderer/features/search-stock';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, NumberInput, Select } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
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
  /**
   * 주문 대상 종목을 티켓 내부에서 바꿀 때 호출. 제공 시 상단에 자동완성 검색창이 노출된다.
   * 제공하지 않으면 종목 검색 UI는 숨겨진다(기존 동작 유지).
   */
  onSelectionChange?: (next: { pdno: string; name: string }) => void;
  onPlaced?: (result: { odno: string; side: 'BUY' | 'SELL' }) => void;
}

type Division = 'LIMIT' | 'MARKET';

interface PendingConfirm {
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  division: Division;
}

/**
 * 수동 매수/매도 주문 폼.
 * - 종목/가격/수량/구분 입력, 매수/매도 버튼 분리
 * - selection.suggestedPrice 변경 시 price 필드 자동 업데이트(prefill)
 * - 확인이 필요한 상황(PROD 또는 oneClick=false)에서는 OrderConfirmDialog 로 2단계 없는 단일 확인 모달
 * - onSelectionChange 제공 시 상단에 종목 검색 자동완성 입력창
 */
export const OrderTicket = (props: OrderTicketProps): ReactElement => {
  const { selection, isProd, oneClick, onSelectionChange } = props;
  const [side, setSide] = useState<'BUY' | 'SELL'>(selection.suggestedSide ?? 'BUY');
  const [division, setDivision] = useState<Division>('LIMIT');
  const [qtyStr, setQtyStr] = useState('1');
  const [priceStr, setPriceStr] = useState(
    selection.suggestedPrice ? String(selection.suggestedPrice) : '',
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
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

  const executeOrder = async (confirmed: PendingConfirm): Promise<void> => {
    const sideLabel = confirmed.side === 'BUY' ? '매수' : '매도';
    const priceLabel =
      confirmed.division === 'MARKET' ? '시장가' : `${thousandSeparator(String(confirmed.price))}원`;
    try {
      const result = await actions.place({
        pdno: selection.pdno,
        side: confirmed.side,
        qty: confirmed.qty,
        price: confirmed.price,
        division: confirmed.division,
      });
      const r = result as { odno?: string } | undefined;
      toast.success(
        `${nextNth}차 ${sideLabel} 주문 완료 — ${selection.name} ${thousandSeparator(String(confirmed.qty))}주 @ ${priceLabel}`,
      );
      if (r?.odno) props.onPlaced?.({ odno: r.odno, side: confirmed.side });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`주문 실패: ${msg}`, { duration: 6000 });
    }
  };

  const submit = (chosenSide: 'BUY' | 'SELL'): void => {
    if (!canSubmit) return;
    const params: PendingConfirm = { side: chosenSide, qty, price, division };
    const mustConfirm = isProd || !oneClick;
    if (mustConfirm) {
      setPendingConfirm(params);
      return;
    }
    void executeOrder(params);
  };

  return (
    <>
      <form
        className="panel order-ticket-form"
        onSubmit={(e) => e.preventDefault()}
        aria-label="즉시 주문 티켓"
      >
        <div className="panel__title">
          즉시 주문 — {selection.name} ({selection.pdno})
        </div>
        <div className="order-ticket-form__scroll">
          {onSelectionChange ? (
            <div className="panel__body" style={{ maxWidth: 360 }}>
              <SearchStockInput
                placeholder="종목 변경 (종목명/코드)"
                onSelect={(hit) => onSelectionChange({ pdno: hit.pdno, name: hit.name })}
              />
            </div>
          ) : null}
          <div className="panel__body" style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span className="muted" style={{ fontSize: '0.9rem' }}>
                매수 차수
              </span>
              <span className="chip" style={{ fontSize: '0.9rem' }}>
                {nextNth}차
              </span>
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
                submit('BUY');
              }}
              aria-label="매수 주문"
            >
              매수
              <kbd className="kbd">F3</kbd>
            </Button>
            <Button
              disabled={!canSubmit}
              className="hts-btn--down"
              dense
              onClick={() => {
                setSide('SELL');
                submit('SELL');
              }}
              aria-label="매도 주문"
            >
              매도
              <kbd className="kbd">F4</kbd>
            </Button>
          </div>
          <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
            현재 선택: {side} · {division === 'MARKET' ? '시장가' : '지정가'} ·{' '}
            {qtyStr ? thousandSeparator(qtyStr) : '0'}주
            {division === 'LIMIT' && priceStr ? ` · ${thousandSeparator(priceStr)}원` : ''}
            {oneClick && !isProd ? ' · 원터치 ON' : ''}
          </div>
        </div>
      </form>
      <OrderConfirmDialog
        open={pendingConfirm !== null}
        isProd={isProd}
        pdno={selection.pdno}
        name={selection.name}
        side={pendingConfirm?.side ?? 'BUY'}
        qty={pendingConfirm?.qty ?? 0}
        price={pendingConfirm?.price ?? 0}
        division={pendingConfirm?.division ?? 'LIMIT'}
        nextNth={nextNth}
        onConfirm={() => {
          if (!pendingConfirm) return;
          const params = pendingConfirm;
          setPendingConfirm(null);
          void executeOrder(params);
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </>
  );
};
