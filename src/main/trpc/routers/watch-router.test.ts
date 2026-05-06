import { BROKERS } from '@shared/contracts';
import type { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeBrokerAdapter } from '../../brokers/__tests__/fake-broker-adapter';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb, type Db } from '../../db/client';
import { accounts } from '../../db/schema';
import { SettingsRepo } from '../../db/settings-repo';
import { FakeTimer } from '../../testing/fake-timer';
import { type DailyCandle, DailyCandlesRepo } from '../../trading/daily-candles-repo';
import { PrebuyRepo } from '../../trading/prebuy-repo';
import { StrategyRepo } from '../../trading/strategy-repo';
import { WatchEngine } from '../../trading/watch-engine';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { watchRouter } from './watch-router';

const createCaller = t.createCallerFactory(watchRouter);

interface SetupResult {
  broker: FakeBrokerAdapter;
  candlesRepo: DailyCandlesRepo;
  db: Db;
  engine: WatchEngine;
  baseCtx: Omit<Context, 'currentEnv' | 'activeAccountId'>;
}

function setup(): SetupResult {
  const db = createTestDb();
  bootstrapSchema(db);
  // Phase 6 H1: upsertWatchOrder 가 accounts.broker 를 lookup → 테스트 fixture 도 KIS 계좌 사전 등록.
  for (const id of [1, 2, 7, 99]) {
    db.insert(accounts)
      .values({
        id,
        env: 'MOCK',
        broker: BROKERS.KIS,
        accountNo8: `${id}`.padStart(8, '0'),
        accountProdCd: '01',
        createdAt: new Date(),
      })
      .run();
  }
  const engine = new WatchEngine({ db, timer: new FakeTimer() });
  const logger = { log: () => {} };
  const settingsRepo = new SettingsRepo(db);
  const candlesRepo = new DailyCandlesRepo(db);
  const broker = new FakeBrokerAdapter({
    quoteBySymbol: {
      '005930': {
        symbol: '005930',
        price: 100_000,
        dayChange: -1_200,
        dayChangeRate: -1.19,
        accumVolume: 1_234_567,
        accumValue: 123_456_789_000,
        open: 101_500,
        high: 102_000,
        low: 99_200,
        upperLimit: 130_000,
        lowerLimit: 70_000,
        prevClose: 101_200,
      },
    },
  });
  // 라우터 가드 테스트만 검증 — 미사용 의존성은 unsafe cast 로 채움.
  const baseCtx = {
    brokerForAccount: () => broker,
    candlesRepo,
    db,
    watchEngine: engine,
    settingsRepo,
    prebuyRepo: new PrebuyRepo(db),
    strategyRepo: new StrategyRepo(settingsRepo, logger),
    logger,
  } as unknown as Omit<Context, 'currentEnv' | 'activeAccountId'>;
  return { broker, candlesRepo, db, engine, baseCtx };
}

function ctxFor(
  base: Omit<Context, 'currentEnv' | 'activeAccountId'>,
  activeAccountId: number | null,
): Context {
  return {
    ...base,
    currentEnv: 'MOCK',
    activeAccountId,
    setCurrentEnv: () => {},
    setActiveAccountId: () => {},
  } as unknown as Context;
}

function seedDailyCandles(
  repo: DailyCandlesRepo,
  pdno: string,
  candles: ReadonlyArray<DailyCandle>,
): void {
  repo.upsertMany(pdno, 'D', [...candles]);
}

function makeCandles(count: number, close = 100_000): DailyCandle[] {
  const today = toKstYmd(new Date());
  return Array.from({ length: count }, (_, i) => {
    const wave = i % 12;
    const base = close - 12_000 + wave * 1_000;
    return {
      date: shiftYmd(today, i - count + 1),
      open: base + 300,
      high: base + 2_500,
      low: base - 2_500,
      close: base,
      volume: 1_000_000 + wave * 10_000,
    };
  });
}

