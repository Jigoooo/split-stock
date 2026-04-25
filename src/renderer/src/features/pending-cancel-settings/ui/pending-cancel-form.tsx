import { Button, Checkbox, NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { usePendingCancelSettings } from '../model/use-pending-cancel-settings';

export const PendingCancelForm = (): ReactElement => {
  const {
    isPending,
    isSaving,
    error,
    form,
    isDirty,
    setEnabled,
    setTimeoutMinutes,
    setMaxCancels,
    save,
    reset,
  } = usePendingCancelSettings();

  if (isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">설정 로드 중…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">{error.message}</span>
        </div>
      </div>
    );
  }

  const disabled = isSaving;

  return (
    <div className="panel">
      <div className="panel__title">미체결 자동취소 설정</div>
      <div className="panel__body" style={{ display: 'grid', gap: '1.2rem' }}>
        {/* 활성화 토글 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <Checkbox
            id="pending-cancel-enabled"
            label="미체결 자동취소 사용"
            checked={form.enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={disabled}
          />
        </div>

        {/* 감지 시간 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <label htmlFor="pending-cancel-timeout" style={{ minWidth: '9rem' }}>
            감지 시간 (분)
          </label>
          <NumberInput
            id="pending-cancel-timeout"
            value={String(form.timeoutMinutes)}
            disabled={disabled || !form.enabled}
            onValueChange={(raw) => {
              const v = Number(raw);
              if (Number.isFinite(v) && v >= 1 && v <= 60) setTimeoutMinutes(v);
            }}
            style={{ width: '8rem' }}
            dense
          />
          <span className="muted">1~60분</span>
        </div>

        {/* 최대 취소 횟수 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <label htmlFor="pending-cancel-max" style={{ minWidth: '9rem' }}>
            최대 취소 횟수
          </label>
          <NumberInput
            id="pending-cancel-max"
            value={form.maxCancels === -1 ? '0' : String(form.maxCancels)}
            disabled={disabled || !form.enabled}
            onValueChange={(raw) => {
              const v = Number(raw);
              if (!Number.isFinite(v)) return;
              setMaxCancels(v === 0 ? -1 : Math.max(1, Math.min(30, v)));
            }}
            style={{ width: '8rem' }}
            dense
          />
          <span className="muted">
            {form.maxCancels === -1 ? '무제한 (0 입력)' : `${form.maxCancels}회 후 중지`}
          </span>
        </div>

        <div className="muted" style={{ fontSize: '0.85em' }}>
          취소 후 자동 재주문은 현재 미지원입니다. 수동으로 다시 주문해 주세요.
        </div>

        {/* 저장 / 초기화 */}
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <Button variant="primary" disabled={disabled || !isDirty} onClick={save} dense>
            {isSaving ? '저장 중…' : '저장'}
          </Button>
          <Button disabled={disabled || !isDirty} onClick={reset} dense>
            초기화
          </Button>
        </div>
      </div>
    </div>
  );
};
