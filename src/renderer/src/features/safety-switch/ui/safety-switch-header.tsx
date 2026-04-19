import { trpc } from '@renderer/shared/api/trpc';
import type { ReactElement } from 'react';

/**
 * 헤더용 인라인 안전 스위치 — 마스터 ON/OFF 버튼 + 에러 잠금 인디케이터.
 * panel 래퍼 없이 버튼/칩만 렌더해 헤더 공간을 차지하지 않음.
 */
export const SafetySwitchHeader = (): ReactElement | null => {
  const state = trpc.safety.getState.useQuery(undefined, {
    refetchInterval: 2000,
  });
  const setMaster = trpc.safety.setMaster.useMutation({
    onSuccess: () => state.refetch(),
  });
  const clear = trpc.safety.clearErrorLock.useMutation({
    onSuccess: () => state.refetch(),
  });

  if (state.isPending || state.error) return null;
  const snap = state.data;
  const errorLocked = snap.errorLock.active;

  return (
    <div style={{ display: 'inline-flex', gap: '0.6rem', alignItems: 'center' }}>
      <button
        type="button"
        className={snap.master ? 'hts-btn hts-btn--primary' : 'hts-btn'}
        disabled={errorLocked || setMaster.isPending}
        onClick={() => setMaster.mutate({ on: !snap.master })}
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
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
          >
            잠금 해제
          </button>
        </>
      ) : null}
    </div>
  );
};
