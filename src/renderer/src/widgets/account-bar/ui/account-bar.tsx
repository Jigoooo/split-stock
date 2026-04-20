import { SafetySwitchHeader } from '@renderer/features/safety-switch';
import { AccountSelector } from '@renderer/features/switch-account';
import type { AppEnv } from '@shared/contracts';
import type { ReactElement } from 'react';

export interface AccountBarProps {
  /** 현재 활성 환경 — null 일 때만 "연결 안 됨" 칩 표시. */
  env: AppEnv | null;
}

/**
 * 헤더 통합 위젯 — 계좌 셀렉터 + 주문 허용 스위치 조합.
 *
 * 환경(MOCK/PROD) 표시는 계좌 셀렉터의 EnvDot 이 담당 — 별도 배지 없음.
 */
export const AccountBar = ({ env }: AccountBarProps): ReactElement => (
  <div
    style={{
      display: 'inline-flex',
      gap: '0.6rem',
      alignItems: 'center',
      flexWrap: 'wrap',
    }}
  >
    <AccountSelector />
    {env === null ? <span className="chip">연결 안 됨</span> : null}
    <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
    <SafetySwitchHeader />
  </div>
);
