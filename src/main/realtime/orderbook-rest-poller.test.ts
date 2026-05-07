import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timer } from '../kis/ws-client';
import type { OrderbookUpdate } from '../kis/ws-frame-parser';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from './feed-bus';
import { OrderbookRestPoller } from './orderbook-rest-poller';

/* ------------------------------------------------------------------ */
/*  Fake helpers                                                         */
/* ------------------------------------------------------------------ */

function makeFakeTimer(): Timer & {
  tickInterval(): void;
  pendingIntervals: number;
} {
  let intervalCb: (() => void) | null = null;
  let intervalCleared = false;

  const timer: Timer & { tickInterval(): void; pendingIntervals: number } = {
    get pendingIntervals() {
      return intervalCb !== null && !intervalCleared ? 1 : 0;
    },
    tickInterval() {
      if (intervalCb && !intervalCleared) intervalCb();
    },
    setInterval(cb: () => void, _ms: number) {
      intervalCleared = false;
      intervalCb = cb;
      return {
        clear() {
          intervalCleared = true;
          intervalCb = null;
        },
      };
    },
    setTimeout(_cb: () => void, _ms: number) {
      return { clear() {} };
    },
    now: () => Date.now(),
  };
  return timer;
}

function makeFakeBus(): FeedBus & { emitted: OrderbookUpdate[] } {
  const emitted: OrderbookUpdate[] = [];
  return {
    emitted,
    emitOrderbook(u: OrderbookUpdate) {
      emitted.push(u);
    },
    emitTick: vi.fn(),
    subscribeTick: vi.fn(() => () => undefined),
    subscribeOrderbook: vi.fn(() => () => undefined),
    latestOrderbook: vi.fn(() => null),
    latestTick: vi.fn(() => null),
  } as unknown as FeedBus & { emitted: OrderbookUpdate[] };
}

function makeFakeLogger(): EventLogger {
  return {
    log: vi.fn(),
  } as unknown as EventLogger;
}

