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
import { err, ok, type Result } from 'neverthrow';
import type { CancelOrderInput, GetDailyOhlcvParams, ListDailyExecutionsParams } from '../ports';
import type { BrokerPort } from '../ports/broker-port';
import type { RealtimePort } from '../ports/realtime-port';
import { type KiwoomAuth, parseKiwoomExpiry } from './auth';
import type { KiwoomHttpClient } from './http-client';
import {
  type KiwoomOrderResponseWire,
  toKiwoomCancelOrderBody,
  toKiwoomModifyOrderBody,
  toKiwoomPlaceOrderBody,
  toOrderAck,
} from './mappers/order';
import { KIWOOM_API_ID, KIWOOM_PATH } from './metadata/endpoints';
import { KiwoomTokenStore } from './token-store';

export interface KiwoomAdapterDeps {
  env: AppEnv;
  auth: KiwoomAuth;
  http: KiwoomHttpClient;
  tokenStore: KiwoomTokenStore;
  /** 활성 계좌 자격증명. */
  credentials: {
    appKey: string;
    secretKey: string;
    /** Kiwoom 계좌번호 (10자리). */
    accountNo: string;
  };
  /** 주문 시 거래소 기본값 (KRX/NXT/SOR). 미지정 시 '1' (KRX). */
  defaultExchange?: '1' | '2' | '3';
}

/**
 * Kiwoom adapter — BrokerPort 구현체.
 *
 * Stage 6c 구현 범위: ensureSession + placeOrder/cancel/amend (kt10000~3).
 * Balance/Quote/Orderbook/Chart/Realtime 은 Stage 6d~6e 에서 본문 구현.
 *
 * Wire schema 는 cluefin + KiwoomRestApi.Net 으로 검증된 필드명. 실제 응답 형태
 * 는 Stage 6.5 라이브 검증 시 보정 가능.
 */
export class KiwoomAdapter implements BrokerPort {
  readonly brokerId = 'KIWOOM' as const;
  readonly env: AppEnv;
  /** 캐시된 토큰 — ensureSession 결과를 placeOrder 등이 재사용. */
  private cachedToken: string | null = null;

  constructor(private readonly deps: KiwoomAdapterDeps) {
    this.env = deps.env;
  }

  // ─── AuthPort ───────────────────────────────────────────────────────────

  async ensureSession(opts?: { forceRefresh?: boolean }): Promise<Result<void, BrokerError>> {
    const tokenResult = await this.token(opts?.forceRefresh ?? false);
    if (tokenResult.isErr()) return err(tokenResult.error);
    return ok(undefined);
  }

  invalidateSession(): void {
    this.cachedToken = null;
    this.deps.tokenStore.clear(this.env);
  }

  // ─── OrderPort ──────────────────────────────────────────────────────────

  async placeOrder(intent: OrderIntent): Promise<Result<OrderAck, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const apiId = intent.side === 'BUY' ? KIWOOM_API_ID.ORDER_BUY : KIWOOM_API_ID.ORDER_SELL;
    const body = toKiwoomPlaceOrderBody(intent, this.deps.defaultExchange);
    const r = await this.deps.http.post<KiwoomOrderResponseWire>(
      KIWOOM_PATH.ORDER,
      body,
      tokenResult.value,
      { apiId },
    );
    if (r.isErr()) return err(r.error);
    return ok(toOrderAck(r.value.body));
  }

  async cancelOrder(input: CancelOrderInput): Promise<Result<OrderAck, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const body = toKiwoomCancelOrderBody(input, this.deps.defaultExchange);
    const r = await this.deps.http.post<KiwoomOrderResponseWire>(
      KIWOOM_PATH.ORDER,
      body,
      tokenResult.value,
      { apiId: KIWOOM_API_ID.ORDER_CANCEL },
    );
    if (r.isErr()) return err(r.error);
    return ok(toOrderAck(r.value.body));
  }

  async amendOrder(input: OrderAmendIntent): Promise<Result<OrderAck, BrokerError>> {
    if (
      input.qty === undefined ||
      input.qty <= 0 ||
      input.price === undefined ||
      input.price <= 0
    ) {
      return err(
        makeBrokerError({
          brokerId: 'KIWOOM',
          kind: 'VALIDATION',
          msg: 'amendOrder 는 qty>0 + price>0 필요 (Kiwoom kt10002 정정 규칙)',
        }),
      );
    }
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const body = toKiwoomModifyOrderBody(input, this.deps.defaultExchange);
    const r = await this.deps.http.post<KiwoomOrderResponseWire>(
      KIWOOM_PATH.ORDER,
      body,
      tokenResult.value,
      { apiId: KIWOOM_API_ID.ORDER_MODIFY },
    );
    if (r.isErr()) return err(r.error);
    return ok(toOrderAck(r.value.body));
  }

  async listDailyExecutions(
    _p: ListDailyExecutionsParams,
  ): Promise<Result<DailyExecution[], BrokerError>> {
    return err(this.notImpl('listDailyExecutions'));
  }

  // ─── BalancePort ────────────────────────────────────────────────────────

  async inquireBalance(): Promise<Result<Balance, BrokerError>> {
    return err(this.notImpl('inquireBalance'));
  }

  // ─── MarketPort ─────────────────────────────────────────────────────────

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
    // Stage 6e — shared/market-rules KRX 휴장일 폴백
    return err(this.notImpl('isTradingDay'));
  }

  realtime(): RealtimePort {
    throw new Error(
      'KiwoomAdapter.realtime() — Stage 6e 에서 KiwoomSocketClient (JSON 프로토콜) 구현 예정',
    );
  }

  dispose(): void {
    this.cachedToken = null;
  }

  // ─── 내부 helpers ───────────────────────────────────────────────────────

  /** 유효 토큰 확보. 캐시 hit 면 즉시 반환, 만료 임박 시 재발급. */
  private async token(forceRefresh = false): Promise<Result<string, BrokerError>> {
    if (!forceRefresh && this.cachedToken) return ok(this.cachedToken);

    if (!forceRefresh) {
      const cached = this.deps.tokenStore.load(this.env);
      if (cached.isOk() && cached.value && KiwoomTokenStore.isReusable(cached.value, Date.now())) {
        this.cachedToken = cached.value.token;
        return ok(cached.value.token);
      }
    }

    const fresh = await this.deps.auth.generateToken();
    if (fresh.isErr()) return err(fresh.error);

    const expiresAt = parseKiwoomExpiry(fresh.value.expiresDt);
    this.deps.tokenStore.save(this.env, {
      token: fresh.value.token,
      tokenType: fresh.value.tokenType,
      expiresAt,
      issuedAt: Date.now(),
    });
    this.cachedToken = fresh.value.token;
    return ok(fresh.value.token);
  }

  private notImpl(method: string): BrokerError {
    return makeBrokerError({
      brokerId: 'KIWOOM',
      kind: 'NOT_IMPLEMENTED',
      msg: `KiwoomAdapter.${method}() — Stage 6d/6e 에서 구현 예정`,
    });
  }
}
