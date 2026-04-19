import type { ReactElement } from 'react';
import { useSafetySwitch } from '../model/use-safety-switch';

/**
 * 헤더용 인라인 안전 스위치 — 마스터 ON/OFF 버튼 + 에러 잠금 인디케이터.
 * panel 래퍼 없이 버튼/칩만 렌더해 헤더 공간을 차지하지 않음.
 */
export const SafetySwitchHeader = (): ReactElement | null => {
  const { clearErrorLock, clearPending, error, isPending, setMaster, setMasterPending, snapshot } =
    useSafetySwitch();

  if (isPending || error || !snapshot) return null;
  const snap = snapshot;
  const errorLocked = snap.errorLock.active;

  return (
    <div style={{ display: 'inline-flex', gap: '0.6rem', alignItems: 'center' }}>
      <button
        type="button"
        className={snap.master ? 'hts-btn hts-btn--primary' : 'hts-btn'}
        disabled={errorLocked || setMasterPending}
        onClick={() => setMaster(!snap.master)}
        title="Ctrl/Cmd+Shift+K 로 즉시 중지"
      >
        안전 {snap.master ? 'ON' : 'OFF'}
      </button>
      {errorLocked ? (
        <>
          <span className="chip chip--down" role="status">
            에러: {snap.errorLock.reason ?? '원인 불명'}
          </span>
          <button
            type="button"
            className="hts-btn"
            disabled={clearPending}
            onClick={clearErrorLock}
          >
            잠금 해제
          </button>
        </>
      ) : null}
    </div>
  );
};
