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
  TradingDayVerdict,
} from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { CandlesSWRCache } from '../core/candles-swr-cache';
import type { CandlesSWRRevalidator } from '../core/candles-swr-revalidate';
import { withExponentialBackoff } from '../core/retry';
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
import { shouldFallbackKisMockTradingDayToLocal, yyyymmdd } from './trading-day-fallback';

export { shouldFallbackKisMockTradingDayToLocal } from './trading-day-fallback';

/**
 * Date → 로컬 날짜 기준 YYYY-MM-DD 문자열.
 *
 * toISOString()은 UTC로 변환하므로 KST 자정이 전날로 변할 수 있다.
 * 로컬 getFullYear/getMonth/getDate를 사용해 시간대 무관하게 날짜만 추출한다.
 */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
    htsId?: string;
  };
  logger: EventLogger;
  tradingCalendar: {
    getTradingDayStatus(date: Date | string): TradingDayVerdict;
  };
  /** MOCK 환경 rate-limit 재시도 대기. 테스트에서 단축 가능. */
  rateLimitRetryDelayMs?: number;
  /**
   * getDailyOhlcv 재시도 기본 지연(ms). 기본값 200ms (200→600→1800ms 지수 백오프).
   * 테스트에서 1ms 로 단축 가능.
   */
  ohlcvRetryBaseDelayMs?: number;
  /**
   * 4xx 에러 즉시 fallback 용 로컬 OHLCV 캐시.
   *
   * BUSINESS / VALIDATION / AUTH_FAILED / RATE_LIMITED 에러 발생 시 이 캐시에서
   * 데이터를 조회한다. 미주입 시 fallback 없이 원래 에러를 반환한다.
   *
   * date 는 YYYY-MM-DD 형식으로 저장·조회된다.
   */
  candlesRepo?: {
    getInRange(
      pdno: string,
      period: 'D' | 'W' | 'M',
      from: string,
      to: string,
    ): ReadonlyArray<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
  };
  /**
   * SWR 인메모리 캐시.
   *
   * 성공 응답을 즉시 저장하고, 4xx 에러 fallback 시 candlesRepo(SQLite) 보다
   * 우선 조회한다. 미주입 시 SWR 캐시 단계를 건너뛴다.
   */
  swrCache?: CandlesSWRCache;
  /**
   * SWR 백그라운드 재검증 트리거.
   *
   * swrCache 에서 stale 데이터를 반환할 때 백그라운드 fresh fetch 를 트리거한다.
   * 미주입 시 재검증 없이 stale 데이터만 반환한다.
   */
  swrRevalidator?: CandlesSWRRevalidator;
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

    /**
     * 5xx / timeout(NETWORK) 발생 시 최대 3회 자동 재시도.
     * 지수 백오프 factor=3: 200ms → 600ms → 1.8s (full jitter 적용, cap 30s).
     * BUSINESS / AUTH_FAILED / RATE_LIMITED 등은 재시도 불가 — 즉시 반환.
     */
    const retryResult = await withExponentialBackoff(
      async () => {
        const r = await inquireDailyChart(this.stockDeps(token), {
          code: p.symbol,
          from: p.from,
          to: p.to,
          ...(p.period !== undefined && { period: p.period }),
        });
        if (r.isOk()) return { ok: true as const, value: r.value };
        return { ok: false as const, error: kisErrorToBrokerError(r.error) };
      },
      {
        maxRetries: 3,
        baseDelayMs: this.deps.ohlcvRetryBaseDelayMs ?? 200,
        backoffFactor: 3,
        maxDelayMs: 30_000,
        retryable: (e: BrokerError) => e.kind === 'NETWORK',
        onRetry: (attempt, e) => {
          this.deps.logger.log({
            level: 'WARN',
            category: 'SYS',
            message: 'kis.getDailyOhlcv.retry',
            payload: { symbol: p.symbol, attempt, errorKind: e.kind, msg: e.msg },
          });
        },
      },
    );

    const period: 'D' | 'W' | 'M' = p.period ?? 'D';

    if (retryResult.ok) {
      const candles = retryResult.value.map(toCandle);
      this.deps.swrCache?.set(p.symbol, period, candles);
      return ok(candles);
    }

    const brokerErr = retryResult.error;

    /**
     * 4xx 에러 즉시 cache fallback.
     *
     * BUSINESS / VALIDATION / AUTH_FAILED / RATE_LIMITED 는 재시도가 불가능하므로
     * 1순위: SWR 인메모리 캐시, 2순위: 로컬 DB 캐시(candlesRepo) 에서 OHLCV를 조회해
     * 반환한다. NETWORK(5xx/timeout) 은 cache fallback 대상이 아님 —
     * withExponentialBackoff 가 이미 최대 재시도를 소진한 상태이므로 에러를 전파한다.
     */
    if (brokerErr.kind !== 'NETWORK') {
      const fromStr = toLocalDateStr(p.from);
      const toStr = toLocalDateStr(p.to);

      // 1순위: SWR 인메모리 캐시
      if (this.deps.swrCache !== undefined) {
        const swrHit = this.deps.swrCache.getInRange(p.symbol, period, fromStr, toStr);
        if (swrHit.length > 0) {
          this.deps.logger.log({
            level: 'WARN',
            category: 'SYS',
            message: 'kis.getDailyOhlcv.swr-fallback',
            payload: {
              symbol: p.symbol,
              errorKind: brokerErr.kind,
              cachedCount: swrHit.length,
              from: fromStr,
              to: toStr,
            },
          });

          // SWR 패턴: stale 데이터를 즉시 반환하면서 백그라운드 fresh fetch 트리거.
          // fetchFn 은 fire-and-forget — 성공 시 swrCache 갱신, 실패 시 WARN 로그.
          const capturedP = p;
          const capturedPeriod = period;
          this.deps.swrRevalidator?.triggerRevalidate(
            capturedP.symbol,
            capturedPeriod,
            async () => {
              const freshTokenResult = await this.token();
              if (freshTokenResult.isErr()) {
                return err({
                  kind: freshTokenResult.error.kind,
                  msg: freshTokenResult.error.msg,
                });
              }
              const r = await inquireDailyChart(this.stockDeps(freshTokenResult.value), {
                code: capturedP.symbol,
                from: capturedP.from,
                to: capturedP.to,
                ...(capturedP.period !== undefined && { period: capturedP.period }),
              });
              if (r.isOk()) return ok(r.value.map(toCandle));
              const e = kisErrorToBrokerError(r.error);
              return err({ kind: e.kind, msg: e.msg });
            },
          );

          return ok(
            swrHit.map((c) => ({
              date: c.date,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            })),
          );
        }
      }

      // 2순위: 로컬 DB 캐시
      if (this.deps.candlesRepo !== undefined) {
        const cached = this.deps.candlesRepo.getInRange(p.symbol, period, fromStr, toStr);
        if (cached.length > 0) {
          this.deps.logger.log({
            level: 'WARN',
            category: 'SYS',
            message: 'kis.getDailyOhlcv.cache-fallback',
            payload: {
              symbol: p.symbol,
              errorKind: brokerErr.kind,
              cachedCount: cached.length,
              from: fromStr,
              to: toStr,
            },
          });
          return ok(
            cached.map((c) => ({
              date: c.date,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            })),
          );
        }
      }
    }

    return err(brokerErr);
  }

  async getTradingDayStatus(date: Date): Promise<Result<TradingDayVerdict, BrokerError>> {
    const verdict = this.deps.tradingCalendar.getTradingDayStatus(date);
    return ok(await this.verifyKisTradingDay(date, verdict));
  }

  async isTradingDay(date: Date): Promise<Result<boolean, BrokerError>> {
    const verdictResult = await this.getTradingDayStatus(date);
    if (verdictResult.isErr()) return err(verdictResult.error);
    if (verdictResult.value.source === 'UNKNOWN') {
      return err(
        makeBrokerError({
          brokerId: 'KIS',
          kind: 'BUSINESS',
          msg: `거래일 확인 불가: ${verdictResult.value.reason}`,
        }),
      );
    }
    return ok(verdictResult.value.openDay);
  }

  private async verifyKisTradingDay(
    date: Date,
    verdict: TradingDayVerdict,
  ): Promise<TradingDayVerdict> {
    const tokenResult = await this.token();
    if (tokenResult.isErr()) {
      this.deps.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'kis.trading-day.verification-failed',
        payload: {
          date: verdict.date,
          kind: tokenResult.error.kind,
          msg: tokenResult.error.msg,
        },
      });
      return verdict;
    }
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
    if (r.isErr()) {
      if (shouldFallbackKisMockTradingDayToLocal(this.env, r.error)) {
        this.deps.logger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'kis.trading-day.verification-unavailable',
          payload: {
            date: bassDt,
            calendarOpenDay: verdict.openDay,
            reason: r.error.msg,
          },
        });
        return verdict;
      }
      const brokerError = kisErrorToBrokerError(r.error);
      this.deps.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'kis.trading-day.verification-failed',
        payload: {
          date: bassDt,
          kind: brokerError.kind,
          msg: brokerError.msg,
        },
      });
      return verdict;
    }
    const hit = r.value.find((h) => h.date === bassDt);
    const kisOpenDay = hit?.openDay ?? false;
    if (kisOpenDay === verdict.openDay) {
      return { ...verdict, kisVerified: true };
    }
    this.deps.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'calendar-source-mismatch',
      payload: {
        date: bassDt,
        brokerId: 'KIS',
        env: this.env,
        calendarOpenDay: verdict.openDay,
        kisOpenDay,
        source: verdict.source,
        reason: verdict.reason,
      },
    });
    return { ...verdict, kisVerified: false };
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
