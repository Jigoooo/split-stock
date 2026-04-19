import type { KisError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realTimer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';
import { type PricePoller, type QuoteSnapshot, RotatingQuoteFeed } from './tiered-quote-feed';

/**
 * vi.useFakeTimers() 가 global setTimeout/clearTimeout 을 패치하므로
 * realTimer 를 주입하면 FakeTimer 없이 fake clock 제어 가능.
 * advanceTimersByTimeAsync 는 사이에 pending 된 microtask(async fetch)를 drain.
 */

function noopLogger(): EventLogger {
  return { log: () => {} };
}

function makeOkPoller(prices: Record<string, number>): PricePoller {
  return {
    fetch: async (pdno) => ok({ price: prices[pdno] ?? 0 }),
  };
}

function makeErrPoller(error: KisError): PricePoller {
  return {
    fetch: async (): Promise<Result<{ price: number }, KisError>> => err(error),
  };
}

describe('RotatingQuoteFeed (회전 폴링 큐)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('5종목 등록 → 1초 안에 모든 종목 1회 폴링 (15rps)', async () => {
    const updates: QuoteSnapshot[] = [];
    const feed = new RotatingQuoteFeed({
      timer: realTimer,
      poller: makeOkPoller({ A: 100, B: 200, C: 300, D: 400, E: 500 }),
      logger: noopLogger(),
      ratePerSec: 15,
    });
    feed.on('quote', (q) => updates.push(q));

    feed.subscribe('A');
    feed.subscribe('B');
    feed.subscribe('C');
    feed.subscribe('D');
    feed.subscribe('E');

    // 5 * 67ms = 335ms. 여유 있게 1000ms 진행.
    await vi.advanceTimersByTimeAsync(1000);

    const emittedSymbols = new Set(updates.map((u) => u.pdno));
    expect(emittedSymbols.has('A')).toBe(true);
    expect(emittedSymbols.has('B')).toBe(true);
    expect(emittedSymbols.has('C')).toBe(true);
    expect(emittedSymbols.has('D')).toBe(true);
    expect(emittedSymbols.has('E')).toBe(true);
    expect(updates.find((u) => u.pdno === 'A')?.price).toBe(100);
    expect(updates.find((u) => u.pdno === 'E')?.price).toBe(500);

    feed.dispose();
  });

  it('30종목 등록 → 사이클 길이 ≈ 2초 (30/15 = 2)', async () => {
    const updates: QuoteSnapshot[] = [];
    const prices: Record<string, number> = {};
    const feed = new RotatingQuoteFeed({
      timer: realTimer,
      poller: {
        fetch: async (pdno) => ok({ price: prices[pdno] ?? 1 }),
      },
      logger: noopLogger(),
      ratePerSec: 15,
    });
    feed.on('quote', (q) => updates.push(q));

    for (let i = 0; i < 30; i += 1) {
      const code = String(i).padStart(6, '0');
      prices[code] = i + 1;
      feed.subscribe(code);
    }

    // 30 * 67ms = 2010ms. 안전 여유 200ms 추가 → 2200ms.
    await vi.advanceTimersByTimeAsync(2200);

    // 1사이클에 30종목 모두 emit 됐는지 확인.
    const emittedSymbols = new Set(updates.map((u) => u.pdno));
    expect(emittedSymbols.size).toBe(30);
    expect(updates.length).toBeGreaterThanOrEqual(30);

    feed.dispose();
  });

  it('unsubscribe 시 큐에서 제거 — 이후 사이클에서 emit 안 됨', async () => {
    const updates: QuoteSnapshot[] = [];
    const feed = new RotatingQuoteFeed({
      timer: realTimer,
      poller: makeOkPoller({ A: 1, B: 2, C: 3 }),
      logger: noopLogger(),
      ratePerSec: 15,
    });
    feed.on('quote', (q) => updates.push(q));

    feed.subscribe('A');
    feed.subscribe('B');
    feed.subscribe('C');

    // 1사이클 통과 (3 * 67 = 201ms → 500ms 면 충분)
    await vi.advanceTimersByTimeAsync(500);
    expect(updates.length).toBeGreaterThanOrEqual(3);

    feed.unsubscribe('B');
    expect(feed.getActiveSymbols().sort()).toEqual(['A', 'C']);

    // unsubscribe 직후 업데이트 카운트 기록
    const countBeforeAdditional = updates.length;

    // 추가 사이클 진행
    await vi.advanceTimersByTimeAsync(500);

    // 추가 진행 구간에서 B emit 없어야 함
    const tail = updates.slice(countBeforeAdditional);
    expect(tail.some((u) => u.pdno === 'B')).toBe(false);
    expect(tail.some((u) => u.pdno === 'A')).toBe(true);
    expect(tail.some((u) => u.pdno === 'C')).toBe(true);

    feed.dispose();
  });

  it('5회 연속 실패 종목은 다음 사이클 skip + cooldown emit', async () => {
    const updates: QuoteSnapshot[] = [];
    const cooldowns: Array<{ pdno: string }> = [];
    const errPoller: PricePoller = {
      fetch: async (pdno) => {
        if (pdno === 'BAD') return err({ kind: 'NETWORK', msg: 'down' });
        return ok({ price: 999 });
      },
    };
    const feed = new RotatingQuoteFeed({
      timer: realTimer,
      poller: errPoller,
      logger: noopLogger(),
      ratePerSec: 15,
      maxConsecutiveFailures: 5,
      cooldownCycles: 1,
    });
    feed.on('quote', (q) => updates.push(q));
    feed.on('cooldown', (c) => cooldowns.push({ pdno: c.pdno }));

    feed.subscribe('GOOD');
    feed.subscribe('BAD');

    // 2종목 * 67ms = 134ms/사이클. 5사이클 = 670ms. 여유 1500ms.
    await vi.advanceTimersByTimeAsync(1500);

    // BAD 는 5번 실패 후 cooldown 진입.
    expect(cooldowns.length).toBeGreaterThanOrEqual(1);
    expect(cooldowns[0]?.pdno).toBe('BAD');
    // BAD 는 quote emit 없음.
    expect(updates.some((u) => u.pdno === 'BAD')).toBe(false);
    // GOOD 은 매 사이클 emit.
    expect(updates.filter((u) => u.pdno === 'GOOD').length).toBeGreaterThanOrEqual(5);

    feed.dispose();
  });

  it('errPoller — 5회 미만 실패는 다음 사이클에 재시도', async () => {
    let attempts = 0;
    const flakyPoller: PricePoller = {
      fetch: async () => {
        attempts += 1;
        if (attempts <= 2) return err({ kind: 'NETWORK', msg: 'transient' });
        return ok({ price: 42 });
      },
    };
    const updates: QuoteSnapshot[] = [];
    const feed = new RotatingQuoteFeed({
      timer: realTimer,
      poller: flakyPoller,
      logger: noopLogger(),
      ratePerSec: 15,
      maxConsecutiveFailures: 5,
    });
    feed.on('quote', (q) => updates.push(q));
    feed.subscribe('FLAKY');

    await vi.advanceTimersByTimeAsync(1000);

    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(updates.some((u) => u.pdno === 'FLAKY' && u.price === 42)).toBe(true);

    feed.dispose();
  });

  it('dispose 후 subscribe 무시 + quote 더 이상 emit 안 됨', async () => {
    const updates: QuoteSnapshot[] = [];
    const feed = new RotatingQuoteFeed({
      timer: realTimer,
      poller: makeOkPoller({ A: 1 }),
      logger: noopLogger(),
      ratePerSec: 15,
    });
    feed.on('quote', (q) => updates.push(q));
    feed.subscribe('A');
    await vi.advanceTimersByTimeAsync(200);

    feed.dispose();
    const before = updates.length;

    feed.subscribe('B');
    await vi.advanceTimersByTimeAsync(500);

    expect(updates.length).toBe(before);
    expect(feed.getActiveSymbols()).toEqual([]);
  });

  it('에러 poller 만 있을 때도 사이클이 멈추지 않음', async () => {
    const feed = new RotatingQuoteFeed({
      timer: realTimer,
      poller: makeErrPoller({ kind: 'NETWORK', msg: 'always down' }),
      logger: noopLogger(),
      ratePerSec: 15,
    });
    feed.subscribe('X');
    feed.subscribe('Y');

    await vi.advanceTimersByTimeAsync(1500);

    expect(feed.getCyclesStarted()).toBeGreaterThanOrEqual(1);
    feed.dispose();
  });
});
