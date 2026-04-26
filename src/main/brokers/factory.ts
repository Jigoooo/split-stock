import { KisAdapter, type KisAdapterDeps } from './kis/adapter';
import { KiwoomAdapter, type KiwoomAdapterDeps } from './kiwoom/adapter';
import type { BrokerPort } from './ports/broker-port';

/**
 * Broker factory — brokerId + deps 로 BrokerPort 인스턴스 생성.
 *
 * Stage 6b 부터 Kiwoom 분기 활성 (현재 KiwoomAdapter 메서드는 NOT_IMPLEMENTED 반환).
 * Stage 6c~6e 에서 placeOrder/inquireBalance/getQuote/realtime 본문 구현.
 *
 * factory 는 deps 빌드 책임을 호출측에 위임 (활성 credentials/auth 결정은
 * tRPC ctx factory 또는 부트스트랩이 한다).
 */
export type CreateBrokerPortDeps =
  | { brokerId: 'KIS'; deps: KisAdapterDeps }
  | { brokerId: 'KIWOOM'; deps: KiwoomAdapterDeps };

export function createBrokerPort(input: CreateBrokerPortDeps): BrokerPort {
  if (input.brokerId === 'KIS') {
    return new KisAdapter(input.deps);
  }
  return new KiwoomAdapter(input.deps);
}
