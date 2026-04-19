import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useSafetySwitch } from '../model/use-safety-switch';

/**
 * 헤더용 인라인 주문 허용 스위치 — 주문 가능/차단 버튼 + 에러 잠금 인디케이터.
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
      <Button
        disabled={errorLocked || setMasterPending}
        onClick={() => setMaster(!snap.master)}
        title="Ctrl/Cmd+Shift+K 로 즉시 중지"
        variant={snap.master ? 'primary' : 'danger'}
        dense
      >
        {snap.master ? '주문 가능' : '주문 차단'}
      </Button>
      {errorLocked ? (
        <>
          <span className="chip chip--down" role="status">
            에러: {snap.errorLock.reason ?? '원인 불명'}
          </span>
          <Button disabled={clearPending} onClick={clearErrorLock} dense>
            잠금 해제
          </Button>
        </>
      ) : null}
    </div>
  );
};
