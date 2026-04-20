import type { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb, type Db } from '../../db/client';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { symbolMemoRouter } from './symbol-memo-router';

const createCaller = t.createCallerFactory(symbolMemoRouter);

function setupCtx(currentEnv: 'MOCK' | 'PROD' | null = 'MOCK'): {
  db: Db;
  ctx: Context;
} {
  const db = createTestDb();
  bootstrapSchema(db);
  const ctx = {
    db,
    currentEnv,
    activeAccountId: 1,
    setCurrentEnv: () => {},
    setActiveAccountId: () => {},
  } as unknown as Context;
  return { db, ctx };
}

describe('symbol-memo-router', () => {
  describe('get/set 라운드트립', () => {
    let caller: ReturnType<typeof createCaller>;
    beforeEach(() => {
      const { ctx } = setupCtx('MOCK');
      caller = createCaller(ctx);
    });

    it('get: 미저장 → null', async () => {
      const r = await caller.get({ pdno: '005930' });
      expect(r).toBeNull();
    });

    it('set → get 라운드트립', async () => {
      const before = Date.now();
      const setRes = await caller.set({ pdno: '005930', content: '저점 매수 후보' });
      expect(setRes.ok).toBe(true);
      const after = Date.now();

      const getRes = await caller.get({ pdno: '005930' });
      expect(getRes).not.toBeNull();
      expect(getRes?.content).toBe('저점 매수 후보');
      expect(getRes?.updatedAt).toBeGreaterThanOrEqual(before);
      expect(getRes?.updatedAt).toBeLessThanOrEqual(after);
    });

    it('set 두 번 — 마지막 본문/타임스탬프로 덮어씀 (upsert)', async () => {
      await caller.set({ pdno: '005930', content: '첫 메모' });
      const first = await caller.get({ pdno: '005930' });
      expect(first?.content).toBe('첫 메모');

      // 시간 차이 보장
      await new Promise((r) => setTimeout(r, 5));
      await caller.set({ pdno: '005930', content: '수정된 메모' });
      const second = await caller.get({ pdno: '005930' });
      expect(second?.content).toBe('수정된 메모');
      expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
    });

    it('set: 빈 문자열 허용 (메모 클리어)', async () => {
      await caller.set({ pdno: '005930', content: '내용' });
      await caller.set({ pdno: '005930', content: '' });
      const r = await caller.get({ pdno: '005930' });
      expect(r?.content).toBe('');
    });

    it('서로 다른 pdno 는 격리', async () => {
      await caller.set({ pdno: '005930', content: '삼성 메모' });
      await caller.set({ pdno: '000660', content: 'SK 메모' });
      const a = await caller.get({ pdno: '005930' });
      const b = await caller.get({ pdno: '000660' });
      expect(a?.content).toBe('삼성 메모');
      expect(b?.content).toBe('SK 메모');
    });
  });

  describe('zod 검증', () => {
    let caller: ReturnType<typeof createCaller>;
    beforeEach(() => {
      const { ctx } = setupCtx('MOCK');
      caller = createCaller(ctx);
    });

    it('pdno 형식 위반 (5자리) → BAD_REQUEST', async () => {
      try {
        await caller.get({ pdno: '00593' });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('BAD_REQUEST');
      }
    });

    it('pdno 비숫자 → BAD_REQUEST', async () => {
      try {
        await caller.set({ pdno: 'ABCDEF', content: 'x' });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('BAD_REQUEST');
      }
    });

    it('content 10,000 자 초과 → BAD_REQUEST', async () => {
      try {
        await caller.set({ pdno: '005930', content: 'a'.repeat(10_001) });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('BAD_REQUEST');
      }
    });
  });

  describe('authedProcedure 가드', () => {
    it('currentEnv=null → UNAUTHORIZED', async () => {
      const { ctx } = setupCtx(null);
      const caller = createCaller(ctx);
      try {
        await caller.get({ pdno: '005930' });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('UNAUTHORIZED');
      }
    });

    it('currentEnv=null + set → UNAUTHORIZED', async () => {
      const { ctx } = setupCtx(null);
      const caller = createCaller(ctx);
      try {
        await caller.set({ pdno: '005930', content: 'x' });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('UNAUTHORIZED');
      }
    });
  });
});
