/**
 * Broker-agnostic 인프라 타입.
 *
 * Stage 1 시점에서는 기존 kis/ws-client.ts 의 Timer/WsFactory 타입을
 * broker-agnostic 으로 노출하는 thin re-export. Stage 7 cleanup 시
 * 원본 정의가 brokers/core/websocket.ts 로 물리 이동된다.
 */

export type {
  RealtimeTr,
  SubscriptionKey,
  Timer,
  WsFactory,
  WsLike,
} from '@main/kis/ws-client';
export { realTimer } from '@main/kis/ws-client';
