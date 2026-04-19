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
      <div className="panel__title">안전 스위치</div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '1.2rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <button
          type="button"
          className={snap.master ? 'hts-btn hts-btn--primary' : 'hts-btn'}
          disabled={errorLocked || setMasterPending}
          onClick={() => setMaster(!snap.master)}
        >
          마스터 {snap.master ? 'ON' : 'OFF'}
        </button>
        {errorLocked && (
          <span className="chip chip--down" role="status">
            에러 잠금: {snap.errorLock.reason ?? '원인 불명'}
          </span>
        )}
        {errorLocked && (
          <button
            type="button"
            className="hts-btn"
            disabled={clearPending}
            onClick={clearErrorLock}
          >
            잠금 해제
          </button>
        )}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: '1.1rem' }}>
          Ctrl/Cmd+Shift+K 로 즉시 전체 중지
        </span>
      </div>
    </div>
  );
};
