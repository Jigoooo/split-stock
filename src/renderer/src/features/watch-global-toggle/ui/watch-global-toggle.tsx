import { useActiveAccountId } from '@renderer/entities/account';
import { useWatchControlState } from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import type { ReactElement } from 'react';

/**
 * 헤더 자동감시 전역 토글.
 *
 * 활성 계좌 기준으로 전역 자동감시 ON/OFF와 현재 감시 중/일시중지 건수를 함께 표시한다.
 */
export const WatchGlobalToggle = (): ReactElement => {
  const utils = trpc.useUtils();
  const { accountId } = useActiveAccountId();
  const { isPending, state } = useWatchControlState();
  const setGlobal = trpc.watch.setGlobalEnabled.useMutation({
    onSuccess: async () => {
      await utils.watch.getControlState.invalidate();
      await utils.watch.list.invalidate();
      await utils.watch.history.invalidate();
    },
  });

  if (accountId === null) {
    return <span className="chip">자동감시 —</span>;
  }

  if (isPending || state === null) {
    return <span className="chip">자동감시 …</span>;
  }

  return (
    <button
      type="button"
      className="chip"
      aria-pressed={state.globalEnabled}
      aria-label={`자동감시 ${state.globalEnabled ? 'ON' : 'OFF'} (${state.totalTrackedCount})`}
      onClick={() => setGlobal.mutate({ enabled: !state.globalEnabled })}
      disabled={setGlobal.isPending}
      style={{
        cursor: setGlobal.isPending ? 'wait' : 'pointer',
        border: 'none',
        background: state.globalEnabled ? 'var(--accent-tint-6)' : 'var(--bg-3)',
        color: 'inherit',
      }}
    >
      자동감시 {state.globalEnabled ? 'ON' : 'OFF'} ({state.totalTrackedCount})
    </button>
  );
};
