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
import { isKrxTradingDay } from '@shared/market-rules';
import { err, ok, type Result } from 'neverthrow';
import type { CancelOrderInput, GetDailyOhlcvParams, ListDailyExecutionsParams } from '../ports';
import type { BrokerPort } from '../ports/broker-port';
import type { RealtimePort } from '../ports/realtime-port';
import { type KiwoomAuth, parseKiwoomExpiry } from './auth';
import type { KiwoomHttpClient } from './http-client';
import { type KiwoomBalanceWire, toKiwoomBalance } from './mappers/balance';
import { type KiwoomDailyChartWire, toKiwoomCandles } from './mappers/candle';
import {
  type KiwoomExecutedResponseWire,
  type KiwoomUnexecutedResponseWire,
  toKiwoomDailyExecution,
} from './mappers/executions';
import {
  type KiwoomOrderResponseWire,
  toKiwoomCancelOrderBody,
  toKiwoomModifyOrderBody,
  toKiwoomPlaceOrderBody,
  toOrderAck,
} from './mappers/order';
import { type KiwoomOrderbookWire, toKiwoomOrderbook } from './mappers/orderbook';
import { type KiwoomQuoteWire, toKiwoomQuote } from './mappers/quote';
import { KIWOOM_API_ID, KIWOOM_PATH } from './metadata/endpoints';
import { KiwoomRealtimeAdapter } from './realtime-adapter';
import type { KiwoomSocketClient } from './socket-client';
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
  /** RealtimePort 본문에 사용할 KiwoomSocketClient. 미주입 시 realtime() throw. */
  socket?: KiwoomSocketClient;
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
  /** lazy 생성된 RealtimePort 어댑터 (singleton per KiwoomAdapter 인스턴스). */
  private realtimeAdapter: KiwoomRealtimeAdapter | null = null;

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
    p: ListDailyExecutionsParams,
  ): Promise<Result<DailyExecution[], BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const apiId = p.filledOnly ? KIWOOM_API_ID.FILLED_ORDERS : KIWOOM_API_ID.UNFILLED_ORDERS;
    // ka10075(미체결) 와 ka10076(체결) 은 필수 필드가 다름 — cluefin metadata 기준:
    //   ka10075 (미체결): all_stk_tp / trde_tp / stex_tp / stk_cd?
    //   ka10076 (체결):   qry_tp / sell_tp / stex_tp / stk_cd? / ord_no?
    // 0=전체 (구분 미지정). side 필터는 server-side trde_tp/sell_tp 가 아닌
    // client-side 로 처리 (도메인 OrderSide 와 1:1 매핑이 모호하므로 안전).
    const body: Record<string, string> = p.filledOnly
      ? {
          qry_tp: '0',
          sell_tp: '0',
          stex_tp: this.deps.defaultExchange ?? '1',
          ...(p.symbol !== undefined && { stk_cd: p.symbol }),
          ...(p.brokerOrderId !== undefined && { ord_no: p.brokerOrderId }),
        }
      : {
          all_stk_tp: '0',
          trde_tp: '0',
          stex_tp: this.deps.defaultExchange ?? '1',
          ...(p.symbol !== undefined && { stk_cd: p.symbol }),
        };
    const r = await this.deps.http.post<KiwoomUnexecutedResponseWire | KiwoomExecutedResponseWire>(
      KIWOOM_PATH.ACCOUNT,
      body,
      tokenResult.value,
      { apiId },
    );
    if (r.isErr()) return err(r.error);
    const items = p.filledOnly
      ? ((r.value.body as KiwoomExecutedResponseWire).cntr ?? [])
      : ((r.value.body as KiwoomUnexecutedResponseWire).oso ?? []);
    let executions = items.map(toKiwoomDailyExecution);
    if (p.side && p.side !== 'ALL') {
      executions = executions.filter((e) => e.side === p.side);
    }
    return ok(executions);
  }

  // ─── BalancePort ────────────────────────────────────────────────────────

  async inquireBalance(): Promise<Result<Balance, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const body: Record<string, string> = {
      qry_tp: '1',
      dmst_stex_tp: this.deps.defaultExchange ?? '1',
    };
    const r = await this.deps.http.post<KiwoomBalanceWire>(
      KIWOOM_PATH.ACCOUNT,
      body,
      tokenResult.value,
      { apiId: KIWOOM_API_ID.BALANCE_EVALUATION },
    );
    if (r.isErr()) return err(r.error);
    return ok(toKiwoomBalance(r.value.body));
  }

  // ─── MarketPort ─────────────────────────────────────────────────────────

  async getQuote(symbol: StockSymbol): Promise<Result<Quote, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const r = await this.deps.http.post<KiwoomQuoteWire>(
      KIWOOM_PATH.MARKET_CONDITION,
      { stk_cd: symbol },
      tokenResult.value,
      { apiId: KIWOOM_API_ID.STOCK_PRICE },
    );
    if (r.isErr()) return err(r.error);
    return ok(toKiwoomQuote(symbol, r.value.body));
  }

  async getOrderbook(symbol: StockSymbol): Promise<Result<OrderbookSnapshot, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const r = await this.deps.http.post<KiwoomOrderbookWire>(
      KIWOOM_PATH.MARKET_CONDITION,
      { stk_cd: symbol },
      tokenResult.value,
      { apiId: KIWOOM_API_ID.STOCK_QUOTE },
    );
    if (r.isErr()) return err(r.error);
    return ok(toKiwoomOrderbook(symbol, r.value.body));
  }

  async getDailyOhlcv(p: GetDailyOhlcvParams): Promise<Result<Candle[], BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const period = p.period ?? 'D';
    const apiId =
      period === 'D'
        ? KIWOOM_API_ID.CHART_DAILY
        : period === 'W'
          ? KIWOOM_API_ID.CHART_WEEKLY
          : KIWOOM_API_ID.CHART_MONTHLY;
    const baseDt = `${p.to.getFullYear()}${String(p.to.getMonth() + 1).padStart(2, '0')}${String(p.to.getDate()).padStart(2, '0')}`;
    const body: Record<string, string> = {
      stk_cd: p.symbol,
      base_dt: baseDt,
      upd_stkpc_tp: '1',
    };
    const r = await this.deps.http.post<KiwoomDailyChartWire>(
      KIWOOM_PATH.CHART,
      body,
      tokenResult.value,
      { apiId },
    );
    if (r.isErr()) return err(r.error);
    const candles = toKiwoomCandles(r.value.body, period).filter((c) => {
      const t = new Date(c.date).getTime();
      return t >= p.from.getTime() && t <= p.to.getTime();
    });
    return ok(candles);
  }

  async isTradingDay(date: Date): Promise<Result<boolean, BrokerError>> {
    // Kiwoom 은 휴장일 endpoint 미제공 → shared/market-rules KRX 휴장일 폴백.
    return ok(isKrxTradingDay(date));
  }

  realtime(): RealtimePort {
    if (!this.deps.socket) {
      throw new Error(
        'KiwoomAdapter.realtime() — KiwoomSocketClient 가 주입되지 않음 (부트스트랩 누락)',
      );
    }
    if (!this.realtimeAdapter) {
      this.realtimeAdapter = new KiwoomRealtimeAdapter(this.deps.socket);
    }
    return this.realtimeAdapter;
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
}