function makeOrderbookUpdate(pdno = '005930'): OrderbookUpdate {
  return {
    pdno,
    time: '093000',
    asks: [{ price: 70000, quantity: 100 }],
    bids: [{ price: 69900, quantity: 200 }],
    totalAskQty: 100,
    totalBidQty: 200,
    expectedPrice: 70000,
    expectedQty: 50,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('OrderbookRestPoller', () => {
  let timer: ReturnType<typeof makeFakeTimer>;
  let bus: ReturnType<typeof makeFakeBus>;
  let logger: EventLogger;
  let fetchOrderbook: ReturnType<typeof vi.fn>;
  let getFocusedSymbol: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    timer = makeFakeTimer();
    bus = makeFakeBus();
    logger = makeFakeLogger();
    fetchOrderbook = vi.fn().mockResolvedValue(makeOrderbookUpdate());
    getFocusedSymbol = vi.fn().mockReturnValue('005930');
  });

  function makePoller(
    overrides: Partial<ConstructorParameters<typeof OrderbookRestPoller>[0]> = {},
  ) {
    return new OrderbookRestPoller({
      fetchOrderbook: fetchOrderbook as (pdno: string) => Promise<OrderbookUpdate | null>,
      bus,
      getFocusedSymbol: getFocusedSymbol as () => string | null,
      timer,
      logger,
      intervalMs: 1000,
      ...overrides,
    });
  }

  describe('start()', () => {
    it('fallback:start 이후 즉시 한 번 emit 되어야 한다', async () => {
      const poller = makePoller();
      poller.start();
      // immediate fetch is async — flush microtasks
      await vi.waitUntil(() => bus.emitted.length > 0, { timeout: 100 });
      expect(bus.emitted).toHaveLength(1);
      expect(bus.emitted[0]?.pdno).toBe('005930');
    });

    it('setInterval 이 등록된다', () => {
      const poller = makePoller();
      poller.start();
      expect(timer.pendingIntervals).toBe(1);
    });

    it('interval tick 마다 emit 이 추가된다', async () => {
      const poller = makePoller();
      poller.start();
      await vi.waitUntil(() => bus.emitted.length > 0, { timeout: 100 });

      timer.tickInterval();
      await vi.waitUntil(() => bus.emitted.length > 1, { timeout: 100 });
      expect(bus.emitted.length).toBeGreaterThanOrEqual(2);
    });

    it('getFocusedSymbol 이 null 이면 immediate emit 을 건너뛴다', async () => {
      getFocusedSymbol.mockReturnValue(null);
      const poller = makePoller();
      poller.start();
      // Wait a bit to make sure nothing fires
      await new Promise((r) => setTimeout(r, 30));
      expect(bus.emitted).toHaveLength(0);
    });

    it('이미 running 중 start() 재호출 시 interval 이 중복 등록되지 않는다', () => {
      const poller = makePoller();
      poller.start();
      poller.start();
      // should still be just 1 pending interval (second start is no-op)
      expect(timer.pendingIntervals).toBe(1);
    });
  });

  describe('stop()', () => {
    it('stop() 후 interval 이 해제된다', () => {
      const poller = makePoller();
      poller.start();
      poller.stop();
      expect(timer.pendingIntervals).toBe(0);
    });

    it('stop() 후 tickInterval 에서 emit 이 발생하지 않는다', async () => {
      const poller = makePoller();
      poller.start();
      await vi.waitUntil(() => bus.emitted.length > 0, { timeout: 100 });
      const countAfterStart = bus.emitted.length;

      poller.stop();
      timer.tickInterval(); // already cleared — no-op
      await new Promise((r) => setTimeout(r, 30));
      expect(bus.emitted.length).toBe(countAfterStart);
    });

    it('stop() 를 여러 번 호출해도 오류 없다 (idempotent)', () => {
      const poller = makePoller();
      poller.start();
      expect(() => {
        poller.stop();
        poller.stop();
        poller.stop();
      }).not.toThrow();
    });
  });

  describe('start/stop 사이클', () => {
    it('stop 후 재-start 시 정상 동작한다', async () => {
      const poller = makePoller();
      poller.start();
      await vi.waitUntil(() => bus.emitted.length > 0, { timeout: 100 });
      poller.stop();

      const countAfterStop = bus.emitted.length;
      poller.start();
      await vi.waitUntil(() => bus.emitted.length > countAfterStop, { timeout: 100 });
      expect(bus.emitted.length).toBeGreaterThan(countAfterStop);
    });
  });

  describe('dispose()', () => {
    it('dispose() 는 stop() 과 동일하게 interval 을 해제한다', () => {
      const poller = makePoller();
      poller.start();
      poller.dispose();
      expect(timer.pendingIntervals).toBe(0);
    });
  });

  describe('fetchOrderbook 오류 처리', () => {
    it('fetchOrderbook 이 null 을 반환하면 emit 없이 계속 돈다', async () => {
      fetchOrderbook.mockResolvedValue(null);
      const poller = makePoller();
      poller.start();
      await new Promise((r) => setTimeout(r, 30));
      // No crash, no emit
      expect(bus.emitted).toHaveLength(0);
      expect(timer.pendingIntervals).toBe(1);
    });

    it('fetchOrderbook 이 throw 해도 루프가 종료되지 않는다', async () => {
      fetchOrderbook.mockRejectedValueOnce(new Error('network error'));
      fetchOrderbook.mockResolvedValue(makeOrderbookUpdate());
      const poller = makePoller();
      poller.start();
      // First immediate call throws — loop survives
      await new Promise((r) => setTimeout(r, 30));
      expect(timer.pendingIntervals).toBe(1); // interval still running

      // Next tick should emit successfully
      timer.tickInterval();
      await vi.waitUntil(() => bus.emitted.length > 0, { timeout: 100 });
      expect(bus.emitted.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('interval tick 에서 focused symbol 이 바뀐 경우', () => {
    it('tick 당시 getFocusedSymbol 반환값으로 fetch 된다', async () => {
      const poller = makePoller();
      poller.start();
      await vi.waitUntil(() => bus.emitted.length > 0, { timeout: 100 });

      getFocusedSymbol.mockReturnValue('035420'); // 카카오 전환
      fetchOrderbook.mockResolvedValue(makeOrderbookUpdate('035420'));

      timer.tickInterval();
      await vi.waitUntil(() => bus.emitted.length > 1, { timeout: 100 });
      const last = bus.emitted[bus.emitted.length - 1];
      expect(last?.pdno).toBe('035420');
    });

    it('tick 당시 getFocusedSymbol 이 null 이면 emit 없이 건너뛴다', async () => {
      const poller = makePoller();
      poller.start();
      await vi.waitUntil(() => bus.emitted.length > 0, { timeout: 100 });

      getFocusedSymbol.mockReturnValue(null);
      const countBefore = bus.emitted.length;

      timer.tickInterval();
      await new Promise((r) => setTimeout(r, 30));
      expect(bus.emitted.length).toBe(countBefore);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  D2c: interval 핸들 누수 없음                                     */
  /*  N회 start/stop 사이클 후 cleared 되지 않은 interval 핸들 = 0    */
  /* ---------------------------------------------------------------- */

  describe('D2c: interval 핸들 누수 없음', () => {
    it('N회 start/stop 사이클에서 setInterval 은 N회 호출되고 모두 cleared 된다', () => {
      // 모든 interval 핸들의 생성·cleared 상태를 추적하는 커스텀 타이머
      const handles: Array<{ cleared: boolean }> = [];
      let latestIntervalCb: (() => void) | null = null;

      const trackingTimer: Timer & { tickInterval(): void; pendingIntervals: number } = {
        get pendingIntervals(): number {
          return handles.filter((h) => !h.cleared).length;
        },
        tickInterval(): void {
          if (latestIntervalCb) latestIntervalCb();
        },
        setInterval(cb: () => void, _ms: number): { clear: () => void } {
          const handle = { cleared: false };
          handles.push(handle);
          latestIntervalCb = cb;
          return {
            clear(): void {
              handle.cleared = true;
              latestIntervalCb = null;
            },
          };
        },
        setTimeout(_cb: () => void, _ms: number): { clear: () => void } {
          return { clear(): void {} };
        },
        now: (): number => Date.now(),
      };

      const poller = new OrderbookRestPoller({
        fetchOrderbook: vi.fn().mockResolvedValue(makeOrderbookUpdate()),
        bus,
        getFocusedSymbol: vi.fn().mockReturnValue('005930'),
        timer: trackingTimer,
        logger,
        intervalMs: 1000,
      });

      const CYCLES = 5;
      for (let i = 0; i < CYCLES; i++) {
        poller.start();
        poller.stop();
      }

      // 각 start() 마다 정확히 1회씩 setInterval 호출
      expect(handles).toHaveLength(CYCLES);
      // 모든 핸들이 cleared — 누수된 interval 없음
      expect(handles.every((h) => h.cleared)).toBe(true);
      expect(trackingTimer.pendingIntervals).toBe(0);
    });

    it('start 후 stop 전 pending interval 은 정확히 1개이다', () => {
      const poller = makePoller();
      expect(timer.pendingIntervals).toBe(0);
      poller.start();
      expect(timer.pendingIntervals).toBe(1);
      poller.stop();
      expect(timer.pendingIntervals).toBe(0);
    });
  });
});
