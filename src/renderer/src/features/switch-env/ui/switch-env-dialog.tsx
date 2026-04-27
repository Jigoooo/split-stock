import { Button, ProdConfirmModal } from '@renderer/shared/ui';
import type { AppEnv } from '@shared/contracts';
import type { ReactElement } from 'react';

type Env = AppEnv;

export interface SwitchEnvDialogProps {
  open: boolean;
  target: Env;
  pending?: boolean;
  onConfirm: (target: Env) => void;
  onCancel: () => void;
}

/**
 * 환경 전환 확인 모달 — thin wrapper.
 * - PROD 전환: 공용 ProdConfirmModal 위임 (체크박스 + phrase 2단계 보호)
 * - MOCK 전환: 단순 확인 모달 (위험 없음)
 *
 * 보안 불변식: PROD 활성화는 실제 자금 거래. 실수 방지가 목적.
 */
export const SwitchEnvDialog = (props: SwitchEnvDialogProps): ReactElement | null => {
  const { open, target, pending, onConfirm, onCancel } = props;

  if (target === 'PROD') {
    return (
      <ProdConfirmModal
        open={open}
        pending={pending}
        title="실전(PROD) 환경 전환"
        message={<strong>실전(PROD) 환경으로 전환합니다.</strong>}
        confirmText="실전 전환"
        onConfirm={() => onConfirm('PROD')}
        onCancel={onCancel}
      />
    );
  }

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="환경 전환 — 모의(MOCK)"
    >
      <div className="modal panel">
        <div className="panel__title">환경 전환 — 모의(MOCK)</div>
        <div className="panel__body">
          모의(MOCK) 환경으로 전환합니다. 실제 주문은 발생하지 않습니다.
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onCancel} disabled={pending} dense>
            취소
          </Button>
          <Button onClick={() => onConfirm('MOCK')} disabled={pending} variant="primary" dense>
            전환
          </Button>
        </div>
      </div>
    </div>
  );
};
