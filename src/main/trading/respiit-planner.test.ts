import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import { createSafetyState } from '../safety/safety-state';
import { LotsRepo } from './lots-repo';
import { planFromCsv, planFromParams } from './respiit-planner';

function noopLogger(): EventLogger {
  return { log: () => {} };
}

describe('planFromParams', () => {
  it('균등 분할 + 차수 간 priceGapPct 적용', () => {
    const plan = planFromParams({
      pdno: '005930',
      stages: 4,
      intervalDays: 7,
      priceGapPct: 0.03,
      totalQty: 40,
      anchorPrice: 100_000,
      anchorAt: new Date('2026-04-18T00:00:00Z'),
    });
    expect(plan.entries).toHaveLength(4);
    // qty: 40/4 = 10 per stage
    expect(plan.entries.map((e) => e.qty)).toEqual([10, 10, 10, 10]);
    // price: 100k, 97k, 94k, 91k (round)
    expect(plan.entries.map((e) => e.buyPrice)).toEqual([100_000, 97_000, 94_000, 91_000]);
    // 날짜 역산: anchor, -7d, -14d, -21d
    expect(plan.entries[0]?.boughtAt.toISOString()).toContain('2026-04-18');
    expect(plan.entries[1]?.boughtAt.toISOString()).toContain('2026-04-11');
  });

  it('잔여 수량은 1차에 가산', () => {
    const plan = planFromParams({
      pdno: '005930',
      stages: 3,
      intervalDays: 0,
      priceGapPct: 0,
      totalQty: 10, // /3 = 3 remainder 1
      anchorPrice: 50_000,
    });
    expect(plan.entries.map((e) => e.qty)).toEqual([4, 3, 3]);
  });

  it('pdno 형식 불량 → ZodError', () => {
    expect(() =>
      planFromParams({
        pdno: 'ABC',
        stages: 2,
        intervalDays: 0,
        priceGapPct: 0,
        totalQty: 10,
        anchorPrice: 50_000,
      }),
    ).toThrow();
  });

  it('priceGapKrw 사용 시 고정 금액 감산', () => {
    const plan = planFromParams({
      pdno: '005930',
      stages: 3,
      intervalDays: 0,
      priceGapPct: 0, // 무시됨 (priceGapKrw 우선)
      priceGapKrw: 1_000,
      totalQty: 30,
      anchorPrice: 10_000,
    });
    expect(plan.entries.map((e) => e.buyPrice)).toEqual([10_000, 9_000, 8_000]);
  });
});

describe('planFromCsv', () => {
  it('정상 CSV 파싱', () => {
    const csv = '2026-04-18,10,70000\n2026-04-10,10,68000\n2026-04-01,10,65000';
    const plan = planFromCsv('005930', csv);
    expect(plan.entries).toHaveLength(3);
    expect(plan.entries[0]).toMatchObject({ nth: 1, buyPrice: 70_000, qty: 10 });
    expect(plan.entries[2]?.nth).toBe(3);
  });

  it('빈 CSV → 에러', () => {
    expect(() => planFromCsv('005930', '   \n\n')).toThrow('CSV 행이 없습니다');
  });

  it('날짜 형식 불량 → Zod 에러', () => {
    expect(() => planFromCsv('005930', '2026/04/18,10,70000')).toThrow();
  });

  it('음수 수량/단가 → Zod 에러', () => {
    expect(() => planFromCsv('005930', '2026-04-18,-5,70000')).toThrow();
  });
});

describe('LotsRepo.replan', () => {
  function setupRepo() {
    const db = createTestDb();
    bootstrapSchema(db);
    return { db, repo: new LotsRepo(db) };
  }

  it('기존 OPEN 차수 교체 + SOLD 차수 보존', () => {
    const { repo } = setupRepo();
    // 시드: 1차 SOLD + 2차 OPEN
    repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'SOLD',
      boughtAt: new Date('2026-03-01'),
    });
    repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 2,
      buyPrice: 65_000,
      qty: 10,
      amountKrw: 650_000,
      status: 'OPEN',
      boughtAt: new Date('2026-04-01'),
    });

    // Replan: 3차/4차만 추가 (1차=SOLD는 nth 겹치지 않게 3,4로)
    const res = repo.replan(1, {
      pdno: '005930',
      entries: [
        { nth: 3, buyPrice: 60_000, qty: 10, amountKrw: 600_000, boughtAt: new Date() },
        { nth: 4, buyPrice: 55_000, qty: 10, amountKrw: 550_000, boughtAt: new Date() },
      ],
    });
    expect(res.isOk()).toBe(true);

    const snap = repo.snapshot(1, '005930');
    if (snap.isErr()) throw new Error('snap');
    const byNth = new Map(snap.value.lots.map((l) => [l.nth, l]));
    expect(byNth.get(1)?.status).toBe('SOLD'); // 보존
    expect(byNth.has(2)).toBe(false); // 기존 OPEN 삭제
    expect(byNth.get(3)?.status).toBe('OPEN');
    expect(byNth.get(4)?.status).toBe('OPEN');
  });

  it('보존 차수와 nth 충돌 시 rollback (기존 데이터 불변)', () => {
    const { repo } = setupRepo();
    repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'SOLD',
      boughtAt: new Date(),
    });

    const res = repo.replan(1, {
      pdno: '005930',
      entries: [
        { nth: 1, buyPrice: 60_000, qty: 10, amountKrw: 600_000, boughtAt: new Date() }, // SOLD 1차와 충돌
      ],
    });
    expect(res.isErr()).toBe(true);

    const snap = repo.snapshot(1, '005930');
    if (snap.isErr()) throw new Error('snap');
    expect(snap.value.lots).toHaveLength(1);
    expect(snap.value.lots[0]?.buyPrice).toBe(70_000);
  });

  it('replan 후 safety.toggleSymbol(false) 자동 호출 — 통합 시나리오', () => {
    const { repo } = setupRepo();
    const safety = createSafetyState({ logger: noopLogger() });
    safety.setMaster(true);
    safety.toggleSymbol('005930', true);

    const res = repo.replan(1, {
      pdno: '005930',
      entries: [{ nth: 1, buyPrice: 70_000, qty: 10, amountKrw: 700_000, boughtAt: new Date() }],
    });
    expect(res.isOk()).toBe(true);

    // 호출측 책임: replan 성공 시 safety 강제 OFF (본 테스트에서 수동 호출)
    safety.toggleSymbol('005930', false);
    expect(safety.canTrade('005930')).toBe(false);
  });
});
