import type { StrategyProfile } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateCatchUpForSymbol } from './catch-up-detector';

function makeProfile(maxStages: number, dropPct = 0.03): StrategyProfile {
  return {
    version: 2,
    maxStages,
    buyRules: Array.from({ length: maxStages }, (_, i) => ({
      nth: i + 1,
      triggerDropPct: i === 0 ? null : dropPct,
      amountKrw: 1_000_000,
    })),
    sellRules: Array.from({ length: maxStages }, (_, i) => ({
      nth: i + 1,
      targetProfitPct: 0.05,
    })),
    autoBuyEnabled: true,
    autoBuyOrderType: 'LIMIT',
    autoSellEnabled: true,
    autoSellOrderType: 'LIMIT',
  };
}

describe('evaluateCatchUpForSymbol', () => {
  it('1차 보유 + 가격 -3% 미달 → maxReachedNth null', () => {
    const profile = makeProfile(5);
    const item = evaluateCatchUpForSymbol(
      1,
      '005930',
      9_800,
      [{ nth: 1, buyPrice: 10_000 }],
      profile,
      '삼성전자',
    );
    expect(item).not.toBeNull();
    expect(item?.maxReachedNth).toBeNull();
    expect(item?.triggers[0]).toMatchObject({ nth: 2, triggerPrice: 9_700, reached: false });
  });

  it('1차 10000 보유 + 가격 9700 → 정확히 2차 도달', () => {
    const profile = makeProfile(5);
    const item = evaluateCatchUpForSymbol(
      1,
      '005930',
      9_700,
      [{ nth: 1, buyPrice: 10_000 }],
      profile,
      '삼성전자',
    );
    expect(item?.maxReachedNth).toBe(2);
  });

  it('1차 10000 + 가격 9000 → 2·3차 chain 도달 (3% drop chain)', () => {
    // 2차 trigger = 9700 (도달), 3차 trigger = 9700×0.97 = 9409 (도달), 4차 = 9409×0.97 = 9126 (도달), 5차 = 9126×0.97 = 8852 (미도달)
    const profile = makeProfile(5);
    const item = evaluateCatchUpForSymbol(
      1,
      '005930',
      9_000,
      [{ nth: 1, buyPrice: 10_000 }],
      profile,
      '삼성전자',
    );
    expect(item?.maxReachedNth).toBe(4);
    expect(item?.triggers).toHaveLength(4);
    expect(item?.triggers[3]).toMatchObject({ nth: 5, reached: false });
  });

  it('이미 2차 보유 중이면 top=2차 기준으로 chain (1차 무시)', () => {
    const profile = makeProfile(5);
    const item = evaluateCatchUpForSymbol(
      1,
      '005930',
      8_000,
      [
        { nth: 1, buyPrice: 10_000 },
        { nth: 2, buyPrice: 9_000 },
      ],
      profile,
      '삼성전자',
    );
    // top=2차 9000. 3차 trigger=8730. 가격 8000 ≤ 8730 → 도달
    // 4차 trigger=8468 → 도달. 5차=8214 → 도달
    expect(item?.maxReachedNth).toBe(5);
  });

  it('top.nth >= maxStages 면 null (다음 차수 없음)', () => {
    const profile = makeProfile(3);
    const item = evaluateCatchUpForSymbol(
      1,
      '005930',
      5_000,
      [
        { nth: 1, buyPrice: 10_000 },
        { nth: 2, buyPrice: 9_000 },
        { nth: 3, buyPrice: 8_000 },
      ],
      profile,
      '삼성전자',
    );
    expect(item).toBeNull();
  });

  it('activeLots 비어있으면 null', () => {
    const profile = makeProfile(5);
    const item = evaluateCatchUpForSymbol(1, '005930', 9_000, [], profile, '삼성전자');
    expect(item).toBeNull();
  });

  it('currentPrice 0 이하면 null (잘못된 가격)', () => {
    const profile = makeProfile(5);
    const item = evaluateCatchUpForSymbol(
      1,
      '005930',
      0,
      [{ nth: 1, buyPrice: 10_000 }],
      profile,
      '삼성전자',
    );
    expect(item).toBeNull();
  });

  it('chain 중간에 trigger 미도달이면 그 시점에서 중단', () => {
    const profile = makeProfile(5);
    // 1차 10000. 가격 9700 (2차 정확히 도달). 3차 trigger=9409 → 미도달. chain 중단.
    const item = evaluateCatchUpForSymbol(
      1,
      '005930',
      9_700,
      [{ nth: 1, buyPrice: 10_000 }],
      profile,
      '삼성전자',
    );
    expect(item?.triggers).toHaveLength(2);
    expect(item?.triggers[1]).toMatchObject({ nth: 3, reached: false });
    expect(item?.maxReachedNth).toBe(2);
  });

  it('lots 는 nth 오름차순으로 정렬되어 반환', () => {
    const profile = makeProfile(5);
    const item = evaluateCatchUpForSymbol(
      1,
      '005930',
      8_000,
      [
        { nth: 3, buyPrice: 8_000 },
        { nth: 1, buyPrice: 10_000 },
        { nth: 2, buyPrice: 9_000 },
      ],
      profile,
      '삼성전자',
    );
    expect(item?.lots.map((l) => l.nth)).toEqual([1, 2, 3]);
  });
});
