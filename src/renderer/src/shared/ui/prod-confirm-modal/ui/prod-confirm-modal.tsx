import { type ReactElement, type ReactNode, useEffect } from 'react';
import { Button } from '../../button';
import { Checkbox } from '../../checkbox';
import { TextInput } from '../../text-input';
import { PROD_CONFIRM_PHRASE } from '../lib/constants';
import { usePhraseGate } from '../model/use-phrase-gate';

export interface ProdConfirmModalProps {
  open: boolean;
  pending?: boolean | undefined;
  /** 모달 헤더 텍스트. 기본: '실전(PROD) 진행 확인'. */
  title?: string | undefined;
  /** 추가 안내. 기본 안내문 위에 prepend. */
  message?: ReactNode | undefined;
  /** confirm 버튼 라벨. 기본: '실전 진행'. */
  confirmText?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 실전(PROD) 환경 게이트 모달 — 체크박스 동의 + phrase 타이핑 2단계 검증.
 *
 * 진입점: 헤더 환경 전환, 로그인 폼, 계좌 추가 폼 등 PROD 활성화/저장이 발생하는 모든 흐름.
 * 모달이 열릴 때마다 phrase/ack state 자동 reset (open transition 감지).
 */
export const ProdConfirmModal = (props: ProdConfirmModalProps): ReactElement | null => {
  const {
    open,
    pending,
    title = '실전(PROD) 진행 확인',
    message,
    confirmText = '실전 진행',
    onConfirm,
    onCancel,
  } = props;
  const gate = usePhraseGate();
  const { reset } = gate;

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  const handleConfirm = (): void => {
    if (!gate.canConfirm || pending) return;
    onConfirm();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal panel">
        <div className="panel__title">
          {title} <span className="env-badge env-badge--prod">PROD</span>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
          {message ? <div>{message}</div> : null}
          <div className="muted">이후 모든 주문은 실제 계좌로 체결됩니다. 돌이킬 수 없습니다.</div>
          <Checkbox
            aria-label="실전 모드 동의"
            checked={gate.ack}
            onChange={(e) => gate.setAck(e.target.checked)}
            label="실전 모드임을 이해했고 계속 진행하는 데 동의합니다."
            dense
          />
          <label htmlFor="prod-confirm-phrase" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>
              아래에 <code>{PROD_CONFIRM_PHRASE}</code> 이라고 정확히 타이핑하세요:
            </span>
            <TextInput
              id="prod-confirm-phrase"
              type="text"
              value={gate.phrase}
              onChange={(e) => gate.setPhrase(e.target.value)}
              placeholder={PROD_CONFIRM_PHRASE}
              aria-label="실전전환 확인 문구"
              autoComplete="off"
              spellCheck={false}
              dense
            />
          </label>
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onCancel} disabled={pending} dense>
            취소
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!gate.canConfirm}
            loading={pending}
            loadingText="진행 중…"
            variant="destructive"
            aria-label={`${confirmText} (실전)`}
            dense
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};
