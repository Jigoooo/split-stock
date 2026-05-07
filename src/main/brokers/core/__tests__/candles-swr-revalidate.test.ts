/**
 * CandlesSWRRevalidator — 백그라운드 fresh fetch 트리거 로직 테스트 (Sub-AC 3-2-1).
 *
 * 설계 원칙:
 * - triggerRevalidate(pdno, period, fetchFn) → void (fire-and-forget)
 * - 동일 (pdno, period) 재검증 중복 방지 (in-flight dedup)
 * - fetchFn 실패(err Result / throw) → silent WARN log, cache 미갱신
 * - fetchFn ok([]) → cache 미갱신, INFO log (no-op)
 * - pending(pdno, period) → 테스트 관측용 in-flight Promise 노출
 */

import type { DailyCandle } from '@main/trading/daily-candles-repo';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandlesSWRCache } from '../candles-swr-cache';
import type { RevalidateFetchFn } from '../candles-swr-revalidate';
import { CandlesSWRRevalidator } from '../candles-swr-revalidate';

// ─── 픽스처 ──────────────────────────────────────────────────────────────────

const CANDLES: DailyCandle[] = [
  { date: '2025-01-01', open: 100, high: 110, low: 95, close: 105, volume: 1000 },
  { date: '2025-01-02', open: 105, high: 115, low: 100, close: 112, volume: 1200 },
];

const FRESH_CANDLES: DailyCandle[] = [
  { date: '2025-01-03', open: 112, high: 120, low: 108, close: 118, volume: 1500 },
];

const PDNO = '005930';
const PERIOD = 'D' as const;

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function makeLogger() {
  return { log: vi.fn() };
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('CandlesSWRRevalidator — 기본 동작', () => {
  let cache: CandlesSWRCache;
  let revalidator: CandlesSWRRevalidator;

  beforeEach(() => {
    cache = new CandlesSWRCache();
    revalidator = new CandlesSWRRevalidator(cache);
  });

  it('fetchFn 성공 → cache.set 호출됨', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(FRESH_CANDLES));
    const cacheSpy = vi.spyOn(cache, 'set');

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(cacheSpy).toHaveBeenCalledWith(PDNO, PERIOD, FRESH_CANDLES);
  });

  it('fetchFn ok([]) → cache.set 호출 안 됨 (no-op)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok([]));
    const cacheSpy = vi.spyOn(cache, 'set');

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(cacheSpy).not.toHaveBeenCalled();
  });

  it('fetchFn err(...) → cache.set 호출 안 됨, 에러 throw 없음', async () => {
    const fetchFn = vi.fn().mockResolvedValue(err({ kind: 'NETWORK' as const, msg: 'timeout' }));
    const cacheSpy = vi.spyOn(cache, 'set');

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await expect(revalidator.pending(PDNO, PERIOD)).resolves.toBeUndefined();
    expect(cacheSpy).not.toHaveBeenCalled();
  });

  it('fetchFn throw → silent 처리, 에러 전파 없음', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('unexpected crash'));
    const cacheSpy = vi.spyOn(cache, 'set');

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await expect(revalidator.pending(PDNO, PERIOD)).resolves.toBeUndefined();
    expect(cacheSpy).not.toHaveBeenCalled();
  });
});

describe('CandlesSWRRevalidator — in-flight 중복 방지', () => {
  let cache: CandlesSWRCache;
  let revalidator: CandlesSWRRevalidator;

  beforeEach(() => {
    cache = new CandlesSWRCache();
    revalidator = new CandlesSWRRevalidator(cache);
  });

  it('동일 키 재검증 중 → fetchFn 1회만 호출', async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstFetch = new Promise((res) => {
      resolveFirst = res;
    });
    const fetchFn = vi.fn().mockReturnValue(firstFetch.then(() => ok(FRESH_CANDLES)));

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn); // 두 번째 — dedup 되어야 함

    resolveFirst(undefined);
    await revalidator.pending(PDNO, PERIOD);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('재검증 완료 후 → 슬롯 해제, 다음 triggerRevalidate 가 새 fetch 시작', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(FRESH_CANDLES));

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    // 완료 후 재트리거
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('다른 (pdno, period) 키 → 독립 슬롯, 양쪽 모두 fetch 실행', async () => {
    const fetchFnA = vi.fn().mockResolvedValue(ok(CANDLES));
    const fetchFnB = vi.fn().mockResolvedValue(ok(FRESH_CANDLES));

    revalidator.triggerRevalidate('005930', 'D', fetchFnA);
    revalidator.triggerRevalidate('000660', 'D', fetchFnB);

    await revalidator.pending('005930', 'D');
    await revalidator.pending('000660', 'D');

    expect(fetchFnA).toHaveBeenCalledTimes(1);
    expect(fetchFnB).toHaveBeenCalledTimes(1);
  });
});

describe('CandlesSWRRevalidator — pending() 관측', () => {
  let cache: CandlesSWRCache;
  let revalidator: CandlesSWRRevalidator;

  beforeEach(() => {
    cache = new CandlesSWRCache();
    revalidator = new CandlesSWRRevalidator(cache);
  });

  it('triggerRevalidate 전 → pending() undefined', () => {
    expect(revalidator.pending(PDNO, PERIOD)).toBeUndefined();
  });

  it('triggerRevalidate 후 진행 중 → pending() Promise', () => {
    let resolveFirst!: () => void;
    const fetchFn: RevalidateFetchFn = vi.fn(
      () =>
        new Promise<Result<readonly DailyCandle[], { kind: string }>>((res) => {
          resolveFirst = () => res(ok(FRESH_CANDLES));
        }),
    );

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);

    expect(revalidator.pending(PDNO, PERIOD)).toBeInstanceOf(Promise);
    resolveFirst();
  });

  it('재검증 완료 후 → pending() undefined (슬롯 해제)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(FRESH_CANDLES));

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(revalidator.pending(PDNO, PERIOD)).toBeUndefined();
  });
});

