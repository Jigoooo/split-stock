import { describe, expect, it } from 'vitest';
import {
  applyLiveTicksToBalanceSnapshot,
  type BalanceWithLotsSnapshot,
} from './use-balance-with-lots';

const baseSnapshot: BalanceWithLotsSnapshot = {
  positions: [
    {
      code: '005930',
      name: '삼성전자',
      qty: 10,
      avgPrice: 70_000,
      currentPrice: 71_000,
      evalAmount: 710_000,
      pnlAmount: 10_000,
      pnlRate: 1.4285714285714286,
    },
  ],
  deposit: 1_000_000,
  d2Deposit: 1_000_000,
  totalBuyAmount: 700_000,
  totalEval: 710_000,
  totalPnlAmount: 10_000,
  totalPnlRate: 1.4285714285714286,
  estimatedAsset: 1_710_000,
  lotsByPdno: {},
  mismatches: [],
  syncStatus: 'IN_SYNC',
  strategiesByPdno: {},
};

describe('applyLiveTicksToBalanceSnapshot', () => {
  it('최신 tick 현재가로 잔고 행과 요약 평가손익을 재계산한다', () => {
    const next = applyLiveTicksToBalanceSnapshot(baseSnapshot, {
      '005930': { price: 72_000 },
    });

    expect(next?.positions[0]).toMatchObject({
      currentPrice: 72_000,
      evalAmount: 720_000,
      pnlAmount: 20_000,
    });
    expect(next?.totalEval).toBe(720_000);
    expect(next?.totalPnlAmount).toBe(20_000);
    expect(next?.estimatedAsset).toBe(1_720_000);
  });

  it('유효한 tick이 없으면 기존 snapshot 참조를 유지한다', () => {
    expect(applyLiveTicksToBalanceSnapshot(baseSnapshot, {})).toBe(baseSnapshot);
    expect(
      applyLiveTicksToBalanceSnapshot(baseSnapshot, {
        '005930': { price: 0 },
      }),
    ).toBe(baseSnapshot);
  });
});
