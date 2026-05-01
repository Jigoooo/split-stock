import { Button, Switch } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useSafetySwitch } from '../model/use-safety-switch';

export const SafetySwitchPanel = (): ReactElement => {
  const { clearErrorLock, clearPending, error, isPending, setMaster, setMasterPending, snapshot } =
    useSafetySwitch();

  if (isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">안전 상태 로딩…</div>
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
  if (!snapshot) return <div className="panel" />;

  const snap = snapshot;
  const errorLocked = snap.errorLock.active;

  return (
    <div className="panel">
      <div className="panel__title">주문 허용 상태</div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '1.2rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Switch
            checked={snap.master}
            onChange={(checked) => setMaster(checked)}
            disabled={errorLocked || setMasterPending}
            label={snap.master ? '주문 가능' : '주문 차단'}
            tone={snap.master ? 'accent' : 'danger'}
            aria-label="주문 허용 토글"
          />
          <span className={snap.master ? 'chip chip--up' : 'chip chip--down'}>
            {snap.master ? 'ON' : 'OFF'}
          </span>
        </div>
        {errorLocked && (
          <span className="chip chip--down" role="status">
            에러 잠금: {snap.errorLock.reason ?? '원인 불명'}
          </span>
        )}
        {errorLocked && (
          <Button disabled={clearPending} onClick={clearErrorLock} dense>
            잠금 해제
          </Button>
        )}
      </div>
    </div>
  );
};
