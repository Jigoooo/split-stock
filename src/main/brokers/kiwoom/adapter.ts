import type {
  AppEnv,
  Balance,
  BrokerError,
  Candle,
  DailyExecution,
  OrderAck,
  OrderAmendIntent,
  OrderbookSnapshot,
  OrderIntent,
  Quote,
  StockSymbol,
} from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';
import { err, type Result } from 'neverthrow';
import type { CancelOrderInput, GetDailyOhlcvParams, ListDailyExecutionsParams } from '../ports';
import type { BrokerPort } from '../ports/broker-port';
import type { RealtimePort } from '../ports/realtime-port';
import type { KiwoomAuth } from './auth';
import type { KiwoomHttpClient } from './http-client';

export interface KiwoomAdapterDeps {
  env: AppEnv;
  auth: KiwoomAuth;
  http: KiwoomHttpClient;
  /** 활성 계좌 자격증명. */
  credentials: {
    appKey: string;
    secretKey: string;
    /** Kiwoom 계좌번호 (10자리). */
    accountNo: string;
  };
  /** 주문 시 거래소 기본값 (KRX/NXT/SOR). */
  defaultExchange?: '1' | '2' | '3';
}

/**
 * Kiwoom adapter — BrokerPort 구현체.
 *
 * Stage 6b 시점에서는 모든 메서드가 NOT_IMPLEMENTED 반환 (factory 분기 활성화만).
 * Stage 6c~6e 에서 placeOrder/inquireBalance/getQuote/realtime 등 본문 구현.
 *
 * KIS adapter 와 달리 Kiwoom 은 모든 endpoint POST + JSON body, api-id 헤더로 분기.
 * 토큰은 `bearer` (소문자), 만료 'YYYYMMDDHHMMSS' KST 형식 (parseKiwoomExpiry).
 */
export class KiwoomAdapter implements BrokerPort {
  readonly brokerId = 'KIWOOM' as const;
  readonly env: AppEnv;

  constructor(private readonly deps: KiwoomAdapterDeps) {
    this.env = deps.env;
  }

  private notImpl(method: string): BrokerError {
    return makeBrokerError({
      brokerId: 'KIWOOM',
      kind: 'NOT_IMPLEMENTED',
      msg: `KiwoomAdapter.${method}() — Stage 6c+ 에서 구현 예정`,
    });
  }

  async ensureSession(_opts?: { forceRefresh?: boolean }): Promise<Result<void, BrokerError>> {
    return err(this.notImpl('ensureSession'));
  }

  invalidateSession(): void {
    // Stage 6c — KiwoomTokenStore 도입 후 cache invalidate
  }

  async placeOrder(_intent: OrderIntent): Promise<Result<OrderAck, BrokerError>> {
    return err(this.notImpl('placeOrder'));
  }

  async cancelOrder(_input: CancelOrderInput): Promise<Result<OrderAck, BrokerError>> {
    return err(this.notImpl('cancelOrder'));
  }

  async amendOrder(_input: OrderAmendIntent): Promise<Result<OrderAck, BrokerError>> {
    return err(this.notImpl('amendOrder'));
  }

  async listDailyExecutions(
    _p: ListDailyExecutionsParams,
  ): Promise<Result<DailyExecution[], BrokerError>> {
    return err(this.notImpl('listDailyExecutions'));
  }

  async inquireBalance(): Promise<Result<Balance, BrokerError>> {
    return err(this.notImpl('inquireBalance'));
  }

  async getQuote(_symbol: StockSymbol): Promise<Result<Quote, BrokerError>> {
    return err(this.notImpl('getQuote'));
  }

  async getOrderbook(_symbol: StockSymbol): Promise<Result<OrderbookSnapshot, BrokerError>> {
    return err(this.notImpl('getOrderbook'));
  }

  async getDailyOhlcv(_p: GetDailyOhlcvParams): Promise<Result<Candle[], BrokerError>> {
    return err(this.notImpl('getDailyOhlcv'));
  }

  async isTradingDay(_date: Date): Promise<Result<boolean, BrokerError>> {
    // Kiwoom 은 휴장일 endpoint 미제공 — Stage 6c 에서 shared/market-rules
    // KRX 휴장일 폴백으로 구현. 현재는 NOT_IMPLEMENTED.
    return err(this.notImpl('isTradingDay'));
  }

  realtime(): RealtimePort {
    throw new Error(
      'KiwoomAdapter.realtime() — Stage 6e 에서 KiwoomSocketClient (JSON 프로토콜) 구현 예정',
    );
  }

  dispose(): void {
    // 현재 보유 자원 없음
  }
}
