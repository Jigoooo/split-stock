import type { BrokerError } from '@shared/contracts';
import type { Result } from '../core/result';

/**
 * Broker 인증 port.
 *
 * 토큰 발급/캐시/만료 처리. 6h 재사용 정책은 broker 별 token-cache 책임.
 */
export interface AuthPort {
  /**
   * 유효 토큰 보장. 만료 임박 시 재발급, 캐시 hit 면 즉시 반환.
   * forceRefresh = true 면 캐시 무시하고 재발급.
   */
  ensureSession(opts?: { forceRefresh?: boolean }): Promise<Result<void, BrokerError>>;

  /**
   * 토큰 무효화. broker 가 server-side 로 강제 만료시킨 경우 (KIS EGW00123 등) 호출.
   * 다음 요청에서 자동 재발급된다.
   */
  invalidateSession(): void;
}
