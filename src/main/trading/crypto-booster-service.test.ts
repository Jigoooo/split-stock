import type {
  CryptoLot,
  CryptoPrivateOrderEvent,
  CryptoStrategyProfile,
} from '@shared/contracts';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { FakeTimer } from '../testing/fake-timer';
import { type CryptoBoosterAdapter, CryptoBoosterService } from './crypto-booster-service';

function makeProfile(overrides?: Partial<CryptoStrategyProfile>): CryptoStrategyProfile {
  return {
    version: 1,
    market: 'KRW-BTC',
    maxStages: 3,
    buyRules: [
      { nth: 1, triggerDropPct: null, amountKrw: '5000' },
      { nth: 2, triggerDropPct: '0.03', amountKrw: '5000' },
      { nth: 3, triggerDropPct: '0.03', amountKrw: '5000' },
    ],
    sellRules: [
      { nth: 1, targetProfitPct: '0.02' },
      { nth: 2, targetProfitPct: '0.02' },
      { nth: 3, targetProfitPct: '0.02' },
    ],
    autoBuyEnabled: true,
    autoBuyOrderType: 'MARKET',
    autoSellEnabled: true,
    autoSellOrderType: 'MARKET',
    profitBooster: { enabled: true, dropPct: '0.01', expiresAt: null },
    ...overrides,
  };
}

const baseFillEvent: CryptoPrivateOrderEvent = {
  exchange: 'UPBIT',
  accountId: 1,
  market: 'KRW-BTC',
  uuid: 'order-uuid-1',
  side: 'ask',
  ordType: 'market',
  state: 'done',
  price: '0',
  volume: '0.001',
  remainingVolume: '0',
  executedVolume: '0.001',
  paidFee: '0',
  locked: '0',
  executedFunds: '70000',
  orderTimestamp: 1_700_000_000_000,
  timestamp: 1_700_000_000_000,
};

interface ServiceDeps {
  lots?: CryptoLot[];
  profile?: CryptoStrategyProfile | null;
  adapter?: { createOrder: ReturnType<typeof vi.fn> } | null;
}

function makeService(opts: ServiceDeps = {}) {
  const realtime = { watchMarket: vi.fn(), unwatchMarket: vi.fn() };
  const tickerListeners = new Map<string, (ticker: { tradePrice: string }) => void>();
  const bus = {
    subscribeTicker: vi.fn(
      (market: string, listener: (ticker: { tradePrice: string }) => void) => {
        tickerListeners.set(market, listener);
        return () => tickerListeners.delete(market);
      },
    ),
  };
  const logger = { log: vi.fn() };
  const repo = {
    listOpenLots: vi.fn(() => opts.lots ?? []),
    getStrategy: vi.fn(() => (opts.profile === undefined ? makeProfile() : opts.profile)),
    insertEvent: vi.fn(),
    markLiveAction: vi.fn(),
  };
  const createOrderMock = vi.fn(async () => ok({ uuid: 'placed-order-uuid' }));
  const adapter: CryptoBoosterAdapter & { createOrder: typeof createOrderMock } =
    opts.adapter === undefined
      ? { createOrder: createOrderMock }
      : (opts.adapter as never);

  type SafetySnapshot = {
    master: boolean;
    errorLock: { active: boolean; reason?: string | null };
  };
  type SafetyEntry = { canTrade: (symbol: string) => boolean; getSnapshot: () => SafetySnapshot };
  const safetyRegistry: { get: ReturnType<typeof vi.fn<(accountId: number) => SafetyEntry>> } = {
    get: vi.fn<(accountId: number) => SafetyEntry>(() => ({
      canTrade: () => true,
      getSnapshot: () => ({ master: true, errorLock: { active: false } }),
    })),
  };
  const protectionGuard = {
    canBuyToday: vi.fn(() => ok(undefined)),
  };
  const rateGuard = {
    recordBuy: vi.fn(),
    checkAndPossiblyDisableAuto: vi.fn(() => ({ switchedToManual: false })),
  };

  const timer = new FakeTimer();
  const service = new CryptoBoosterService({
    timer,
    bus,
    repo: repo as never,
    getRealtime: () => realtime,
    getAdapter: () => adapter,
    safetyRegistry,
    protectionGuard,
    rateGuard,
    logger: logger as never,
    now: () => timer.now(),
  });

  return {
    service,
    realtime,
    bus,
    tickerListeners,
    logger,
    repo,
    adapter,
    safetyRegistry,
    protectionGuard,
    rateGuard,
    timer,
  };
}

