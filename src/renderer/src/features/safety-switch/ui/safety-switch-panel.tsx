import { Button } from '@renderer/shared/ui';
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
        <Button
          disabled={errorLocked || setMasterPending}
          onClick={() => setMaster(!snap.master)}
          variant={snap.master ? 'primary' : 'danger'}
        >
          {snap.master ? '주문 가능' : '주문 차단'}
        </Button>
        {errorLocked && (
          <span className="chip chip--down" role="status">
            에러 잠금: {snap.errorLock.reason ?? '원인 불명'}
          </span>
        )}
        {errorLocked && (
          <Button disabled={clearPending} onClick={clearErrorLock}>
            잠금 해제
          </Button>
        )}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: '1.1rem' }}>
          Ctrl/Cmd+Shift+K 로 즉시 전체 중지
        </span>
      </div>
    </div>
  );
};
