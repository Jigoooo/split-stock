import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import { createSafetyState } from '../safety/safety-state';
import { LotsRepo } from './lots-repo';
import { applyRespiit } from './respiit-orchestrator';

function buildLogger(): EventLogger & { entries: Array<{ level: string; message: string }> } {
  const entries: Array<{ level: string; message: string }> = [];
  return {
    entries,
    log: (e) => entries.push({ level: e.level, message: e.message }),
  };
}

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const lots = new LotsRepo(db);
  const logger = buildLogger();
  const safety = createSafetyState({ logger });
  safety.setMaster(true);
  return { lots, safety, logger };
}

describe('applyRespiit', () => {
  it('성공 경로 — safety.toggleSymbol(false) + respiit.applied 로그', () => {
    const { lots, safety, logger } = setup();
    safety.toggleSymbol('005930', true);
    expect(safety.canTrade('005930')).toBe(true);

    const r = applyRespiit(
      { lots, safety, logger },
      {
        accountId: 1,
        plan: {
          pdno: '005930',
          entries: [
            { nth: 1, buyPrice: 70_000, qty: 10, amountKrw: 700_000, boughtAt: new Date() },
            { nth: 2, buyPrice: 65_000, qty: 10, amountKrw: 650_000, boughtAt: new Date() },
          ],
        },
      },
    );
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.insertedIds).toHaveLength(2);

    // 자동 OFF
    expect(safety.canTrade('005930')).toBe(false);

    // 감사 로그
    expect(logger.entries.some((e) => e.message === 'respiit.applied' && e.level === 'WARN')).toBe(
      true,
    );
  });

  it('실패 경로 — respiit.failed 로그, safety 변경 없음', () => {
    const { lots, safety, logger } = setup();
    // 시드: 1차 SOLD → 동일 nth로 replan 시도 → 충돌
    lots.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'SOLD',
      boughtAt: new Date(),
    });
    safety.toggleSymbol('005930', true);

    const r = applyRespiit(
      { lots, safety, logger },
      {
        accountId: 1,
        plan: {
          pdno: '005930',
          entries: [
            { nth: 1, buyPrice: 60_000, qty: 10, amountKrw: 600_000, boughtAt: new Date() },
          ],
        },
      },
    );
    expect(r.isErr()).toBe(true);
    expect(logger.entries.some((e) => e.message === 'respiit.failed')).toBe(true);
    // 실패 시 safety 유지
    expect(safety.canTrade('005930')).toBe(true);
  });
});
