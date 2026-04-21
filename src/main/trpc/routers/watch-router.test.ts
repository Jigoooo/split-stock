import type { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb, type Db } from '../../db/client';
import { SettingsRepo } from '../../db/settings-repo';
import { FakeTimer } from '../../testing/fake-timer';
import { PrebuyRepo } from '../../trading/prebuy-repo';
import { WatchEngine } from '../../trading/watch-engine';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { watchRouter } from './watch-router';

const createCaller = t.createCallerFactory(watchRouter);

interface SetupResult {
  db: Db;
  engine: WatchEngine;
  baseCtx: Omit<Context, 'currentEnv' | 'activeAccountId'>;
}

function setup(): SetupResult {
  const db = createTestDb();
  bootstrapSchema(db);
  const engine = new WatchEngine({ db, timer: new FakeTimer() });
  // 라우터 가드 테스트만 검증 — 미사용 의존성은 unsafe cast 로 채움.
  const baseCtx = {
    db,
    watchEngine: engine,
    settingsRepo: new SettingsRepo(db),
    prebuyRepo: new PrebuyRepo(db),
    logger: { log: () => {} },
  } as unknown as Omit<Context, 'currentEnv' | 'activeAccountId'>;
  return { db, engine, baseCtx };
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
        source: 'CUSTOM',
        side: 'BUY',
        targetPrice: 60_000,
        comparator: 'LTE',
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
          source: 'CUSTOM',
          side: 'BUY',
          targetPrice: 60_000,
          comparator: 'LTE',
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
          source: 'CUSTOM',
          side: 'BUY',
          targetPrice: 60_000,
          comparator: 'LTE',
          orderType: 'LIMIT',
          qtyOrAmountMode: 'QTY',
          qty: 10,
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' } satisfies Partial<TRPCError>);
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
});
