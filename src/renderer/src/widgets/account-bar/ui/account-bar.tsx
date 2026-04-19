import { SafetySwitchHeader } from '@renderer/features/safety-switch';
import { AccountSelector } from '@renderer/features/switch-account';
import type { AppEnv } from '@shared/contracts';
import type { ReactElement } from 'react';

export interface AccountBarProps {
  /**
   * 현재 활성 환경 — 헤더에 항상 노출되는 표시용 배지 (display-only).
   * 실제 환경 전환은 계좌 셀렉터가 계좌 단위로 처리하며, 이 배지는 클릭 가능 토글이 아니다.
   */
  env: AppEnv | null;
}

/**
 * 헤더 통합 위젯 — 계좌 셀렉터 + 환경 배지(읽기전용) + 주문 허용 스위치 조합.
 *
 * 자체 비즈니스 로직 없음. 모두 features 의 ui/hook 조합.
 *
 * 환경 배지는 읽기 전용으로 변경되었다 (이전에는 헤더 인라인 Select 가 환경 토글을 겸했음).
 * 계좌 셀렉터로 다른 env 의 계좌를 고르면 서버 측 `account.setActive` 가 env 도 원자적으로
 * 동기 전환한다 — UI 에서는 별도 env Select 가 더 이상 필요 없다.
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
    {env ? (
      <span
        className={env === 'PROD' ? 'env-badge env-badge--prod' : 'env-badge env-badge--mock'}
        title="현재 활성 환경 — 계좌 셀렉터로 전환됩니다."
      >
        {env}
      </span>
    ) : (
      <span className="chip">연결 안 됨</span>
    )}
    <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
    <SafetySwitchHeader />
  </div>
);
