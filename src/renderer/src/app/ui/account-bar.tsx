import { SafetySwitchHeader } from '@renderer/features/safety-switch';
import { AccountSelector } from '@renderer/features/switch-account';
import { WatchGlobalToggle } from '@renderer/features/watch-global-toggle';
import type { AppEnv } from '@shared/contracts';
import type { ReactElement } from 'react';

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
    </div>
  </div>
);
