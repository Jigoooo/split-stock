import { useRealtimeStatus } from '@renderer/entities/realtime';
import type { ReactElement } from 'react';

type DotState = 'connected' | 'stale' | 'disconnected';

const STATE_LABEL: Record<DotState, string> = {
  connected: '실시간 연결됨',
  stale: '재연결 대기 중',
  disconnected: '실시간 연결 끊김',
};

export const ConnectionStatusDot = (): ReactElement => {
  const { started, reconnectPending } = useRealtimeStatus();
  const state: DotState = reconnectPending ? 'stale' : started ? 'connected' : 'disconnected';
  return (
    <span
      className={`status-dot status-dot--${state}`}
      role="status"
      aria-label={STATE_LABEL[state]}
      title={STATE_LABEL[state]}
    >
      <span className="status-dot__pulse" aria-hidden />
    </span>
  );
};
