import { trpc } from '@renderer/shared/api/trpc';
import type { ReactElement } from 'react';

export const SafetySwitchPanel = (): ReactElement => {
  const state = trpc.safety.getState.useQuery(undefined, {
    refetchInterval: 2000,
  });
  const setMaster = trpc.safety.setMaster.useMutation({
    onSuccess: () => state.refetch(),
  });
  const clear = trpc.safety.clearErrorLock.useMutation({
    onSuccess: () => state.refetch(),
  });

  if (state.isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">안전 상태 로딩…</div>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">{state.error.message}</span>
        </div>
      </div>
    );
  }
  const snap = state.data;
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
          disabled={errorLocked || setMaster.isPending}
          onClick={() => setMaster.mutate({ on: !snap.master })}
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
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
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
