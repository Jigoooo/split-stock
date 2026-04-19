import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb, type Db } from '../../db/client';
import { createRateGuardRepo } from '../../safety/rate-guard';
import { createTimeWindowRepo } from '../../safety/time-window';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { tradingWindowsRouter } from './trading-windows-router';

const createCaller = t.createCallerFactory(tradingWindowsRouter);

function setup(db: Db, activeAccountId: number | null): Context {
  return {
    db,
    activeAccountId,
    timeWindowRepo: createTimeWindowRepo(db),
    rateGuardRepo: createRateGuardRepo(db),
    setCurrentEnv: () => {},
    setActiveAccountId: () => {},
  } as unknown as Context;
}

describe('tradingWindows 라우터 — per-account 권한 검증', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    bootstrapSchema(db);
  });

  describe('list', () => {
    it('활성 계좌와 input.accountId 일치 → 정상 반환', async () => {
      const ctx = setup(db, 1);
      const caller = createCaller(ctx);
      const result = await caller.list({ accountId: 1 });
      expect(result.windows).toEqual([]);
    });

    it('활성 계좌와 input.accountId 불일치 → FORBIDDEN', async () => {
      const ctx = setup(db, 1);
      const caller = createCaller(ctx);
      await expect(caller.list({ accountId: 2 })).rejects.toThrow(TRPCError);
      await expect(caller.list({ accountId: 2 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('활성 계좌 없음 → PRECONDITION_FAILED', async () => {
      const ctx = setup(db, null);
      const caller = createCaller(ctx);
      await expect(caller.list({ accountId: 1 })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });
  });

  describe('upsert', () => {
    it('슬롯 저장 후 list에서 조회 가능', async () => {
      const ctx = setup(db, 1);
      const caller = createCaller(ctx);

      await caller.upsert({
        accountId: 1,
        side: 'BUY',
        slot: 1,
        enabled: true,
        startMinute: 540,
        endMinute: 930,
      });

      const { windows } = await caller.list({ accountId: 1 });
      expect(windows).toHaveLength(1);
      expect(windows[0]).toMatchObject({
        side: 'BUY',
        slot: 1,
        enabled: true,
        startMinute: 540,
        endMinute: 930,
      });
    });

    it('같은 슬롯 재저장 → 갱신 (upsert)', async () => {
      const ctx = setup(db, 1);
      const caller = createCaller(ctx);

      await caller.upsert({
        accountId: 1,
        side: 'BUY',
        slot: 1,
        enabled: true,
        startMinute: 540,
        endMinute: 930,
      });
      await caller.upsert({
        accountId: 1,
        side: 'BUY',
        slot: 1,
        enabled: false,
        startMinute: 600,
        endMinute: 960,
      });

      const { windows } = await caller.list({ accountId: 1 });
      expect(windows).toHaveLength(1);
      expect(windows[0]).toMatchObject({ enabled: false, startMinute: 600, endMinute: 960 });
    });

    it('다른 계좌 슬롯 저장 → FORBIDDEN', async () => {
      const ctx = setup(db, 1);
      const caller = createCaller(ctx);
      await expect(
        caller.upsert({
          accountId: 2,
          side: 'BUY',
          slot: 1,
          enabled: true,
          startMinute: 540,
          endMinute: 930,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('delete', () => {
    it('슬롯 삭제 후 list에서 사라짐', async () => {
      const ctx = setup(db, 1);
      const caller = createCaller(ctx);

      await caller.upsert({
        accountId: 1,
        side: 'BUY',
        slot: 2,
        enabled: true,
        startMinute: 540,
        endMinute: 930,
      });
      await caller.delete({ accountId: 1, side: 'BUY', slot: 2 });

      const { windows } = await caller.list({ accountId: 1 });
      expect(windows).toHaveLength(0);
    });

    it('다른 계좌 슬롯 삭제 → FORBIDDEN', async () => {
      const ctx = setup(db, 1);
      const caller = createCaller(ctx);
      await expect(caller.delete({ accountId: 2, side: 'BUY', slot: 1 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});
