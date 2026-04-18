import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { PROD_CONFIRM_PHRASE } from '../model/constants';

type Env = 'MOCK' | 'PROD';

export interface SwitchEnvDialogProps {
  open: boolean;
  target: Env;
  pending?: boolean;
  onConfirm: (target: Env) => void;
  onCancel: () => void;
}

/**
 * 환경 전환 확인 모달.
 * - MOCK 전환: 1단계(간단 확인)
 * - PROD 전환: 2단계(경고/배지 미리보기 + 체크박스 + "실전전환" 타이핑)
 *
 * 보안 불변식: PROD 활성화는 실제 자금 거래. 실수 방지가 목적.
 */
export const SwitchEnvDialog = (props: SwitchEnvDialogProps): ReactElement | null => {
  const { open, target, pending, onConfirm, onCancel } = props;
  const [step, setStep] = useState<1 | 2>(1);
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState('');

  useEffect(() => {
    if (!open) {
      setStep(1);
      setAck(false);
      setPhrase('');
    }
  }, [open]);

  if (!open) return null;

  const isProd = target === 'PROD';
  const phraseOk = phrase === PROD_CONFIRM_PHRASE;
  const canConfirm = isProd ? step === 2 && ack && phraseOk : true;

  const onPrimary = (): void => {
    if (isProd && step === 1) {
      setStep(2);
      return;
    }
    if (!canConfirm) return;
    onConfirm(target);
  };

  const stepLabel = isProd ? `${step}/2` : '';

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="환경 전환 확인">
      <div className="modal panel">
        <div className="panel__title">
          환경 전환 {stepLabel} {isProd ? '— ⚠️ 실전(PROD)' : '— 모의(MOCK)'}
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: '1.0rem' }}>
          {!isProd ? (
            <div>모의(MOCK) 환경으로 전환합니다. 실제 주문은 발생하지 않습니다.</div>
          ) : step === 1 ? (
            <>
              <div>
                <strong>실전(PROD) 환경으로 전환합니다.</strong>
              </div>
              <div className="muted">
                이후 모든 주문은 실제 계좌로 체결됩니다. 돌이킬 수 없습니다.
              </div>
              <div>
                <span className="env-badge env-badge--prod">PROD</span>
              </div>
            </>
          ) : (
            <>
              <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  aria-label="실전 모드 동의"
                />
                <span>실전 모드임을 이해했고 계속 진행하는 데 동의합니다.</span>
              </label>
              <label style={{ display: 'grid', gap: '0.4rem' }}>
                <span>
                  아래에 <code>{PROD_CONFIRM_PHRASE}</code> 이라고 정확히 타이핑하세요:
                </span>
                <input
                  type="text"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={PROD_CONFIRM_PHRASE}
                  aria-label="실전전환 확인 문구"
                />
              </label>
            </>
          )}
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
        >
          <button type="button" className="hts-btn" onClick={onCancel} disabled={pending}>
            취소
          </button>
          <button
            type="button"
            className={
              canConfirm || (isProd && step === 1) ? 'hts-btn hts-btn--primary' : 'hts-btn'
            }
            onClick={onPrimary}
            disabled={pending || (isProd && step === 2 && !canConfirm)}
            aria-label={isProd && step === 1 ? '다음 단계' : '전환 확정'}
          >
            {isProd && step === 1 ? '다음' : '전환'}
          </button>
        </div>
      </div>
    </div>
  );
};
