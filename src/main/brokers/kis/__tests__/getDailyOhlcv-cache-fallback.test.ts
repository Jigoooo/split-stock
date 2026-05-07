/**
 * KisAdapter.getDailyOhlcv 4xx 에러 cache fallback 테스트.
 *
 * Sub-AC 2: BUSINESS / VALIDATION / AUTH_FAILED / RATE_LIMITED 에러 발생 시
 * 재시도 없이 즉시 로컬 캐시에서 OHLCV 데이터를 조회하여 반환한다.
 *
 * - candlesRepo 주입 + 캐시 명중 → 캐시 데이터 반환 (ok)
 * - candlesRepo 주입 + 캐시 미스 → 원래 에러 반환 (err)
 * - candlesRepo 미주입 → 원래 에러 그대로 반환 (err)
 * - NETWORK 에러 → cache fallback 없음 (retry 전용 코드패스)
 */

import type { AuthService } from '@main/kis/auth';
import type { KisHttpClient } from '@main/kis/http-client';
import type { EventLogger } from '@main/logging/event-logger';
import { err as nerr, ok as nok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandlesSWRCache } from '../../core/candles-swr-cache';
import { CandlesSWRRevalidator } from '../../core/candles-swr-revalidate';
import { KisAdapter, type KisAdapterDeps } from '../adapter';

// ─── 공통 픽스처 ────────────────────────────────────────────────────────────

/** BUSINESS 에러 (rt_cd='1') — HTTP 4xx 계열 */
const BUSINESS_ERR_RESP = nok({
  body: { rt_cd: '1', msg_cd: 'EBIZ001', msg1: '잘못된 종목 코드', output2: [] },
});

/** RATE_LIMITED 에러 모사 */
const RATE_LIMITED_ERR = nerr({ kind: 'RATE_LIMITED' as const, msg: 'EGW00201 초과' });

/** AUTH_FAILED 에러 모사 */
const AUTH_FAILED_ERR = nerr({ kind: 'AUTH_FAILED' as const, msg: 'EGW00123 토큰 만료' });

/** VALIDATION 에러 모사 */
const VALIDATION_ERR = nerr({ kind: 'VALIDATION' as const, msg: '필수 파라미터 누락' });

/** 캐시에서 반환할 DailyCandle 데이터 */
const CACHED_CANDLES = [
  { date: '2025-01-02', open: 100, high: 110, low: 95, close: 105, volume: 1000 },
  { date: '2025-01-03', open: 105, high: 115, low: 100, close: 112, volume: 1200 },
];

const PARAMS = {
  symbol: '005930' as const,
  from: new Date('2025-01-01T00:00:00+09:00'),
  to: new Date('2025-01-31T00:00:00+09:00'),
};

/** KisAdapterDeps.candlesRepo 의 구조적 타입 */
type CandlesRepoLike = NonNullable<KisAdapterDeps['candlesRepo']>;

function makeMockRepo(getInRange: ReturnType<typeof vi.fn>): CandlesRepoLike {
  return { getInRange: getInRange as unknown as CandlesRepoLike['getInRange'] };
}

