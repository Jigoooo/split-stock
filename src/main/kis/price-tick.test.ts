import { describe, expect, it } from 'vitest';
import { getTickSize, isOnTick, roundToTick } from './price-tick';

describe('getTickSize — KRX 2023 호가단위', () => {
  it('2,000원 미만 → 5원', () => {
    expect(getTickSize(1)).toBe(5);
    expect(getTickSize(500)).toBe(5);
    expect(getTickSize(1_999)).toBe(5);
  });

  it('2,000원 ~ 5,000원 미만 → 10원', () => {
    expect(getTickSize(2_000)).toBe(10);
    expect(getTickSize(3_500)).toBe(10);
    expect(getTickSize(4_999)).toBe(10);
  });

  it('5,000원 ~ 20,000원 미만 → 50원', () => {
    expect(getTickSize(5_000)).toBe(50);
    expect(getTickSize(10_000)).toBe(50);
    expect(getTickSize(19_999)).toBe(50);
  });

  it('20,000원 ~ 50,000원 미만 → 100원', () => {
    expect(getTickSize(20_000)).toBe(100);
    expect(getTickSize(35_000)).toBe(100);
    expect(getTickSize(49_999)).toBe(100);
  });

  it('50,000원 ~ 200,000원 미만 → 500원', () => {
    expect(getTickSize(50_000)).toBe(500);
    expect(getTickSize(100_000)).toBe(500);
    expect(getTickSize(199_999)).toBe(500);
  });

  it('200,000원 이상 → 1,000원', () => {
    expect(getTickSize(200_000)).toBe(1_000);
    expect(getTickSize(500_000)).toBe(1_000);
    expect(getTickSize(1_000_000)).toBe(1_000);
  });
});

describe('isOnTick', () => {
  it('tick 단위에 맞으면 true', () => {
    expect(isOnTick(5_000)).toBe(true); // 50원 단위
    expect(isOnTick(20_000)).toBe(true); // 100원 단위
    expect(isOnTick(50_000)).toBe(true); // 500원 단위
    expect(isOnTick(200_000)).toBe(true); // 1000원 단위
  });

  it('tick 단위에 맞지 않으면 false', () => {
    expect(isOnTick(5_025)).toBe(false); // 50원 단위가 아님
    expect(isOnTick(20_050)).toBe(false); // 100원 단위가 아님 (50원이지만 해당 구간 tick=100)
    expect(isOnTick(50_250)).toBe(false); // 500원 단위가 아님
  });
});

describe('roundToTick', () => {
  it('이미 tick 에 맞으면 그대로', () => {
    expect(roundToTick(35_000, true)).toBe(35_000);
    expect(roundToTick(35_000, false)).toBe(35_000);
  });

  it('올림 (roundUp=true)', () => {
    // 35,075 → tick=100 → 35,100
    expect(roundToTick(35_075, true)).toBe(35_100);
    // 5,025 → tick=50 → 5,050
    expect(roundToTick(5_025, true)).toBe(5_050);
    // 100,250 → tick=500 → 100,500
    expect(roundToTick(100_250, true)).toBe(100_500);
  });

  it('내림 (roundUp=false)', () => {
    // 35,075 → tick=100 → 35,000
    expect(roundToTick(35_075, false)).toBe(35_000);
    // 5,025 → tick=50 → 5,000
    expect(roundToTick(5_025, false)).toBe(5_000);
    // 100,250 → tick=500 → 100,000
    expect(roundToTick(100_250, false)).toBe(100_000);
  });

  it('가격 0 이하 → 0 반환', () => {
    expect(roundToTick(0, true)).toBe(0);
    expect(roundToTick(-100, false)).toBe(0);
  });

  it('tick 경계 직후값', () => {
    // 2,001원 → tick=10 → ceil=2,010, floor=2,000
    expect(roundToTick(2_001, true)).toBe(2_010);
    expect(roundToTick(2_001, false)).toBe(2_000);
    // 20,001원 → tick=100 → ceil=20,100, floor=20,000
    expect(roundToTick(20_001, true)).toBe(20_100);
    expect(roundToTick(20_001, false)).toBe(20_000);
  });
});
