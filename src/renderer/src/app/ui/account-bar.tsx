import { SafetySwitchHeader } from '@renderer/features/safety-switch';
import { AccountSelector } from '@renderer/features/switch-account';
import { WatchGlobalToggle } from '@renderer/features/watch-global-toggle';
import { trpc } from '@renderer/shared/api/trpc';
import type { AppEnv } from '@shared/contracts';
import type { ReactElement } from 'react';

/**
 * REST 폴링으로 강등된 종목이 있을 때만 chip 으로 알림.
 * 평소(WS 슬롯 안에 모두 들어감)에는 노출 안 함 — 헤더 다이어트.
 */
const RealtimeFallbackChip = (): ReactElement | null => {
  const { data } = trpc.monitoring.getRealtimeStats.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  if (!data || data.restFallbackCount <= 0) return null;
  return (
    <span
      className="chip chip--down"
      title={`WS 슬롯 ${data.wsCount}/${data.capacity} · REST 폴링 ${data.restFallbackCount}종목 (capacity 초과)`}
    >
      REST {data.restFallbackCount}
    </span>
  );
};

export interface AccountBarProps {
  /** 현재 활성 환경 — null 일 때만 "연결 안 됨" 칩 표시. */
  env: AppEnv | null;
}

/**
 * 헤더 통합 위젯 — 계좌 셀렉터 + 주문 허용 스위치 + 자동감시 카운터 조합.
 *
 * 환경(MOCK/PROD) 표시는 계좌 셀렉터의 EnvDot 이 담당 — 별도 배지 없음.
 */
export const AccountBar = ({ env }: AccountBarProps): ReactElement => (
  <div className="app-header__cluster app-header__cluster--account">
    <div className="app-header__section">
      <span className="app-header__section-label">계좌</span>
      <AccountSelector />
      {env === null ? <span className="chip">연결 안 됨</span> : null}
    </div>
    <div className="app-header__section app-header__section--status">
      <span className="app-header__section-label">상태</span>
      <SafetySwitchHeader />
      <WatchGlobalToggle />
      <RealtimeFallbackChip />
    </div>
  </div>
);
