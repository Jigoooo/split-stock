import type { StrategyProfile, TradeExecutionEvent } from '@shared/contracts';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { FakeTimer } from '../testing/fake-timer';
import { BoosterService } from './booster-service';

function makeProfile(overrides?: Partial<StrategyProfile>): StrategyProfile {
  return {
    version: 2,
    maxStages: 3,
    buyRules: [
      { nth: 1, triggerDropPct: null, amountKrw: 1_000_000 },
      { nth: 2, triggerDropPct: 0.03, amountKrw: 1_000_000 },
      { nth: 3, triggerDropPct: 0.03, amountKrw: 1_000_000 },
    ],
    sellRules: [
      { nth: 1, targetProfitPct: 0.05 },
      { nth: 2, targetProfitPct: 0.05 },
      { nth: 3, targetProfitPct: 0.05 },
    ],
    autoBuyEnabled: true,
    autoBuyOrderType: 'LIMIT',
    autoSellEnabled: true,
    autoSellOrderType: 'LIMIT',
    profitBooster: { enabled: true, dropPct: 0.01, expiresAt: null },
    ...overrides,
  };
}

const baseEvent: TradeExecutionEvent = {
  accountId: 1,
  odno: 'O1',
  pdno: '005930',
  name: '삼성전자',
  side: 'SELL',
  status: 'FILLED',
  filledQty: 10,
  totalFilledQty: 10,
  remainingQty: 0,
  price: 70_000,
  occurredAt: 1,
  nth: 1,
};

interface ServiceDeps {
  lotsLots?: unknown[];
  profile?: StrategyProfile | null;
}

function makeService(deps: ServiceDeps = {}) {
  const realtime = { watch: vi.fn(), unwatch: vi.fn() };
  const busListeners = new Map<string, (tick: { price: number }) => void>();
  const bus = {
    subscribeTick: vi.fn((pdno: string, cb: (tick: { price: number }) => void) => {
      busListeners.set(pdno, cb);
      return () => busListeners.delete(pdno);
    }),
  };
  const logger = { log: vi.fn() };
  const lotsSnapshot = ok({ lots: deps.lotsLots ?? [] });
  const lotsRepo = { snapshot: vi.fn(() => lotsSnapshot) };
  const strategyRepo = {
    getActive: vi.fn(() => ok(deps.profile === undefined ? makeProfile() : deps.profile)),
  };

  const service = new BoosterService({
    timer: new FakeTimer(),
    bus: bus as never,
    getRealtime: () => realtime as never,
    db: {} as never,
    settingsRepo: {} as never,
    getBrokerForAccount: () => null,
    safetyRegistry: {} as never,
    pendingOrderWatcher: null,
    logger: logger as never,
    lotsRepo: lotsRepo as never,
    strategyRepo: strategyRepo as never,
  });

  return { service, realtime, bus, busListeners, logger, lotsRepo, strategyRepo };
}

describe('BoosterService.handleTradeExecution', () => {
  it('1차 SELL FILLED 전량 + 활성 cycle 없음 + booster.enabled 인 경우 task 등록', () => {
    const { service, realtime, bus } = makeService();
    service.handleTradeExecution(baseEvent);
    expect(service.has(1, '005930')).toBe(true);
    expect(realtime.watch).toHaveBeenCalledWith('005930', 'tick');
    expect(bus.subscribeTick).toHaveBeenCalledWith('005930', expect.any(Function));
  });

  it('side != SELL 또는 nth != 1 또는 status != FILLED 이면 무시', () => {
    const { service, realtime } = makeService();
    service.handleTradeExecution({ ...baseEvent, side: 'BUY' });
    service.handleTradeExecution({ ...baseEvent, nth: 2 });
    service.handleTradeExecution({ ...baseEvent, status: 'PARTIAL' });
    service.handleTradeExecution({ ...baseEvent, remainingQty: 5 });
    expect(realtime.watch).not.toHaveBeenCalled();
    expect(service.size()).toBe(0);
  });

  it('booster.enabled = false 면 등록하지 않는다', () => {
    const { service, realtime } = makeService({
      profile: makeProfile({
        profitBooster: { enabled: false, dropPct: 0.01, expiresAt: null },
      }),
    });
    service.handleTradeExecution(baseEvent);
    expect(realtime.watch).not.toHaveBeenCalled();
    expect(service.size()).toBe(0);
  });

  it('profile 자체가 null 이면 등록하지 않는다', () => {
    const { service, realtime } = makeService({ profile: null });
    service.handleTradeExecution(baseEvent);
    expect(realtime.watch).not.toHaveBeenCalled();
  });

  it('cancel 시 realtime.unwatch 호출 + bus 구독 해제', () => {
    const { service, realtime, busListeners } = makeService();
    service.handleTradeExecution(baseEvent);
    expect(busListeners.has('005930')).toBe(true);

    service.cancel(1, '005930');
    expect(realtime.unwatch).toHaveBeenCalledWith('005930', 'tick');
    expect(busListeners.has('005930')).toBe(false);
    expect(service.has(1, '005930')).toBe(false);
  });

  it('등록 후 buyRules[0].amountKrw 가 task.amountKrw 로 snapshot 된다', () => {
    const { service } = makeService({
      profile: makeProfile({
        buyRules: [
          { nth: 1, triggerDropPct: null, amountKrw: 2_500_000 },
          { nth: 2, triggerDropPct: 0.03, amountKrw: 1_000_000 },
          { nth: 3, triggerDropPct: 0.03, amountKrw: 1_000_000 },
        ],
      }),
    });
    service.handleTradeExecution(baseEvent);
    const [task] = service.list();
    expect(task?.amountKrw).toBe(2_500_000);
    expect(task?.lastFilledPrice).toBe(70_000);
    expect(task?.boosterPct).toBe(0.01);
  });
});