describe('CandlesSWRRevalidator — 로깅', () => {
  let cache: CandlesSWRCache;

  beforeEach(() => {
    cache = new CandlesSWRCache();
  });

  it('fetchFn err → WARN 레벨 로그', async () => {
    const logger = makeLogger();
    const revalidator = new CandlesSWRRevalidator(cache, logger);
    const fetchFn = vi.fn().mockResolvedValue(err({ kind: 'NETWORK' as const, msg: 'timeout' }));

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'WARN',
        message: 'candles-swr-revalidate.fetch-failed',
        payload: expect.objectContaining({ pdno: PDNO, period: PERIOD }),
      }),
    );
  });

  it('fetchFn throw → WARN 레벨 로그', async () => {
    const logger = makeLogger();
    const revalidator = new CandlesSWRRevalidator(cache, logger);
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom'));

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'WARN',
        message: 'candles-swr-revalidate.fetch-exception',
      }),
    );
  });

  it('fetchFn ok([]) → INFO 레벨 로그', async () => {
    const logger = makeLogger();
    const revalidator = new CandlesSWRRevalidator(cache, logger);
    const fetchFn = vi.fn().mockResolvedValue(ok([]));

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'INFO',
        message: 'candles-swr-revalidate.empty-result',
        payload: expect.objectContaining({ pdno: PDNO, period: PERIOD }),
      }),
    );
  });

  it('logger 미주입 시에도 에러 없이 동작', async () => {
    // logger 없이 생성
    const revalidator = new CandlesSWRRevalidator(cache);
    const fetchFn = vi.fn().mockResolvedValue(err({ kind: 'NETWORK' as const, msg: 'timeout' }));

    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await expect(revalidator.pending(PDNO, PERIOD)).resolves.toBeUndefined();
  });
});

describe('CandlesSWRRevalidator — onSuccess 콜백', () => {
  it('fetchFn 성공(data) → onSuccess(pdno, period, candles) 호출', async () => {
    const cache = new CandlesSWRCache();
    const onSuccess = vi.fn();
    const revalidator = new CandlesSWRRevalidator(cache, undefined, onSuccess);

    const fetchFn = vi.fn().mockResolvedValue(ok(FRESH_CANDLES));
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(PDNO, PERIOD, FRESH_CANDLES);
  });

  it('fetchFn ok([]) → onSuccess 호출 안 됨', async () => {
    const cache = new CandlesSWRCache();
    const onSuccess = vi.fn();
    const revalidator = new CandlesSWRRevalidator(cache, undefined, onSuccess);

    const fetchFn = vi.fn().mockResolvedValue(ok([]));
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('fetchFn err → onSuccess 호출 안 됨', async () => {
    const cache = new CandlesSWRCache();
    const onSuccess = vi.fn();
    const revalidator = new CandlesSWRRevalidator(cache, undefined, onSuccess);

    const fetchFn = vi.fn().mockResolvedValue(err({ kind: 'NETWORK' as const, msg: 'timeout' }));
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('fetchFn throw → onSuccess 호출 안 됨', async () => {
    const cache = new CandlesSWRCache();
    const onSuccess = vi.fn();
    const revalidator = new CandlesSWRRevalidator(cache, undefined, onSuccess);

    const fetchFn = vi.fn().mockRejectedValue(new Error('crash'));
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('onSuccess 미주입 시 에러 없이 동작', async () => {
    const cache = new CandlesSWRCache();
    const revalidator = new CandlesSWRRevalidator(cache);

    const fetchFn = vi.fn().mockResolvedValue(ok(FRESH_CANDLES));
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await expect(revalidator.pending(PDNO, PERIOD)).resolves.toBeUndefined();
  });
});

describe('CandlesSWRRevalidator — 캐시 갱신 검증', () => {
  it('fetchFn 성공 → 캐시에 새 데이터 저장됨', async () => {
    const cache = new CandlesSWRCache();
    const revalidator = new CandlesSWRRevalidator(cache);

    // 기존 stale 캐시 설정
    cache.set(PDNO, PERIOD, CANDLES, 0); // fetchedAt=0 → stale

    const fetchFn = vi.fn().mockResolvedValue(ok(FRESH_CANDLES));
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    const result = cache.get(PDNO, PERIOD);
    expect(result?.candles).toHaveLength(1);
    expect(result?.candles[0]?.date).toBe('2025-01-03');
  });

  it('fetchFn 실패 → 기존 캐시 보존 (덮어쓰지 않음)', async () => {
    const cache = new CandlesSWRCache();
    const revalidator = new CandlesSWRRevalidator(cache);

    cache.set(PDNO, PERIOD, CANDLES, 0);

    const fetchFn = vi.fn().mockResolvedValue(err({ kind: 'NETWORK' as const, msg: 'err' }));
    revalidator.triggerRevalidate(PDNO, PERIOD, fetchFn);
    await revalidator.pending(PDNO, PERIOD);

    const result = cache.get(PDNO, PERIOD);
    expect(result?.candles).toHaveLength(2); // 기존 2개 유지
  });
});
