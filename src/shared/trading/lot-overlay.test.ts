import { describe, expect, it } from 'vitest';
import { buildLotOverlay, type LotOverlaySnapshot } from './lot-overlay';

const lots: LotOverlaySnapshot[] = [
  { nth: 1, buyPrice: 70_000, qty: 10, status: 'OPEN' },
  { nth: 2, buyPrice: 67_800, qty: 10, status: 'OPEN' },
  { nth: 3, buyPrice: 65_000, qty: 10, status: 'SOLD' },
];

describe('buildLotOverlay', () => {
  it('OPEN 차수만 기본 (buy + sell-target = 2 × OPEN)', () => {
    const lines = buildLotOverlay(lots, { profitPctByNth: { 1: 0.05, 2: 0.05 } });
    expect(lines).toHaveLength(4);
  });

  it('익절선 = buyPrice * (1 + profitPct) 반올림', () => {
    const lines = buildLotOverlay(lots, { profitPctByNth: { 1: 0.05, 2: 0.05 } });
    const sell1 = lines.find((l) => l.kind === 'sell-target' && l.nth === 1);
    expect(sell1?.price).toBe(73_500);
    const sell2 = lines.find((l) => l.kind === 'sell-target' && l.nth === 2);
    expect(sell2?.price).toBe(71_190);
  });

  it('includeSold=true: SOLD buy 라인 포함 (청산 표시)', () => {
    const lines = buildLotOverlay(lots, {
      profitPctByNth: { 1: 0.05, 2: 0.05, 3: 0.05 },
      includeSold: true,
    });
    const soldBuy = lines.find((l) => l.nth === 3 && l.kind === 'buy');
    expect(soldBuy?.label).toContain('청산');
  });

  it('가격 오름차순 정렬', () => {
    const lines = buildLotOverlay(lots, { profitPctByNth: { 1: 0.05, 2: 0.05 } });
    const prices = lines.map((l) => l.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('매수 라벨과 가격은 정수 원으로 반올림한다', () => {
    const lines = buildLotOverlay([{ nth: 1, buyPrice: 6_746.666, qty: 6, status: 'OPEN' }], {
      profitPctByNth: { 1: 0.05 },
    });
    const buy = lines.find((line) => line.kind === 'buy');
    expect(buy).toMatchObject({
      price: 6747,
      label: '1차 매수 6,747',
    });
  });

  it('BUYING/SELLING 상태는 라인 미생성', () => {
    const lines = buildLotOverlay(
      [
        { nth: 1, buyPrice: 70_000, qty: 10, status: 'BUYING' },
        { nth: 2, buyPrice: 67_800, qty: 10, status: 'SELLING' },
      ],
      { profitPctByNth: { 1: 0.05, 2: 0.05 } },
    );
    expect(lines).toHaveLength(0);
  });

  it('빈 lots → 빈 배열', () => {
    expect(buildLotOverlay([], { profitPctByNth: {} })).toEqual([]);
  });
});