describe('CryptoBoosterService.handleCryptoFill', () => {
  it('1차 전량 매도(ask/done/remaining=0) + 활성 cycle 없음 + booster.enabled 일 때 task 등록', () => {
    const { service, realtime, bus } = makeService();
    service.handleCryptoFill(baseFillEvent);

    expect(service.has(1, 'KRW-BTC')).toBe(true);
    expect(realtime.watchMarket).toHaveBeenCalledWith({ market: 'KRW-BTC', candleUnit: '1m' });
    expect(bus.subscribeTicker).toHaveBeenCalledWith('KRW-BTC', expect.any(Function));
  });

  it('side != ask 또는 state != done 또는 remainingVolume != 0 이면 무시', () => {
    const { service, realtime } = makeService();
    service.handleCryptoFill({ ...baseFillEvent, side: 'bid' });
    service.handleCryptoFill({ ...baseFillEvent, state: 'wait' });
    service.handleCryptoFill({ ...baseFillEvent, remainingVolume: '0.0005' });
    expect(realtime.watchMarket).not.toHaveBeenCalled();
    expect(service.size()).toBe(0);
  });

  it('booster.enabled = false 면 등록하지 않는다', () => {
    const { service, realtime } = makeService({
      profile: makeProfile({
        profitBooster: { enabled: false, dropPct: '0.01', expiresAt: null },
      }),
    });
    service.handleCryptoFill(baseFillEvent);
    expect(realtime.watchMarket).not.toHaveBeenCalled();
    expect(service.size()).toBe(0);
  });

  it('profitBooster 자체가 undefined 인 strategy 면 등록하지 않는다', () => {
    const { service } = makeService({
      profile: makeProfile({ profitBooster: undefined }),
    });
    service.handleCryptoFill(baseFillEvent);
    expect(service.size()).toBe(0);
  });

  it('listOpenLots 가 비어있지 않으면 등록 거부 (idempotency)', () => {
    const { service } = makeService({
      lots: [
        {
          id: 1,
          accountId: 1,
          exchange: 'UPBIT',
          market: 'KRW-BTC',
          source: 'live',
          sequence: 1,
          quantity: '0.001',
          avgEntryKrw: '70000000',
          allocatedKrw: '70000',
          realizedPnl: '0',
          feesPaid: '0',
          status: 'open',
          openedAt: 0,
          closedAt: null,
          updatedAt: 0,
        },
      ],
    });
    service.handleCryptoFill(baseFillEvent);
    expect(service.size()).toBe(0);
  });

  it('cancel 시 unwatchMarket 호출 + ticker 구독 해제', () => {
    const { service, realtime, tickerListeners } = makeService();
    service.handleCryptoFill(baseFillEvent);
    expect(tickerListeners.has('KRW-BTC')).toBe(true);

    service.cancel(1, 'KRW-BTC');
    expect(realtime.unwatchMarket).toHaveBeenCalledWith({ market: 'KRW-BTC', candleUnit: '1m' });
    expect(tickerListeners.has('KRW-BTC')).toBe(false);
    expect(service.has(1, 'KRW-BTC')).toBe(false);
  });

  it('lastFilledPrice 는 executedFunds / executedVolume 로 계산 (market ask)', () => {
    const { service } = makeService();
    service.handleCryptoFill(baseFillEvent);
    const [task] = service.list();
    // funds 70000 / volume 0.001 = 70_000_000
    expect(task?.lastFilledPrice).toBeCloseTo(70_000_000);
  });

  it('expiresAt 만료 시 자동 cleanup', () => {
    const { service, timer, realtime, logger } = makeService({
      profile: makeProfile({
        profitBooster: { enabled: true, dropPct: '0.01', expiresAt: 100_000 },
      }),
    });
    service.handleCryptoFill(baseFillEvent);
    expect(service.size()).toBe(1);

    timer.advance(100_001);
    expect(service.size()).toBe(0);
    expect(realtime.unwatchMarket).toHaveBeenCalled();
    const expireLog = logger.log.mock.calls.find(
      (call) => call[0]?.message === 'crypto-booster.expired',
    );
    expect(expireLog).toBeDefined();
  });
});

