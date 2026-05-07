import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderbookRestPoller } from './orderbook-rest-poller';
import { RealtimeService } from './realtime-service';

/* ------------------------------------------------------------------ */
/*  Hoisted mutable state — shared between vi.mock factory and tests   */
/*  vi.hoisted runs before module loading, so the closure works.      */
/* ------------------------------------------------------------------ */

const captured = vi.hoisted(() => ({
  onFallbackStart: undefined as (() => void) | undefined,
  onPhaseChange: undefined as ((phase: string) => void) | undefined,
}));

/* ------------------------------------------------------------------ */
/*  Mock KisWsClient                                                   */
/*                                                                     */
/*  RealtimeService.start() constructs KisWsClient internally.        */
/*  We intercept the constructor to capture onFallbackStart /          */
/*  onPhaseChange callbacks so tests can invoke them directly.        */
/* ------------------------------------------------------------------ */

vi.mock('../kis/ws-client', () => {
  // Fake timer — setInterval/setTimeout no-ops; used as realTimer fallback.
  const fakeTimer = {
    setTimeout: (_cb: () => void, _ms: number) => ({ clear: () => undefined }),
    setInterval: (_cb: () => void, _ms: number) => ({ clear: () => undefined }),
    now: (): number => 0,
  };

  // Plain class — vi.fn().mockImplementation() is not new-able inside vi.mock.
  class KisWsClient {
    constructor(opts: { onFallbackStart?: () => void; onPhaseChange?: (p: string) => void }) {
      captured.onFallbackStart = opts.onFallbackStart;
      captured.onPhaseChange = opts.onPhaseChange;
    }
    start(_key: string, _secret: string) {
      return Promise.resolve({ isErr: () => false });
    }
    stop() {}
    reconnectNow() {}
    subscribe(_key: unknown) {
      return { isErr: () => false };
    }
    unsubscribe(_key: unknown) {}
  }

  return { KisWsClient, realTimer: fakeTimer };
});

/* ------------------------------------------------------------------ */
/*  Fake helpers                                                        */
/* ------------------------------------------------------------------ */

function makeFakePoller(): OrderbookRestPoller {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  } as unknown as OrderbookRestPoller;
}

function makeFakeBus() {
  return {
    emitTick: vi.fn(),
    emitOrderbook: vi.fn(),
    subscribeTick: vi.fn(() => () => undefined),
    subscribeOrderbook: vi.fn(() => () => undefined),
    latestTick: vi.fn(() => null),
    latestOrderbook: vi.fn(() => null),
  };
}

