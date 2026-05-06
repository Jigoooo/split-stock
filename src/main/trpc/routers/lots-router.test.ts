import type { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb, type Db } from '../../db/client';
import { lots as lotsTable } from '../../db/schema';
import { seedDomesticAccounts } from '../../testing/seed-accounts';
import { LotsRepo } from '../../trading/lots-repo';
import { StockMasterRepo } from '../../trading/stock-master-repo';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { lotsRouter } from './lots-router';

const createCaller = t.createCallerFactory(lotsRouter);

interface SetupResult {
  db: Db;
  lotsRepo: LotsRepo;
  baseCtx: Omit<Context, 'currentEnv' | 'activeAccountId'>;
}

function setup(): SetupResult {
  const db = createTestDb();
  bootstrapSchema(db);
  seedDomesticAccounts(db);
  const master = new StockMasterRepo(db);
  master.upsertMany([
    { pdno: '005930', name: '삼성전자' },
    { pdno: '000660', name: 'SK하이닉스' },
  ]);
  const lotsRepo = new LotsRepo(db, master);
  const baseCtx = { db, lotsRepo, stockMasterRepo: master } as unknown as Omit<
    Context,
    'currentEnv' | 'activeAccountId'
  >;
  return { db, lotsRepo, baseCtx };
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

function seedLots(repo: LotsRepo): void {
  const sold = repo.insertLot({
    accountId: 1,
    pdno: '005930',
    nth: 1,
    buyPrice: 65000,
    qty: 12,
    amountKrw: 780_000,
    status: 'OPEN',
    boughtAt: new Date('2026-03-28T00:00:00Z'),
  });
  if (sold.isOk()) {
    repo.updateLotStatus({
      lotId: sold.value,
      status: 'SOLD',
      sellPrice: 70000,
      soldAt: new Date('2026-04-05T00:00:00Z'),
    });
  }
  repo.insertLot({
    accountId: 1,
    pdno: '000660',
    nth: 2,
    buyPrice: 180_000,
    qty: 5,
    amountKrw: 900_000,
    status: 'SELLING',
    boughtAt: new Date('2026-04-03T00:00:00Z'),
  });
}

describe('lots-router', () => {
  it('tradeHistory: 기간/검색 필터가 적용된 lot 목록 반환', async () => {
    const s = setup();
    seedLots(s.lotsRepo);
    const caller = createCaller(ctxFor(s.baseCtx, 1));

    const result = await caller.tradeHistory({
      accountId: 1,
      year: 2026,
      month: 4,
      day: 5,
      search: '삼성',
    });

    expect(result.lots).toHaveLength(1);
    expect(result.lots[0]).toMatchObject({
      pdno: '005930',
      name: '삼성전자',
      nth: 1,
      status: 'SOLD',
    });
  });

  it('tradeHistory: invalid month 입력은 BAD_REQUEST', async () => {
    const s = setup();
    const caller = createCaller(ctxFor(s.baseCtx, 1));

    await expect(
      caller.tradeHistory({
        accountId: 1,
        year: 2026,
        month: 13,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' } satisfies Partial<TRPCError>);
  });

  it("cyclesByPdno: broker='UPBIT' 명시 호출은 UPBIT lot 만 반환 (KIS row 무시)", async () => {
    const s = setup();
    // KIS lot 시드 (default)
    s.lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 10,
      amountKrw: 700_000,
      status: 'OPEN',
      boughtAt: new Date('2026-04-01T00:00:00Z'),
    });
    // UPBIT lot 시드 (raw drizzle — broker='UPBIT')
    s.db
      .insert(lotsTable)
      .values({
        broker: 'UPBIT',
        accountId: 1,
        pdno: 'KRW-BTC',
        nth: 1,
        buyPrice: 50_000_000,
        qty: 1,
        amountKrw: 50_000_000,
        status: 'OPEN',
        boughtAt: new Date('2026-04-01T00:00:00Z'),
      })
      .run();
    const caller = createCaller(ctxFor(s.baseCtx, 1));

    const upbitResult = await caller.cyclesByPdno({
      accountId: 1,
      broker: 'UPBIT',
      status: 'open',
    });
    expect(upbitResult.cycles).toHaveLength(1);
    expect(upbitResult.cycles[0]?.pdno).toBe('KRW-BTC');

    // broker 미전달 (default 'KIS') 은 KIS row 만
    const kisResult = await caller.cyclesByPdno({
      accountId: 1,
      status: 'open',
    });
    expect(kisResult.cycles).toHaveLength(1);
    expect(kisResult.cycles[0]?.pdno).toBe('005930');
  });

  it("cyclesByPdno: pdno regex — UPBIT 심볼 'KRW-BTC' 통과", async () => {
    const s = setup();
    const caller = createCaller(ctxFor(s.baseCtx, 1));

    // pdno 가 'KRW-BTC' 형식이어도 zod refine 통과 — 빈 결과 반환
    const result = await caller.cyclesByPdno({
      accountId: 1,
      broker: 'UPBIT',
      pdno: 'KRW-BTC',
      status: 'open',
    });
    expect(result.cycles).toEqual([]);
  });
});
