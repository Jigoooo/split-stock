/**
 * CandlesSWRCache — stale-while-revalidate 캔들 인메모리 캐시 테스트 (D3).
 *
 * Sub-AC 3.1: 차트 데이터 캐시 레이어 구현
 *  - 캐시 키 전략: (pdno, period) 버킷 — 날짜 범위로 파편화하지 않음
 *  - TTL + isStale 판정
 *  - SWR 패턴: stale 여도 즉시 반환 (null 반환 안 함)
 *  - DailyCandlesRepo 호환 getInRange() 인터페이스
 *  - invalidate / clear
 */

import { describe, expect, it } from 'vitest';
import { CandlesSWRCache } from '../candles-swr-cache';

// ─── 픽스처 ──────────────────────────────────────────────────────────────────

const CANDLES = [
  { date: '2025-01-01', open: 100, high: 110, low: 95, close: 105, volume: 1000 },
  { date: '2025-01-02', open: 105, high: 115, low: 100, close: 112, volume: 1200 },
  { date: '2025-01-03', open: 112, high: 120, low: 108, close: 118, volume: 1500 },
] as const;

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('CandlesSWRCache — 캐시 미스', () => {
  it('빈 캐시에서 get() → null', () => {
    const cache = new CandlesSWRCache();
    expect(cache.get('005930', 'D')).toBeNull();
  });

  it('getInRange() 캐시 미스 → 빈 배열', () => {
    const cache = new CandlesSWRCache();
    expect(cache.getInRange('005930', 'D', '2025-01-01', '2025-01-31')).toEqual([]);
  });

  it('isStale() 캐시 미스 → true (stale 로 간주)', () => {
    const cache = new CandlesSWRCache();
    expect(cache.isStale('005930', 'D')).toBe(true);
  });
});

describe('CandlesSWRCache — 저장 및 조회', () => {
  it('set() 후 get() → 캔들 반환, isStale=false', () => {
    const now = 0;
    const cache = new CandlesSWRCache({ now: () => now });

    cache.set('005930', 'D', CANDLES);
    const result = cache.get('005930', 'D');

    expect(result).not.toBeNull();
    expect(result?.candles).toHaveLength(3);
    expect(result?.isStale).toBe(false);
  });

  it('fetchedAt 이 set 시각으로 저장된다', () => {
    const now = 5000;
    const cache = new CandlesSWRCache({ now: () => now });

    cache.set('005930', 'D', CANDLES);
    expect(cache.get('005930', 'D')?.fetchedAt).toBe(5000);
  });

  it('커스텀 fetchedAt 을 전달하면 그 값이 저장된다', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES, 99_999);
    expect(cache.get('005930', 'D')?.fetchedAt).toBe(99_999);
  });

  it('set() 을 다시 호출하면 기존 엔트리를 덮어쓴다', () => {
    let now = 0;
    const cache = new CandlesSWRCache({ now: () => now });

    cache.set('005930', 'D', CANDLES);
    now = 1000;
    const newCandles = [
      { date: '2025-02-01', open: 200, high: 210, low: 195, close: 205, volume: 2000 },
    ];
    cache.set('005930', 'D', newCandles);

    const result = cache.get('005930', 'D');
    expect(result?.candles).toHaveLength(1);
    expect(result?.fetchedAt).toBe(1000);
  });
});

