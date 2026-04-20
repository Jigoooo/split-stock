import { Button, Checkbox, TextInput } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';
import { MANUAL_EDIT_CONFIRM_PHRASE } from '../model/constants';

export interface EditLotsModeToggleProps {
  /** 활성 계좌 ID — 모드 enter mutation 에 전달 */
  accountId: number | null;
  /** 현재 자동매매 master 상태 — ON 이면 진입 차단 + 안내 */
  masterSafetyOn: boolean;
  /** 모드 활성 여부 — true 면 "수동편집 모드 종료" 버튼 표시 */
  active: boolean;
  /** 2단계 확인 통과 시 호출 */
  onEnter: () => void | Promise<void>;
  /** 종료 버튼 클릭 시 호출 */
  onExit: () => void;
  busy?: boolean;
}

/**
 * 차수 수동편집(A7) 진입 토글 — 가장 위험한 기능이라 2단계 확인.
 * 1단계: "수동편집 모드 진입" 안내 (자동매매 OFF 강제, 백업 자동 트리거 안내)
 * 2단계: '수동편집' 텍스트 입력 + 동의 체크박스
 *
 * 이미 모드가 active 면 "종료" 버튼만 노출.
 */
export const EditLotsModeToggle = (props: EditLotsModeToggleProps): ReactElement => {
  const { accountId, masterSafetyOn, active, onEnter, onExit, busy } = props;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState('');

  const reset = (): void => {
    setOpen(false);
    setStep(1);
    setAck(false);
    setPhrase('');
  };

  if (active) {
    return (
      <Button
        onClick={onExit}
        variant="default"
        dense
        aria-label="수동편집 모드 종료"
        disabled={busy}
      >
        수동편집 종료
      </Button>
    );
  }

  const phraseOk = phrase === MANUAL_EDIT_CONFIRM_PHRASE;
  const canConfirm = step === 2 && ack && phraseOk;
  const blocked = masterSafetyOn || accountId === null;

  const onPrimary = async (): Promise<void> => {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (!canConfirm) return;
    try {
      await onEnter();
      reset();
    } catch {
      // 부모가 lastError 표시
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={blocked}
        title={
          masterSafetyOn
            ? '자동매매가 ON 인 동안에는 수동편집을 진입할 수 없습니다.'
            : accountId === null
              ? '활성 계좌가 없습니다.'
              : '차수 수동편집 모드 진입 (위험)'
        }
        dense
      >
        수동편집 모드…
      </Button>
      {open && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="수동편집 모드 진입 확인"
        >
          <div className="modal panel">
            <div className="panel__title">차수 수동편집 모드 {step}/2 — ⚠️ 위험</div>
            <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
              {step === 1 ? (
                <>
                  <div>
                    <strong>차수 장부를 직접 수정합니다.</strong>
                  </div>
                  <ul className="muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    <li>자동매매 master safety 가 OFF 된 상태에서만 가능합니다.</li>
                    <li>변경은 장부상만 적용 — KIS 실제 잔고와 불일치할 수 있습니다.</li>
                    <li>모든 변경은 audit 로그로 보존되고 직후 자동 백업이 실행됩니다.</li>
                    <li>직전 변경 1회는 Undo 가능합니다.</li>
                  </ul>
                </>
              ) : (
                <>
                  <Checkbox
                    aria-label="수동편집 위험 동의"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                    label="장부와 KIS 잔고가 어긋날 수 있음을 이해했고 진행에 동의합니다."
                    dense
                  />
                  <label htmlFor="manual-edit-phrase" style={{ display: 'grid', gap: '0.4rem' }}>
                    <span>
                      아래에 <code>{MANUAL_EDIT_CONFIRM_PHRASE}</code> 이라고 정확히 타이핑하세요:
                    </span>
                    <TextInput
                      id="manual-edit-phrase"
                      type="text"
                      value={phrase}
                      onChange={(e) => setPhrase(e.target.value)}
                      placeholder={MANUAL_EDIT_CONFIRM_PHRASE}
                      aria-label="수동편집 확인 문구"
                      dense
                    />
                  </label>
                </>
              )}
            </div>
            <div
              className="panel__body"
              style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
            >
              <Button onClick={reset} disabled={busy} dense>
                취소
              </Button>
              <Button
                onClick={() => {
                  void onPrimary();
                }}
                disabled={busy || (step === 2 && !canConfirm)}
                aria-label={step === 1 ? '다음 단계' : '진입'}
                variant={canConfirm || step === 1 ? 'primary' : 'default'}
                dense
              >
                {step === 1 ? '다음' : '진입'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
