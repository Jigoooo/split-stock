import type { BrokerId } from '@shared/contracts';
import { KisAdapter, type KisAdapterDeps } from './kis/adapter';
import type { BrokerPort } from './ports/broker-port';

/**
 * Broker factory — brokerId + deps 로 BrokerPort 인스턴스 생성.
 *
 * Stage 2 시점에서는 KIS 만 분기. Stage 6 에서 Kiwoom 분기 추가 예정.
 *
 * factory 는 deps 빌드 책임을 호출측에 위임 (활성 credentials/AuthService 결정은
 * tRPC ctx factory 또는 부트스트랩이 한다).
 */
export type CreateBrokerPortDeps =
  | { brokerId: 'KIS'; deps: KisAdapterDeps }
  | { brokerId: 'KIWOOM'; deps: never }; // Stage 6 에서 KiwoomAdapterDeps 로 교체

export function createBrokerPort(input: CreateBrokerPortDeps): BrokerPort {
  if (input.brokerId === 'KIS') {
    return new KisAdapter(input.deps);
  }
  // Stage 6 에서 KiwoomAdapter 분기 추가
  throw new Error(`Broker '${input.brokerId satisfies BrokerId}' 는 아직 지원되지 않습니다`);
}