function makeStrongSupportCandles(): DailyCandle[] {
  const today = toKstYmd(new Date());
  const touchIndexes = new Set([20, 45, 70]);
  return Array.from({ length: 90 }, (_, i) => {
    const wave = Math.sin(i / 4);
    let close = 104_000 + Math.round(wave * 900);
    let high = close + 900;
    let low = close - 700;
    let volume = 900_000;
    if (touchIndexes.has(i)) {
      close = 98_000;
      high = 99_500;
      low = 97_000;
      volume = 1_600_000;
    }
    if (touchIndexes.has(i - 1) || touchIndexes.has(i - 2)) {
      high = Math.max(high, 108_000);
      close = Math.max(close, 105_000);
    }
    if (i >= 84) {
      close = 100_500;
      high = 101_500;
      low = 99_500;
    }
    return {
      date: shiftYmd(today, i - 90 + 1),
      open: close,
      high,
      low,
      close,
      volume,
    };
  });
}

function toKstYmd(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function shiftYmd(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return toKstYmd(d);
}

describe('watch-router 권한 검증', () => {
  let s: SetupResult;
  beforeEach(() => {
    s = setup();
  });

  describe('list', () => {
    it('활성 계좌 = A → A 의 row 만 반환', async () => {
      const a = s.engine.register({
        accountId: 1,
        pdno: '005930',
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 60_000,
        comparator: 'LTE',
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 10,
      });
      s.engine.register({
        accountId: 2,
        pdno: '000660',
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 30_000,
        comparator: 'LTE',
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 5,
      });
      if (a.isErr()) throw new Error('seed');

      const caller = createCaller(ctxFor(s.baseCtx, 1));
      const res = await caller.list({});
      expect(res.orders).toHaveLength(1);
      expect(res.orders[0]?.accountId).toBe(1);
    });

    it('명시한 accountId 가 활성 계좌와 다르면 FORBIDDEN', async () => {
      const caller = createCaller(ctxFor(s.baseCtx, 1));
      await expect(caller.list({ accountId: 2 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      } satisfies Partial<TRPCError>);
    });

    it('활성 계좌 null → PRECONDITION_FAILED', async () => {
      const caller = createCaller(ctxFor(s.baseCtx, null));
      await expect(caller.list({})).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      } satisfies Partial<TRPCError>);
    });
  });

  describe('cancel', () => {
    it('자신의 row 만 취소 가능', async () => {
      const r = s.engine.register({
        accountId: 1,
        pdno: '005930',
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 60_000,
        comparator: 'LTE',
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 10,
      });
      if (r.isErr()) throw new Error('seed');

      const caller = createCaller(ctxFor(s.baseCtx, 1));
      const res = await caller.cancel({ id: r.value.id });
      expect(res.ok).toBe(true);
    });

    it('다른 계좌 row 취소 시 NOT_FOUND (정보 누설 방지)', async () => {
      const other = s.engine.register({
        accountId: 2,
        pdno: '000660',
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 30_000,
        comparator: 'LTE',
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 5,
      });
      if (other.isErr()) throw new Error('seed');

      const caller = createCaller(ctxFor(s.baseCtx, 1));
      await expect(caller.cancel({ id: other.value.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      } satisfies Partial<TRPCError>);
    });

    it('활성 계좌 null → PRECONDITION_FAILED', async () => {
      const caller = createCaller(ctxFor(s.baseCtx, null));
      await expect(caller.cancel({ id: 1 })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      } satisfies Partial<TRPCError>);
    });
  });

  describe('create', () => {
    it('input.accountId === 활성 계좌 → 성공', async () => {
      const caller = createCaller(ctxFor(s.baseCtx, 1));
      const res = await caller.create({
        accountId: 1,
        pdno: '005930',
        targetPrice: 60_000,
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 10,
      });
      expect(res.order.accountId).toBe(1);
    });

    it('input.accountId !== 활성 계좌 → FORBIDDEN', async () => {
      const caller = createCaller(ctxFor(s.baseCtx, 1));
      await expect(
        caller.create({
          accountId: 2,
          pdno: '005930',
          targetPrice: 60_000,
          orderType: 'LIMIT',
          qtyOrAmountMode: 'QTY',
          qty: 10,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' } satisfies Partial<TRPCError>);
    });

    it('활성 계좌 null → PRECONDITION_FAILED', async () => {
      const caller = createCaller(ctxFor(s.baseCtx, null));
      await expect(
        caller.create({
          accountId: 1,
          pdno: '005930',
          targetPrice: 60_000,
          orderType: 'LIMIT',
          qtyOrAmountMode: 'QTY',
          qty: 10,
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' } satisfies Partial<TRPCError>);
    });

    it('legacy field(source/side/comparator) 포함 시 BAD_REQUEST', async () => {
      const caller = createCaller(ctxFor(s.baseCtx, 1));
      await expect(
        caller.create({
          accountId: 1,
          pdno: '005930',
          targetPrice: 60_000,
          orderType: 'LIMIT',
          qtyOrAmountMode: 'QTY',
          qty: 10,
          source: 'CUSTOM',
          side: 'BUY',
          comparator: 'LTE',
        } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' } satisfies Partial<TRPCError>);
    });
  });

  describe('getReservationBuyDraft', () => {
    it('현재가와 일봉 기반 후보를 tick 단위로 산출하고 기본 실행조건을 추천한다', async () => {
      seedDailyCandles(s.candlesRepo, '005930', makeCandles(80));
      const caller = createCaller(ctxFor(s.baseCtx, 1));

      const draft = await caller.getReservationBuyDraft({ accountId: 1, pdno: '005930' });

      expect(draft.quote).toMatchObject({ symbol: '005930', price: 100_000 });
      expect(draft.rangeContext.candleCount).toBeGreaterThanOrEqual(60);
      expect(draft.rangeContext.dataQuality).toBe('normal');
      expect(draft.priceCandidates.map((item) => item.id)).toContain('box-low');
      expect(draft.priceCandidates.map((item) => item.id)).toContain('pullback-2');
      expect(draft.priceCandidates.every((item) => item.price < 100_000)).toBe(true);
      expect(draft.priceCandidates.every((item) => item.price % 100 === 0)).toBe(true);
      expect(draft.recommended).toMatchObject({
        amountKrw: 1_000_000,
        orderType: 'LIMIT',
        qtyOrAmountMode: 'AMOUNT',
      });
      expect(draft.recommended.targetPrice).toEqual(expect.any(Number));
      expect(draft.recommended.targetPrice).toBeLessThan(100_000);
      expect(draft.sourceStatus.quote).toBe('used');
      expect(draft.sourceStatus.candles).toBe('cache');
    });

    it('강한 지지선이 현재가 아래 1~12% 구간이면 기본 추천가로 선택한다', async () => {
      seedDailyCandles(s.candlesRepo, '005930', makeStrongSupportCandles());
      const caller = createCaller(ctxFor(s.baseCtx, 1));

      const draft = await caller.getReservationBuyDraft({ accountId: 1, pdno: '005930' });

      const support = draft.priceCandidates.find((item) => item.id === 'nearest-support');
      expect(support).toMatchObject({
        id: 'nearest-support',
        price: 97_000,
      });
      expect(support?.strength).toBeGreaterThanOrEqual(65);
      expect(draft.recommended.priceCandidateId).toBe('nearest-support');
      expect(draft.recommended.targetPrice).toBe(97_000);
    });

    it('박스하단이 현재가 대비 과도하게 멀면 기본 추천에서 제외하고 근접 눌림가를 선택한다', async () => {
      seedDailyCandles(s.candlesRepo, '028050', makeCandles(100, 132_000));
      const broker = new FakeBrokerAdapter({
        quoteBySymbol: {
          '028050': {
            symbol: '028050',
            price: 278_000,
            dayChange: 1_500,
            dayChangeRate: 0.54,
            accumVolume: 400_000,
            accumValue: 110_000_000_000,
            open: 276_000,
            high: 281_000,
            low: 275_000,
            upperLimit: 361_000,
            lowerLimit: 195_000,
            prevClose: 276_500,
          },
        },
      });
      const caller = createCaller(
        ctxFor(
          {
            ...s.baseCtx,
            brokerForAccount: () => broker,
          },
          1,
        ),
      );

      const draft = await caller.getReservationBuyDraft({ accountId: 1, pdno: '028050' });

      const boxLow = draft.priceCandidates.find((item) => item.id === 'box-low');
      expect(boxLow?.distancePct).toBeLessThan(-20);
      expect(draft.recommended.priceCandidateId).toBe('pullback-2');
      expect(draft.recommended.targetPrice).toBe(272_000);
      expect(draft.warnings.some((warning) => warning.includes('20% 이상 멀어 근접 눌림가'))).toBe(
        true,
      );
    });

    it('일봉 30개 미만은 감시가 자동 추천을 비우고 데이터 부족 경고를 반환한다', async () => {
      seedDailyCandles(s.candlesRepo, '005930', makeCandles(12));
      const caller = createCaller(ctxFor(s.baseCtx, 1));

      const draft = await caller.getReservationBuyDraft({ accountId: 1, pdno: '005930' });

      expect(draft.rangeContext.dataQuality).toBe('blocked');
      expect(draft.priceCandidates).toEqual([]);
      expect(draft.recommended.targetPrice).toBeNull();
      expect(draft.warnings.some((warning) => warning.includes('일봉 30개 미만'))).toBe(true);
    });

    it('quote 실패는 전체 폼을 깨지 않고 sourceStatus 에만 반영한다', async () => {
      seedDailyCandles(s.candlesRepo, '000660', makeCandles(80, 150_000));
      const caller = createCaller(ctxFor(s.baseCtx, 1));

      const draft = await caller.getReservationBuyDraft({ accountId: 1, pdno: '000660' });

      expect(draft.quote).toBeNull();
      expect(draft.sourceStatus.quote).toBe('failed');
      expect(draft.rangeContext.candleCount).toBeGreaterThanOrEqual(60);
      expect(draft.recommended.amountKrw).toBe(1_000_000);
    });
  });

  describe('control', () => {
    it('getControlState: 기본 globalEnabled=true + watchingCount 반환', async () => {
      s.engine.register({
        accountId: 1,
        pdno: '005930',
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 60_000,
        comparator: 'LTE',
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 10,
      });
      const caller = createCaller(ctxFor(s.baseCtx, 1));
      const res = await caller.getControlState();
      expect(res.globalEnabled).toBe(true);
      expect(res.watchingCount).toBe(1);
      expect(res.pausedCount).toBe(0);
    });

    it('pause/resume: 상태가 WATCHING ↔ PAUSED 로 전이', async () => {
      const r = s.engine.register({
        accountId: 1,
        pdno: '005930',
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 60_000,
        comparator: 'LTE',
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 10,
      });
      if (r.isErr()) throw new Error('seed');

      const caller = createCaller(ctxFor(s.baseCtx, 1));
      await caller.pause({ id: r.value.id });
      expect(s.engine.list({ status: 'PAUSED' }).map((o) => o.id)).toEqual([r.value.id]);

      const resumed = await caller.resume({ id: r.value.id });
      expect(resumed.order.status).toBe('WATCHING');
    });
  });

  describe('update', () => {
    it('예약매수 필드만 수정 가능', async () => {
      const r = s.engine.register({
        accountId: 1,
        pdno: '005930',
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 60_000,
        comparator: 'LTE',
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 10,
      });
      if (r.isErr()) throw new Error('seed');

      const caller = createCaller(ctxFor(s.baseCtx, 1));
      const res = await caller.update({
        id: r.value.id,
        pdno: '005930',
        targetPrice: 59_000,
        orderType: 'MARKET',
        qtyOrAmountMode: 'AMOUNT',
        amountKrw: 1_000_000,
      });
      expect(res.order.side).toBe('BUY');
      expect(res.order.comparator).toBe('LTE');
      expect(res.order.targetPrice).toBe(59_000);
      expect(res.order.orderType).toBe('MARKET');
    });

    it('immutable legacy 필드 변경 시 BAD_REQUEST', async () => {
      const r = s.engine.register({
        accountId: 1,
        pdno: '005930',
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 60_000,
        comparator: 'LTE',
        orderType: 'LIMIT',
        qtyOrAmountMode: 'QTY',
        qty: 10,
      });
      if (r.isErr()) throw new Error('seed');

      const caller = createCaller(ctxFor(s.baseCtx, 1));
      await expect(
        caller.update({
          id: r.value.id,
          pdno: '005930',
          targetPrice: 59_000,
          orderType: 'LIMIT',
          qtyOrAmountMode: 'QTY',
          qty: 10,
          side: 'SELL',
        } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' } satisfies Partial<TRPCError>);
    });
  });
});
