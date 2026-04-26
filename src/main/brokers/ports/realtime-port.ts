import type {
  BrokerError,
  ExecNoticeEvent,
  RealtimeEvent,
  RealtimeKind,
  StockSymbol,
} from '@shared/contracts';
import type { Result } from '../core/result';

export interface Subscription {
  unsubscribe(): void;
}

export type RealtimePhase = 'idle' | 'connecting' | 'open' | 'reconnect-wait' | 'closed';

export interface RealtimeStatus {
  phase: RealtimePhase;
  subscriptions: number;
}

export type RealtimeHandler = (event: RealtimeEvent) => void;
export type ExecNoticeHandler = (event: ExecNoticeEvent) => void;

/**
 * 실시간 시세/체결통보 port.
 *
 * KIS 의 H0STCNT0(체결가) / H0STASP0(호가) / H0STCNI0,9(체결통보) 와
 * Kiwoom 의 0B / 0D / 00 코드를 같은 RealtimeEvent 형태로 정규화.
 *
 * 슬롯 capacity 초과 시 BrokerError(VALIDATION) 반환 — broker별로 KIS=20, Kiwoom=100.
 */
export interface RealtimePort {
  start(): Promise<Result<void, BrokerError>>;
  stop(): void;

  subscribe(
    symbol: StockSymbol,
    kind: RealtimeKind,
    handler: RealtimeHandler,
  ): Result<Subscription, BrokerError>;

  /**
   * 체결통보 전용 구독. KIS=HTS_ID 기반 / Kiwoom=accountId 기반 — adapter 책임.
   */
  subscribeExecutions(handler: ExecNoticeHandler): Result<Subscription, BrokerError>;

  getStatus(): RealtimeStatus;
}
