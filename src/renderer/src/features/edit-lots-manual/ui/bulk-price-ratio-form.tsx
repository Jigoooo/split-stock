import { trpc } from '@renderer/shared/api/trpc';
import { Button, NumberInput } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';

export interface BulkPriceRatioFormProps {
  accountId: number;
  pdno: string;
  onApplied?: (insertedCount: number) => void;
}

/**
 * 액면분할 일괄 보정 — (accountId, pdno) 의 모든 차수 buyPrice 에 ratio 곱.
 * 적용 후 응답에 before/after 가 포함되어 호출측에서 결과 비교 처리.
 */
export const BulkPriceRatioForm = (props: BulkPriceRatioFormProps): ReactElement => {
  const { accountId, pdno, onApplied } = props;
  const [ratioPct, setRatioPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const applyMutation = trpc.lotsManual.applyStockSplitRatio.useMutation();

  const onApplyClick = (): void => {
    if (ratioPct === 0) {
      setError('0% 보정은 의미가 없습니다.');
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const onConfirm = async (): Promise<void> => {
    try {
      const res = await applyMutation.mutateAsync({ accountId, pdno, ratioPct });
      setConfirming(false);
      setRatioPct(0);
      onApplied?.(res.after.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirming(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <label htmlFor="bulk-ratio" style={{ display: 'grid', gap: '0.3rem' }}>
        <span className="muted">액면분할 단가 보정율 (%)</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <NumberInput
            id="bulk-ratio"
            value={String(ratioPct)}
            onValueChange={(v) => setRatioPct(Number(v) || 0)}
            allowDecimal
            min="-99.99"
            max="1000"
            dense
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
            {ratioPct > 0 ? '+' : ''}
            {ratioPct}%
          </span>
        </div>
      </label>
      {error && (
        <div className="chip chip--down" role="alert">
          {error}
        </div>
      )}
      <Button onClick={onApplyClick} disabled={applyMutation.isPending} variant="primary" dense>
        보정 적용
      </Button>
      {confirming && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="액면분할 적용 확인"
        >
          <div className="modal panel">
            <div className="panel__title">액면분할 단가 일괄 보정</div>
            <div
              className="panel__body"
              style={{ padding: '1rem', display: 'grid', gap: '0.8rem' }}
            >
              <p>
                <strong>{pdno}</strong> 종목의 <strong>모든</strong> 차수 매입단가가{' '}
                <strong>
                  {ratioPct > 0 ? '+' : ''}
                  {ratioPct}%
                </strong>{' '}
                보정됩니다.
              </p>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                · 변경 후 자동 백업이 실행됩니다.
                <br />· Undo 가능 (직전 변경 1회).
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <Button onClick={() => setConfirming(false)} dense>
                  취소
                </Button>
                <Button
                  onClick={() => {
                    void onConfirm();
                  }}
                  variant="primary"
                  dense
                >
                  확인
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
