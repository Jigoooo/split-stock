import type { AppEnv, BrokerId } from '@shared/contracts';
import type { AuthPort } from './auth-port';
import type { BalancePort } from './balance-port';
import type { MarketPort } from './market-port';
import type { OrderPort } from './order-port';
import type { RealtimePort } from './realtime-port';

/**
 * Broker composite port — trading 엔진/tRPC 라우터가 의존하는 단일 추상.
 *
 * AuthPort + OrderPort + BalancePort + MarketPort 를 직접 합쳐 호출 편의.
 * RealtimePort 는 lifecycle 이 다르므로 lazy accessor 로 분리.
 *
 * 신규 broker 추가 시:
 *  - brokers/<name>/adapter.ts 가 BrokerPort 를 implement
 *  - factory 분기에서 instance 선택
 *  - trading/ tRPC 코드 변경 0
 */
export interface BrokerPort extends AuthPort, OrderPort, BalancePort, MarketPort {
  readonly brokerId: BrokerId;
  readonly env: AppEnv;

  /** 실시간 port 는 활성 시 1개 instance — broker 가 disposed 면 throw. */
  realtime(): RealtimePort;

  /** 정리 — 토큰 캐시는 유지하되 WS/HTTP 연결 종료. */
  dispose(): void;
}