function makeAdapter(
  httpGet: ReturnType<typeof vi.fn>,
  candlesRepo?: CandlesRepoLike,
  swrCache?: CandlesSWRCache,
) {
  const http = { get: httpGet, post: vi.fn() } as unknown as KisHttpClient;
  return new KisAdapter({
    env: 'MOCK',
    authService: {
      getValidToken: vi.fn(async () =>
        nok({ expiresAt: Date.now() + 3_600_000, token: 'test-token', tokenType: 'Bearer' }),
      ),
    } as unknown as AuthService,
    credentials: {
      accountNo8: '12345678',
      accountProdCd: '01',
      appKey: 'app-key-test',
      appSecret: 'app-secret-test',
    },
    httpByEnv: { MOCK: http, PROD: http },
    logger: { log: vi.fn() } as unknown as EventLogger,
    tradingCalendar: { getTradingDayStatus: vi.fn() },
    ohlcvRetryBaseDelayMs: 1,
    ...(candlesRepo !== undefined && { candlesRepo }),
    ...(swrCache !== undefined && { swrCache }),
  });
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('KisAdapter.getDailyOhlcv — 4xx cache fallback', () => {
  let httpGet: ReturnType<typeof vi.fn>;
  let repoGetInRange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    httpGet = vi.fn();
    repoGetInRange = vi.fn();
  });

  describe('BUSINESS 에러 + cache 명중', () => {
    it('캐시 데이터를 ok로 반환한다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value).toHaveLength(2);
        expect(r.value[0]).toMatchObject({
          date: '2025-01-02',
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        });
      }
    });

    it('BUSINESS 에러는 재시도 없이 1회만 http 호출한다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      await adapter.getDailyOhlcv(PARAMS);

      expect(httpGet).toHaveBeenCalledTimes(1);
    });

    it('올바른 인자로 getInRange를 호출한다 — period 기본값 D', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      await adapter.getDailyOhlcv(PARAMS);

      expect(repoGetInRange).toHaveBeenCalledWith('005930', 'D', '2025-01-01', '2025-01-31');
    });

    it('period W가 지정되면 getInRange에 W를 전달한다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      await adapter.getDailyOhlcv({ ...PARAMS, period: 'W' });

      expect(repoGetInRange).toHaveBeenCalledWith('005930', 'W', '2025-01-01', '2025-01-31');
    });
  });

  describe('RATE_LIMITED 에러 + cache 명중', () => {
    it('캐시 데이터를 ok로 반환한다', async () => {
      httpGet.mockResolvedValue(RATE_LIMITED_ERR);
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      if (r.isOk()) expect(r.value).toHaveLength(2);
    });
  });

  describe('AUTH_FAILED 에러 + cache 명중', () => {
    it('캐시 데이터를 ok로 반환한다', async () => {
      httpGet.mockResolvedValue(AUTH_FAILED_ERR);
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      if (r.isOk()) expect(r.value).toHaveLength(2);
    });
  });

  describe('VALIDATION 에러 + cache 명중', () => {
    it('캐시 데이터를 ok로 반환한다', async () => {
      httpGet.mockResolvedValue(VALIDATION_ERR);
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      if (r.isOk()) expect(r.value).toHaveLength(2);
    });
  });

  describe('4xx 에러 + cache 미스 (빈 배열)', () => {
    it('원래 BUSINESS 에러를 반환한다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      repoGetInRange.mockReturnValue([]); // 캐시 미스
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isErr()).toBe(true);
      if (r.isErr()) {
        expect(r.error.kind).toBe('BUSINESS');
        expect(r.error.brokerId).toBe('KIS');
      }
    });
  });

  describe('4xx 에러 + candlesRepo 미주입', () => {
    it('candlesRepo 없으면 원래 에러를 그대로 반환한다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      const adapter = makeAdapter(httpGet); // candlesRepo 미주입

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.kind).toBe('BUSINESS');
    });
  });

  describe('NETWORK 에러 (5xx) — cache fallback 없음', () => {
    it('NETWORK 에러 시 getInRange를 호출하지 않는다', async () => {
      // NETWORK 에러 4회 (초기 1 + 재시도 3)
      httpGet.mockResolvedValue(nerr({ kind: 'NETWORK' as const, msg: 'HTTP 503' }));
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange));

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.kind).toBe('NETWORK');
      // cache fallback 없음
      expect(repoGetInRange).not.toHaveBeenCalled();
    });
  });

  // ─── SWR 인메모리 캐시 통합 테스트 ────────────────────────────────────────

  describe('성공 응답 → swrCache 저장', () => {
    it('성공 시 swrCache.set 을 호출한다', async () => {
      const SUCCESS_RESP = nok({
        body: {
          rt_cd: '0',
          msg_cd: '',
          msg1: '',
          output2: [
            {
              stck_bsop_date: '20250102',
              stck_oprc: '100',
              stck_hgpr: '110',
              stck_lwpr: '95',
              stck_clpr: '105',
              acml_vol: '1000',
            },
          ],
        },
      });
      httpGet.mockResolvedValue(SUCCESS_RESP);
      const swrCache = new CandlesSWRCache();
      const setSpy = vi.spyOn(swrCache, 'set');
      const adapter = makeAdapter(httpGet, undefined, swrCache);

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy).toHaveBeenCalledWith('005930', 'D', expect.any(Array));
    });
  });

  describe('4xx 에러 + swrCache 명중', () => {
    it('swrCache 에서 데이터를 ok로 반환한다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      const swrCache = new CandlesSWRCache();
      swrCache.set('005930', 'D', CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, undefined, swrCache);

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value).toHaveLength(2);
        expect(r.value[0]).toMatchObject({ date: '2025-01-02', open: 100 });
      }
    });

    it('swrCache 가 candlesRepo 보다 우선한다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      const swrCache = new CandlesSWRCache();
      swrCache.set('005930', 'D', CACHED_CANDLES);
      const repoGetInRange = vi
        .fn()
        .mockReturnValue([
          { date: '2025-01-02', open: 999, high: 999, low: 999, close: 999, volume: 999 },
        ]);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange), swrCache);

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      if (r.isOk()) expect(r.value[0]?.open).toBe(100); // swrCache 값 (999가 아님)
      expect(repoGetInRange).not.toHaveBeenCalled();
    });
  });

  describe('4xx 에러 + swrCache 미스 → candlesRepo fallback', () => {
    it('swrCache 미스이면 candlesRepo 를 조회한다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      const swrCache = new CandlesSWRCache(); // 빈 캐시
      repoGetInRange.mockReturnValue(CACHED_CANDLES);
      const adapter = makeAdapter(httpGet, makeMockRepo(repoGetInRange), swrCache);

      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      expect(repoGetInRange).toHaveBeenCalledTimes(1);
    });
  });

  // ─── SWR 재검증 트리거 테스트 ───────────────────────────────────────────────

  describe('4xx 에러 + swrCache 명중 → swrRevalidator 트리거', () => {
    function makeAdapterWithRevalidator(
      httpGetFn: ReturnType<typeof vi.fn>,
      swrCache: CandlesSWRCache,
      swrRevalidator: CandlesSWRRevalidator,
    ) {
      const http = { get: httpGetFn, post: vi.fn() } as unknown as KisHttpClient;
      return new KisAdapter({
        env: 'MOCK',
        authService: {
          getValidToken: vi.fn(async () =>
            nok({ expiresAt: Date.now() + 3_600_000, token: 'test-token', tokenType: 'Bearer' }),
          ),
        } as unknown as AuthService,
        credentials: {
          accountNo8: '12345678',
          accountProdCd: '01',
          appKey: 'app-key-test',
          appSecret: 'app-secret-test',
        },
        httpByEnv: { MOCK: http, PROD: http },
        logger: { log: vi.fn() } as unknown as EventLogger,
        tradingCalendar: { getTradingDayStatus: vi.fn() },
        ohlcvRetryBaseDelayMs: 1,
        swrCache,
        swrRevalidator,
      });
    }

    it('swrCache 명중 시 swrRevalidator.triggerRevalidate 가 호출된다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      const swrCache = new CandlesSWRCache();
      swrCache.set('005930', 'D', CACHED_CANDLES);
      const swrRevalidator = new CandlesSWRRevalidator(swrCache);
      const triggerSpy = vi.spyOn(swrRevalidator, 'triggerRevalidate');

      const adapter = makeAdapterWithRevalidator(httpGet, swrCache, swrRevalidator);
      const r = await adapter.getDailyOhlcv(PARAMS);

      expect(r.isOk()).toBe(true);
      expect(triggerSpy).toHaveBeenCalledTimes(1);
      expect(triggerSpy).toHaveBeenCalledWith('005930', 'D', expect.any(Function));
    });

    it('triggerRevalidate 에 전달된 fetchFn 이 함수이다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      const swrCache = new CandlesSWRCache();
      swrCache.set('005930', 'D', CACHED_CANDLES);
      const swrRevalidator = new CandlesSWRRevalidator(swrCache);
      let capturedFetchFn: (() => unknown) | undefined;
      vi.spyOn(swrRevalidator, 'triggerRevalidate').mockImplementation(
        (_pdno, _period, fetchFn) => {
          capturedFetchFn = fetchFn;
        },
      );

      const adapter = makeAdapterWithRevalidator(httpGet, swrCache, swrRevalidator);
      await adapter.getDailyOhlcv(PARAMS);

      expect(typeof capturedFetchFn).toBe('function');
    });

    it('swrCache 미스 시 swrRevalidator.triggerRevalidate 가 호출되지 않는다', async () => {
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      const swrCache = new CandlesSWRCache(); // 빈 캐시 — swrCache 미스
      const swrRevalidator = new CandlesSWRRevalidator(swrCache);
      const triggerSpy = vi.spyOn(swrRevalidator, 'triggerRevalidate');

      const adapter = makeAdapterWithRevalidator(httpGet, swrCache, swrRevalidator);
      await adapter.getDailyOhlcv(PARAMS);

      // swrCache miss → candlesRepo/에러 path로 진행 → revalidate 호출 없음
      expect(triggerSpy).not.toHaveBeenCalled();
    });

    it('NETWORK 에러 시 swrRevalidator.triggerRevalidate 가 호출되지 않는다', async () => {
      // NETWORK 에러는 cache fallback 없음 → revalidator 도 호출 안 됨
      httpGet.mockResolvedValue(nerr({ kind: 'NETWORK' as const, msg: 'HTTP 503' }));
      const swrCache = new CandlesSWRCache();
      swrCache.set('005930', 'D', CACHED_CANDLES);
      const swrRevalidator = new CandlesSWRRevalidator(swrCache);
      const triggerSpy = vi.spyOn(swrRevalidator, 'triggerRevalidate');

      const adapter = makeAdapterWithRevalidator(httpGet, swrCache, swrRevalidator);
      await adapter.getDailyOhlcv(PARAMS);

      expect(triggerSpy).not.toHaveBeenCalled();
    });
  });

  describe('cache fallback 로깅', () => {
    it('cache fallback 시 WARN 로그를 남긴다', async () => {
      const logger = { log: vi.fn() } as unknown as EventLogger;
      httpGet.mockResolvedValue(BUSINESS_ERR_RESP);
      repoGetInRange.mockReturnValue(CACHED_CANDLES);

      const http = { get: httpGet, post: vi.fn() } as unknown as KisHttpClient;
      const adapter = new KisAdapter({
        env: 'MOCK',
        authService: {
          getValidToken: vi.fn(async () =>
            nok({ expiresAt: Date.now() + 3_600_000, token: 'test-token', tokenType: 'Bearer' }),
          ),
        } as unknown as AuthService,
        credentials: {
          accountNo8: '12345678',
          accountProdCd: '01',
          appKey: 'app-key-test',
          appSecret: 'app-secret-test',
        },
        httpByEnv: { MOCK: http, PROD: http },
        logger,
        tradingCalendar: { getTradingDayStatus: vi.fn() },
        ohlcvRetryBaseDelayMs: 1,
        candlesRepo: makeMockRepo(repoGetInRange),
      });

      await adapter.getDailyOhlcv(PARAMS);

      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'WARN',
          category: 'SYS',
          message: 'kis.getDailyOhlcv.cache-fallback',
          payload: expect.objectContaining({
            symbol: '005930',
            errorKind: 'BUSINESS',
            cachedCount: 2,
          }),
        }),
      );
    });
  });
});