describe('CandlesSWRCache — TTL / stale 판정', () => {
  it('TTL 미경과(경계-1ms) → isStale=false', () => {
    let now = 0;
    const cache = new CandlesSWRCache({ ttlMs: 60_000, now: () => now });

    cache.set('005930', 'D', CANDLES);
    now = 59_999;

    expect(cache.get('005930', 'D')?.isStale).toBe(false);
  });

  it('TTL 정확히 경과 → isStale=true', () => {
    let now = 0;
    const cache = new CandlesSWRCache({ ttlMs: 60_000, now: () => now });

    cache.set('005930', 'D', CANDLES);
    now = 60_000;

    expect(cache.get('005930', 'D')?.isStale).toBe(true);
  });

  it('SWR 패턴: stale 여도 캔들 반환 (null 아님)', () => {
    let now = 0;
    const cache = new CandlesSWRCache({ ttlMs: 1_000, now: () => now });

    cache.set('005930', 'D', CANDLES);
    now = 99_999; // 훨씬 경과

    const result = cache.get('005930', 'D');
    expect(result).not.toBeNull(); // null 아님 — SWR 패턴
    expect(result?.isStale).toBe(true);
    expect(result?.candles).toHaveLength(3);
  });

  it('isStale() — TTL 미경과 → false', () => {
    let now = 0;
    const cache = new CandlesSWRCache({ ttlMs: 1000, now: () => now });
    cache.set('005930', 'D', CANDLES);
    now = 999;
    expect(cache.isStale('005930', 'D')).toBe(false);
  });

  it('isStale() — TTL 경과 → true', () => {
    let now = 0;
    const cache = new CandlesSWRCache({ ttlMs: 1000, now: () => now });
    cache.set('005930', 'D', CANDLES);
    now = 1000;
    expect(cache.isStale('005930', 'D')).toBe(true);
  });

  it('기본 TTL 은 5분(300,000ms)', () => {
    let now = 0;
    const cache = new CandlesSWRCache({ now: () => now });
    cache.set('005930', 'D', CANDLES);

    now = 299_999;
    expect(cache.get('005930', 'D')?.isStale).toBe(false);

    now = 300_000;
    expect(cache.get('005930', 'D')?.isStale).toBe(true);
  });
});

describe('CandlesSWRCache — 날짜 범위 필터링', () => {
  it('from + to 지정 → 해당 범위만 반환', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);

    const result = cache.get('005930', 'D', '2025-01-02', '2025-01-02');
    expect(result?.candles).toHaveLength(1);
    expect(result?.candles[0]?.date).toBe('2025-01-02');
  });

  it('from 만 지정 → from 이상 전부', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);

    const result = cache.get('005930', 'D', '2025-01-02');
    expect(result?.candles).toHaveLength(2);
    expect(result?.candles[0]?.date).toBe('2025-01-02');
  });

  it('범위 필터 후에도 isStale 은 유지된다', () => {
    let now = 0;
    const cache = new CandlesSWRCache({ ttlMs: 100, now: () => now });
    cache.set('005930', 'D', CANDLES);
    now = 200;

    const result = cache.get('005930', 'D', '2025-01-02', '2025-01-03');
    expect(result?.isStale).toBe(true);
    expect(result?.candles).toHaveLength(2);
  });

  it('getInRange() — 날짜 범위 필터 작동', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);

    const result = cache.getInRange('005930', 'D', '2025-01-01', '2025-01-02');
    expect(result).toHaveLength(2);
    expect(result[0]?.date).toBe('2025-01-01');
    expect(result[1]?.date).toBe('2025-01-02');
  });

  it('getInRange() — 범위 외 → 빈 배열', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);

    const result = cache.getInRange('005930', 'D', '2025-02-01', '2025-02-28');
    expect(result).toEqual([]);
  });
});

describe('CandlesSWRCache — 무효화', () => {
  it('invalidate() 후 해당 버킷 get() → null', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);
    cache.invalidate('005930', 'D');
    expect(cache.get('005930', 'D')).toBeNull();
  });

  it('invalidate() 는 해당 (pdno, period) 버킷만 삭제', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);
    cache.set('005930', 'W', CANDLES);

    cache.invalidate('005930', 'D');

    expect(cache.get('005930', 'D')).toBeNull();
    expect(cache.get('005930', 'W')).not.toBeNull();
  });

  it('clear() 후 모든 버킷 삭제', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);
    cache.set('000660', 'W', CANDLES);
    cache.clear();

    expect(cache.get('005930', 'D')).toBeNull();
    expect(cache.get('000660', 'W')).toBeNull();
  });
});

describe('CandlesSWRCache — 버킷 키 독립성', () => {
  it('다른 pdno → 독립 버킷', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);
    expect(cache.get('000660', 'D')).toBeNull();
  });

  it('다른 period → 독립 버킷', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);
    expect(cache.get('005930', 'W')).toBeNull();
  });

  it('(pdno, period) 조합이 같으면 같은 버킷', () => {
    const cache = new CandlesSWRCache();
    cache.set('005930', 'D', CANDLES);
    cache.set('005930', 'W', CANDLES.slice(0, 1));

    expect(cache.get('005930', 'D')?.candles).toHaveLength(3);
    expect(cache.get('005930', 'W')?.candles).toHaveLength(1);
  });
});
