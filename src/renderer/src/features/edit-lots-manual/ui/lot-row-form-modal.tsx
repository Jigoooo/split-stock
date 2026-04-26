import { Button, DateInput, NumberInput } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';

export interface LotRowDraft {
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: string;
  boughtAtMs: number;
}

export interface LotRowFormModalProps {
  onSubmit: (row: LotRowDraft) => void;
  onClose: () => void;
}

/**
 * 차수 행 추가 모달 (snapshot lotId 부재로 add 전용).
 */
export const LotRowFormModal = (props: LotRowFormModalProps): ReactElement => {
  const { onSubmit, onClose } = props;
  const [nth, setNth] = useState('1');
  const [buyPrice, setBuyPrice] = useState('0');
  const [qty, setQty] = useState('0');
  const [boughtAt, setBoughtAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const onApply = (): void => {
    const nthN = Number(nth);
    const priceN = Number(buyPrice);
    const qtyN = Number(qty);
    const boughtAtMs = Date.parse(`${boughtAt}T00:00:00.000Z`);
    if (!Number.isInteger(nthN) || nthN < 1) {
      setError('차수는 1 이상의 정수');
      return;
    }
    if (!Number.isInteger(priceN) || priceN < 1) {
      setError('매입가는 1 이상의 정수');
      return;
    }
    if (!Number.isInteger(qtyN) || qtyN < 1) {
      setError('수량은 1 이상의 정수');
      return;
    }
    if (Number.isNaN(boughtAtMs)) {
      setError('매수일이 올바르지 않습니다');
      return;
    }
    const amountKrw = priceN * qtyN;
    onSubmit({
      nth: nthN,
      buyPrice: priceN,
      qty: qtyN,
      amountKrw,
      status: 'OPEN',
      boughtAtMs,
    });
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="차수 추가">
      <div className="modal panel">
        <div className="panel__title">새 차수 추가</div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.6rem' }}>
          <label htmlFor="lot-nth" style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted">차수</span>
            <NumberInput id="lot-nth" value={nth} onValueChange={setNth} min="1" dense />
          </label>
          <label htmlFor="lot-buyprice" style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted">매입가 (원)</span>
            <NumberInput
              id="lot-buyprice"
              value={buyPrice}
              onValueChange={setBuyPrice}
              min="1"
              dense
            />
          </label>
          <label htmlFor="lot-qty" style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted">수량</span>
            <NumberInput id="lot-qty" value={qty} onValueChange={setQty} min="1" dense />
          </label>
          <label htmlFor="lot-boughtat" style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted">매수일 (YYYY-MM-DD)</span>
            <DateInput
              id="lot-boughtat"
              value={boughtAt}
              onChange={(e) => setBoughtAt(e.target.value)}
              aria-label="매수일"
              placeholder="2026-04-01"
              dense
            />
          </label>
          {error && (
            <div className="chip chip--down" role="alert">
              {error}
            </div>
          )}
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onClose} dense>
            취소
          </Button>
          <Button onClick={onApply} variant="primary" dense>
            추가
          </Button>
        </div>
      </div>
    </div>
  );
};