function makeService(poller?: OrderbookRestPoller) {
  return new RealtimeService({
    env: 'PROD',
    http: {} as never,
    bus: makeFakeBus() as never,
    factory: (() => {
      throw new Error('factory not used in test');
    }) as never,
    logger: { log: vi.fn() } as never,
    maxSubscriptions: 20,
    // rebalanceDebounceMs=0 → synchronous rebalance path (no real timer needed)
    rebalanceDebounceMs: 0,
    ...(poller !== undefined && { orderbookPoller: poller }),
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('RealtimeService — orderbookPoller wiring', () => {
  let poller: OrderbookRestPoller;

  beforeEach(() => {
    // Reset captured callbacks before each test so tests are independent.
    captured.onFallbackStart = undefined;
    captured.onPhaseChange = undefined;
    poller = makeFakePoller();
  });

  /* ---------------------------------------------------------------- */
  /*  stop() → orderbookPoller.dispose()                              */
  /*  (does not require start() — dispose guard fires before client)  */
  /* ---------------------------------------------------------------- */

  describe('stop() → orderbookPoller.dispose()', () => {
    it('stop() 호출 시 orderbookPoller.dispose() 가 실행된다', () => {
      const svc = makeService(poller);
      svc.stop();
      expect(poller.dispose).toHaveBeenCalledOnce();
    });

    it('start() 없이 stop() 해도 오류 없이 dispose() 된다', () => {
      const svc = makeService(poller);
      expect(() => svc.stop()).not.toThrow();
      expect(poller.dispose).toHaveBeenCalledOnce();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  onFallbackStart → orderbookPoller.start()                       */
  /*  WS 단절(fallback 전환) 콜백 → 1Hz REST 폴링 시작               */
  /* ---------------------------------------------------------------- */

  describe('onFallbackStart → orderbookPoller.start()', () => {
    it('WS 단절 콜백 발화 시 orderbookPoller.start() 가 호출된다', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');

      // KisWsClient constructor captured the callback — invoke it to simulate WS drop
      expect(captured.onFallbackStart).toBeDefined();
      captured.onFallbackStart?.();

      expect(poller.start).toHaveBeenCalledOnce();
    });

    it('orderbookPoller 미주입 시 onFallbackStart 는 오류 없이 실행된다 (기존 BC)', async () => {
      const svc = makeService(/* poller omitted */);
      await svc.start('appKey', 'appSecret');

      // Should not throw even without a poller (optional chaining guard)
      expect(() => captured.onFallbackStart?.()).not.toThrow();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  onPhaseChange('open') → orderbookPoller.stop()                  */
  /*  WS 복구(open) → REST 폴링 중단                                  */
  /* ---------------------------------------------------------------- */

  describe('onPhaseChange("open") → orderbookPoller.stop()', () => {
    it('WS 복구(open phase) 시 orderbookPoller.stop() 이 호출된다', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');

      expect(captured.onPhaseChange).toBeDefined();
      captured.onPhaseChange?.('open');

      expect(poller.stop).toHaveBeenCalledOnce();
    });

    it('open 이 아닌 phase 에서는 orderbookPoller.stop() 이 호출되지 않는다', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');

      // Simulate non-recovery phase transitions
      captured.onPhaseChange?.('connecting');
      captured.onPhaseChange?.('closing');
      captured.onPhaseChange?.('closed');

      expect(poller.stop).not.toHaveBeenCalled();
    });

    it('orderbookPoller 미주입 시 onPhaseChange("open") 는 오류 없이 실행된다 (기존 BC)', async () => {
      const svc = makeService(/* poller omitted */);
      await svc.start('appKey', 'appSecret');

      // Should not throw even without a poller (optional chaining guard)
      expect(() => captured.onPhaseChange?.('open')).not.toThrow();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  getFocusedSymbol() — poller 에 의해 사용되는 lazy getter        */
  /* ---------------------------------------------------------------- */

  describe('getFocusedSymbol()', () => {
    it('focus 없으면 null 반환', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');
      expect(svc.getFocusedSymbol()).toBeNull();
    });

    it('focus(pdno) 호출 후 해당 pdno 반환', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');
      svc.focus('005930');
      expect(svc.getFocusedSymbol()).toBe('005930');
    });

    it('blur(pdno) 호출 후 null 반환', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');
      svc.focus('005930');
      svc.blur('005930');
      expect(svc.getFocusedSymbol()).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  D2c: 다중 단절/재연결 사이클                                     */
  /*  2회 이상 WS 단절→복구 사이클에서 poller start/stop 정확성 검증  */
  /* ---------------------------------------------------------------- */

  describe('D2c: 다중 단절/재연결 사이클', () => {
    it('2회 연속 단절/재연결 사이클에서 poller.start/stop 각 2회씩 호출된다', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');

      // 1차 단절 → REST 폴링 시작
      captured.onFallbackStart?.();
      expect(poller.start).toHaveBeenCalledTimes(1);

      // 1차 복구 → REST 폴링 중단
      captured.onPhaseChange?.('open');
      expect(poller.stop).toHaveBeenCalledTimes(1);

      // 2차 단절 → REST 폴링 재시작
      captured.onFallbackStart?.();
      expect(poller.start).toHaveBeenCalledTimes(2);

      // 2차 복구 → REST 폴링 재중단
      captured.onPhaseChange?.('open');
      expect(poller.stop).toHaveBeenCalledTimes(2);
    });

    it('단절 후 비open phase 전환에서는 poller.stop() 이 호출되지 않는다', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');

      // 단절 → 폴링 시작
      captured.onFallbackStart?.();
      expect(poller.start).toHaveBeenCalledTimes(1);

      // 재연결 중간 phase → stop 없음
      captured.onPhaseChange?.('reconnect-wait');
      captured.onPhaseChange?.('connecting');
      captured.onPhaseChange?.('reconnect-exhausted');
      expect(poller.stop).not.toHaveBeenCalled();

      // open phase → stop
      captured.onPhaseChange?.('open');
      expect(poller.stop).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  D3: WS 복구 seamless 전환                                        */
  /*  WS reconnect 성공 이벤트 → pool WS 복귀 → orderbookPoller.stop() */
  /*  순서 보장 — clearInterval 전에 WS 데이터 소스 활성화             */
  /* ---------------------------------------------------------------- */

  describe('D3: WS 복구 seamless 전환', () => {
    it('WS 복구 후 watch 종목이 WS 슬롯으로 복귀한다', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');
      svc.watch('005930', 'tick');

      // WS 단절 → pool 전체 REST 모드
      captured.onPhaseChange?.('reconnect-wait');
      expect(svc.getActiveSubscriptions()[0]?.isWS).toBe(false);

      // WS 복구 → pool WS 복귀 + REST 폴링 중단
      captured.onPhaseChange?.('open');

      const subs = svc.getActiveSubscriptions();
      expect(subs).toHaveLength(1);
      expect(subs[0]?.isWS).toBe(true);
      expect(poller.stop).toHaveBeenCalledOnce();
    });

    it('orderbookPoller.stop() 호출 시점에 이미 pool 이 WS 모드이다 (seamless 순서 보장)', async () => {
      // WS pool 이 WS 모드로 복귀된 후 REST 폴링이 중단되어야 한다.
      // 역순이면 data gap 발생 — stop() 시점에 pool 상태를 캡처해 순서를 검증.
      let poolIsWsAtStop: boolean | null = null;
      let capturedSvc: RealtimeService | null = null;

      const d3Poller: OrderbookRestPoller = {
        start: vi.fn(),
        stop: vi.fn(() => {
          if (capturedSvc) {
            const subs = capturedSvc.getActiveSubscriptions();
            poolIsWsAtStop = subs.length > 0 && (subs[0]?.isWS ?? false);
          }
        }),
        dispose: vi.fn(),
      } as unknown as OrderbookRestPoller;

      const svc = makeService(d3Poller);
      capturedSvc = svc;
      await svc.start('appKey', 'appSecret');
      svc.watch('005930', 'tick');

      // WS 단절
      captured.onPhaseChange?.('reconnect-wait');

      // WS 복구
      captured.onPhaseChange?.('open');

      // stop() 이 호출되었고, 그 시점에 pool 이 이미 WS 모드여야 함
      expect(d3Poller.stop).toHaveBeenCalledOnce();
      expect(poolIsWsAtStop).toBe(true);
    });

    it('focus 종목 WS 복구 시 priority=100 WS 구독이 유지된다', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');
      svc.focus('005930'); // priority=100 등록

      // WS 단절
      captured.onPhaseChange?.('reconnect-wait');
      expect(svc.getActiveSubscriptions()[0]?.isWS).toBe(false);

      // WS 복구
      captured.onPhaseChange?.('open');
      const subs = svc.getActiveSubscriptions();
      expect(subs[0]?.isWS).toBe(true);
      expect(subs[0]?.priority).toBe(100);
      expect(poller.stop).toHaveBeenCalledOnce();
    });

    it('복수 종목 WS 복구 시 모두 WS 슬롯으로 복귀한다', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');
      svc.watch('005930', 'tick');
      svc.watch('035420', 'tick');
      svc.watch('000660', 'tick');

      // WS 단절
      captured.onPhaseChange?.('reconnect-wait');
      expect(svc.getActiveSubscriptions().every((s) => !s.isWS)).toBe(true);

      // WS 복구
      captured.onPhaseChange?.('open');
      expect(svc.getActiveSubscriptions().every((s) => s.isWS)).toBe(true);
      expect(poller.stop).toHaveBeenCalledOnce();
    });

    it('2회 단절/복구 사이클에서 매 복구마다 WS 슬롯 복귀 + poller.stop() 각 1회씩', async () => {
      const svc = makeService(poller);
      await svc.start('appKey', 'appSecret');
      svc.watch('005930', 'tick');

      // 1차 단절 → 복구
      captured.onPhaseChange?.('reconnect-wait');
      captured.onPhaseChange?.('open');
      expect(svc.getActiveSubscriptions()[0]?.isWS).toBe(true);
      expect(poller.stop).toHaveBeenCalledTimes(1);

      // 2차 단절 → 복구
      captured.onPhaseChange?.('reconnect-wait');
      captured.onPhaseChange?.('open');
      expect(svc.getActiveSubscriptions()[0]?.isWS).toBe(true);
      expect(poller.stop).toHaveBeenCalledTimes(2);
    });
  });
});