describe('CryptoBoosterService trigger flow', () => {
  it('ticker price 가 임계값 (lastFilled * (1-dropPct)) 이하 도달 시 adapter.createOrder 호출', async () => {
    const { service, tickerListeners, adapter, repo, rateGuard } = makeService();
    service.handleCryptoFill(baseFillEvent);
    // lastFilledPrice = 70_000_000, boosterPct = 0.01 → threshold = 69_300_000
    const listener = tickerListeners.get('KRW-BTC');
    expect(listener).toBeDefined();
    listener?.({ tradePrice: '69_000_000'.replace(/_/g, '') });

    // 마이크로태스크 후 createOrder 호출 확인
    await new Promise((resolve) => setImmediate(resolve));
    expect(adapter?.createOrder).toHaveBeenCalledTimes(1);
    expect(repo.markLiveAction).toHaveBeenCalledWith(1, 'KRW-BTC', expect.any(Number));
    expect(rateGuard.recordBuy).toHaveBeenCalledWith(1, 'KRW-BTC', expect.any(Number));
    expect(service.size()).toBe(0); // 트리거 후 cleanup
  });

  it('safetyRegistry.master=false 면 트리거 시점에 createOrder 호출 안 함', async () => {
    const { service, tickerListeners, adapter, safetyRegistry } = makeService();
    service.handleCryptoFill(baseFillEvent);
    safetyRegistry.get.mockReturnValueOnce({
      canTrade: (): boolean => false,
      getSnapshot: () => ({ master: false, errorLock: { active: false } }),
    });

    tickerListeners.get('KRW-BTC')?.({ tradePrice: '69000000' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(adapter?.createOrder).not.toHaveBeenCalled();
  });

  it('protectionGuard.canBuyToday 가 err 면 createOrder 호출 안 함', async () => {
    const { service, tickerListeners, adapter, protectionGuard } = makeService();
    service.handleCryptoFill(baseFillEvent);
    protectionGuard.canBuyToday.mockReturnValueOnce(
      // neverthrow err로 표현 — kind 만 검사
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      { isErr: () => true, error: { kind: 'LIMIT_DAILY_TOTAL_COUNT', max: 5 } } as any,
    );

    tickerListeners.get('KRW-BTC')?.({ tradePrice: '69000000' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(adapter?.createOrder).not.toHaveBeenCalled();
  });

  it('트리거 시점에 lots 가 생긴 경우 (수동 1차 매수 등) 트리거 skip', async () => {
    const { service, tickerListeners, adapter, repo } = makeService();
    service.handleCryptoFill(baseFillEvent);
    // 임계값 도달 직전 사용자가 수동 매수 — listOpenLots 가 1개를 반환하도록 변경
    repo.listOpenLots.mockReturnValueOnce([
      {
        id: 99,
        accountId: 1,
        exchange: 'UPBIT',
        market: 'KRW-BTC',
        source: 'live',
        sequence: 1,
        quantity: '0.001',
        avgEntryKrw: '70000000',
        allocatedKrw: '70000',
        realizedPnl: '0',
        feesPaid: '0',
        status: 'open',
        openedAt: 0,
        closedAt: null,
        updatedAt: 0,
      },
    ] as never);

    tickerListeners.get('KRW-BTC')?.({ tradePrice: '69000000' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(adapter?.createOrder).not.toHaveBeenCalled();
  });
});
