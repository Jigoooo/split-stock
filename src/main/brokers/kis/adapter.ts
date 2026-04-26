import type { AuthService } from '@main/kis/auth';
import {
  inquireBalance,
  inquireDailyCcld,
  inquireDailyChart,
  inquireDomesticHoliday,
  inquireOrderbook,
  inquirePrice,
} from '@main/kis/domestic-stock';
import type { KisHttpClient } from '@main/kis/http-client';
import { cancelOrRevise, orderCash } from '@main/kis/order';
import type { EventLogger } from '@main/logging/event-logger';
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
import { kisErrorToBrokerError } from './errors';
import { toBalance } from './mappers/balance';
import { toCandle } from './mappers/candle';
import { toDailyExecution } from './mappers/executions';
import {
  toKisAmendParams,
  toKisCancelParams,
  toKisOrderCashParams,
  toOrderAck,
} from './mappers/order';
import { toOrderbookSnapshot } from './mappers/orderbook';
import { toQuote } from './mappers/quote';
import type { KisRealtimeAdapter } from './realtime-adapter';

/**
 * KisAdapter 가 의존하는 외부 객체.
 *
 * factory 가 활성 계좌의 credentials/AuthService/http 클라이언트를 묶어 주입한다.
 * KIS 는 PROD/MOCK 별도 base URL 이 필요하므로 httpByEnv 형태로 주입.
 */
export interface KisAdapterDeps {
  env: AppEnv;
  /** PROD/MOCK 별 KisHttpClient. AuthService 가 token 발급 시 PROD 호출하지 않도록. */
  httpByEnv: Record<AppEnv, KisHttpClient>;
  authService: AuthService;
  credentials: {
    appKey: string;
    appSecret: string;
    accountNo8: string;
    accountProdCd: string;
  };
  logger: EventLogger;
  /** MOCK 환경 rate-limit 재시도 대기. 테스트에서 단축 가능. */
  rateLimitRetryDelayMs?: number;
  /**
   * RealtimePort 어댑터. 부트스트랩에서 RealtimeService + FeedBus 와 함께 주입.
   * 미주입 시 realtime() 호출은 throw.
   */
  realtime?: KisRealtimeAdapter;
}

/**
 * KIS adapter — BrokerPort 구현체.
 *
 * 각 메서드는 기존 src/main/kis/* 함수에 위임하고, mappers 로 wire→domain 변환.
 * RealtimePort 는 Stage 4 까지 미구현 (NotImplementedError throw).
 *
 * Auth/토큰 캐시 정책 (6h reuse, EGW00123 자동 invalidate) 은 KIS 내부 함수가
 * 그대로 보존하므로 여기서는 token 만 주입.
 */
export class KisAdapter implements BrokerPort {
  readonly brokerId = 'KIS' as const;
  readonly env: AppEnv;

  constructor(private readonly deps: KisAdapterDeps) {
    this.env = deps.env;
  }

  // ─── AuthPort ───────────────────────────────────────────────────────────

  async ensureSession(opts?: { forceRefresh?: boolean }): Promise<Result<void, BrokerError>> {
    const r = await this.deps.authService.getValidToken(
      this.env,
      this.deps.credentials.appKey,
      this.deps.credentials.appSecret,
      { forceRefresh: opts?.forceRefresh ?? false },
    );
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(undefined);
  }

  invalidateSession(): void {
    this.deps.authService.invalidate(this.env);
  }

  // ─── OrderPort ──────────────────────────────────────────────────────────

