import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

interface Props {
  count: number;
  ratioPct: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 적용 확인 모달 — 변경 차수 수와 비율을 확인하고 자동매매 OFF 됨을 알린다.
 */
export const PriceRatioConfirmModal = ({
  count,
  ratioPct,
  onCancel,
  onConfirm,
}: Props): ReactElement => {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="적용 확인">
      <div className="modal panel">
        <div className="panel__title">적용 확인</div>
        <div className="panel__body" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
          <p>
            <strong>{count}</strong>개 차수의 매입단가를{' '}
            <strong>
              {ratioPct > 0 ? '+' : ''}
              {ratioPct}%
            </strong>{' '}
            변경하시겠습니까?
          </p>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
            - 자동매매는 자동으로 OFF됩니다
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={onCancel} dense>
              취소
            </Button>
            <Button onClick={onConfirm} variant="primary" dense>
              확인
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
