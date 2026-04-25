import { useActiveAccountId } from '@renderer/entities/account';
import { useWatchControlState } from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { Switch } from '@renderer/shared/ui';
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
    <div className="header-toggle-control header-toggle-control--watch">
      <span className="header-toggle-control__label">감시</span>
      <Switch
        checked={state.globalEnabled}
        aria-label={`자동감시 ${state.globalEnabled ? 'ON' : 'OFF'} (${state.totalTrackedCount})`}
        onChange={(enabled) => setGlobal.mutate({ enabled })}
        disabled={setGlobal.isPending}
        tone={state.globalEnabled ? 'accent' : 'danger'}
      />
      <span className="header-toggle-control__state header-toggle-control__state--watch">
        {state.globalEnabled ? 'ON' : 'OFF'} ({state.totalTrackedCount})
      </span>
    </div>
  );
};