  async placeOrder(intent: OrderIntent): Promise<Result<OrderAck, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const token = tokenResult.value;
    const r = await orderCash(
      {
        http: this.deps.httpByEnv[this.env],
        env: this.env,
        token,
        appKey: this.deps.credentials.appKey,
        appSecret: this.deps.credentials.appSecret,
        accountNo8: this.deps.credentials.accountNo8,
        accountProdCd: this.deps.credentials.accountProdCd,
        logger: this.deps.logger,
        ...(this.deps.rateLimitRetryDelayMs !== undefined && {
          rateLimitRetryDelayMs: this.deps.rateLimitRetryDelayMs,
        }),
      },
      toKisOrderCashParams(intent),
    );
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(toOrderAck(r.value));
  }

  async cancelOrder(input: CancelOrderInput): Promise<Result<OrderAck, BrokerError>> {
    return this.runAmend(toKisCancelParams(input));
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
          brokerId: 'KIS',
          kind: 'VALIDATION',
          msg: 'amendOrder 는 qty>0 + price>0 필요 (KIS 정정 규칙)',
        }),
      );
    }
    return this.runAmend(toKisAmendParams(input, 'revise'));
  }

  private async runAmend(
    params: ReturnType<typeof toKisAmendParams>,
  ): Promise<Result<OrderAck, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const token = tokenResult.value;
    const r = await cancelOrRevise(
      {
        http: this.deps.httpByEnv[this.env],
        env: this.env,
        token,
        appKey: this.deps.credentials.appKey,
        appSecret: this.deps.credentials.appSecret,
        accountNo8: this.deps.credentials.accountNo8,
        accountProdCd: this.deps.credentials.accountProdCd,
        logger: this.deps.logger,
        ...(this.deps.rateLimitRetryDelayMs !== undefined && {
          rateLimitRetryDelayMs: this.deps.rateLimitRetryDelayMs,
        }),
      },
      params,
    );
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(toOrderAck(r.value));
  }

  async listDailyExecutions(
    p: ListDailyExecutionsParams,
  ): Promise<Result<DailyExecution[], BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const token = tokenResult.value;
    const r = await inquireDailyCcld(this.stockDeps(token), {
      from: p.from,
      to: p.to,
      ...(p.brokerOrderId !== undefined && { orderNo: p.brokerOrderId }),
      ...(p.symbol !== undefined && { code: p.symbol }),
      ...(p.side !== undefined && { side: p.side }),
      ...(p.filledOnly !== undefined && { filledOnly: p.filledOnly }),
    });
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(r.value.map(toDailyExecution));
  }

  // ─── BalancePort ────────────────────────────────────────────────────────

  async inquireBalance(): Promise<Result<Balance, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const token = tokenResult.value;
    const r = await inquireBalance(this.stockDeps(token));
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(toBalance(r.value));
  }

  // ─── MarketPort ─────────────────────────────────────────────────────────

  async getQuote(symbol: StockSymbol): Promise<Result<Quote, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const token = tokenResult.value;
    const r = await inquirePrice(this.stockDeps(token), symbol);
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(toQuote(r.value));
  }

  async getOrderbook(symbol: StockSymbol): Promise<Result<OrderbookSnapshot, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const token = tokenResult.value;
    const r = await inquireOrderbook(this.stockDeps(token), symbol);
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(toOrderbookSnapshot(r.value));
  }

  async getDailyOhlcv(p: GetDailyOhlcvParams): Promise<Result<Candle[], BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const token = tokenResult.value;
    const r = await inquireDailyChart(this.stockDeps(token), {
      code: p.symbol,
      from: p.from,
      to: p.to,
      ...(p.period !== undefined && { period: p.period }),
    });
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(r.value.map(toCandle));
  }

  async isTradingDay(date: Date): Promise<Result<boolean, BrokerError>> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) return err(tokenResult.error);
    const token = tokenResult.value;
    const bassDt = yyyymmdd(date);
    const r = await inquireDomesticHoliday(
      {
        http: this.deps.httpByEnv[this.env],
        env: this.env,
        token,
        appKey: this.deps.credentials.appKey,
        appSecret: this.deps.credentials.appSecret,
      },
      bassDt,
    );
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    const hit = r.value.find((h) => h.date === bassDt);
    return ok(hit?.openDay ?? false);
  }

  // ─── RealtimePort (Stage 4 까지 미구현) ─────────────────────────────────

  realtime(): RealtimePort {
    if (!this.deps.realtime) {
      throw new Error(
        'KisAdapter.realtime() — RealtimePort 어댑터가 주입되지 않음 (부트스트랩 누락)',
      );
    }
    return this.deps.realtime;
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────

  dispose(): void {
    // 현재 KIS adapter 는 별도 자원 없음. 토큰 캐시는 의도적으로 보존.
  }

  // ─── 내부 helpers ───────────────────────────────────────────────────────

  /** 유효 토큰 확보. 캐시 hit 면 즉시 반환, 만료 임박 시 재발급. */
  private async token(): Promise<Result<string, BrokerError>> {
    const r = await this.deps.authService.getValidToken(
      this.env,
      this.deps.credentials.appKey,
      this.deps.credentials.appSecret,
    );
    if (r.isErr()) return err(kisErrorToBrokerError(r.error));
    return ok(r.value.token);
  }

  /** domestic-stock 함수에 전달할 deps 묶음. */
  private stockDeps(token: string) {
    return {
      http: this.deps.httpByEnv[this.env],
      env: this.env,
      token,
      appKey: this.deps.credentials.appKey,
      appSecret: this.deps.credentials.appSecret,
      accountNo8: this.deps.credentials.accountNo8,
      accountProdCd: this.deps.credentials.accountProdCd,
    };
  }
}

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
