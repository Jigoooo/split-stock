import { describe, expect, it } from 'vitest';
import { getTickSize, isOnTick, roundToTick } from './price-tick';

describe('getTickSize — KRX 2023.01.25 호가단위', () => {
  it('2,000원 미만 → 1원', () => {
    expect(getTickSize(1)).toBe(1);
    expect(getTickSize(500)).toBe(1);
    expect(getTickSize(1_999)).toBe(1);
  });

  it('2,000원 ~ 5,000원 미만 → 5원', () => {
    expect(getTickSize(2_000)).toBe(5);
    expect(getTickSize(3_500)).toBe(5);
    expect(getTickSize(4_999)).toBe(5);
  });

  it('5,000원 ~ 20,000원 미만 → 10원', () => {
    expect(getTickSize(5_000)).toBe(10);
    expect(getTickSize(10_000)).toBe(10);
    expect(getTickSize(19_999)).toBe(10);
  });

  it('20,000원 ~ 50,000원 미만 → 50원', () => {
    expect(getTickSize(20_000)).toBe(50);
    expect(getTickSize(35_000)).toBe(50);
    expect(getTickSize(49_999)).toBe(50);
  });

  it('50,000원 ~ 200,000원 미만 → 100원', () => {
    expect(getTickSize(50_000)).toBe(100);
    expect(getTickSize(100_000)).toBe(100);
    expect(getTickSize(199_999)).toBe(100);
  });

  it('200,000원 ~ 500,000원 미만 → 500원', () => {
    expect(getTickSize(200_000)).toBe(500);
    expect(getTickSize(350_000)).toBe(500);
    expect(getTickSize(499_999)).toBe(500);
  });

  it('500,000원 이상 → 1,000원', () => {
    expect(getTickSize(500_000)).toBe(1_000);
    expect(getTickSize(1_000_000)).toBe(1_000);
  });
});

describe('isOnTick', () => {
  it('tick 단위에 맞으면 true', () => {
    expect(isOnTick(1_500)).toBe(true); // tick=1
    expect(isOnTick(5_000)).toBe(true); // tick=10
    expect(isOnTick(35_000)).toBe(true); // tick=50
    expect(isOnTick(100_000)).toBe(true); // tick=100
    expect(isOnTick(200_000)).toBe(true); // tick=500
    expect(isOnTick(500_000)).toBe(true); // tick=1,000
  });

  it('tick 단위에 맞지 않으면 false', () => {
    expect(isOnTick(5_005)).toBe(false); // tick=10
    expect(isOnTick(35_025)).toBe(false); // tick=50
    expect(isOnTick(100_050)).toBe(false); // tick=100
    expect(isOnTick(250_250)).toBe(false); // tick=500
    expect(isOnTick(500_500)).toBe(false); // tick=1,000
  });
});

describe('roundToTick', () => {
  it('이미 tick 에 맞으면 그대로', () => {
    expect(roundToTick(35_000, true)).toBe(35_000);
    expect(roundToTick(35_000, false)).toBe(35_000);
  });

  it('올림 (roundUp=true)', () => {
    // 35,025 → tick=50 → 35,050
    expect(roundToTick(35_025, true)).toBe(35_050);
    // 5,005 → tick=10 → 5,010
    expect(roundToTick(5_005, true)).toBe(5_010);
    // 100,050 → tick=100 → 100,100
    expect(roundToTick(100_050, true)).toBe(100_100);
  });

  it('내림 (roundUp=false)', () => {
    // 35,025 → tick=50 → 35,000
    expect(roundToTick(35_025, false)).toBe(35_000);
    // 5,005 → tick=10 → 5,000
    expect(roundToTick(5_005, false)).toBe(5_000);
    // 100,050 → tick=100 → 100,000
    expect(roundToTick(100_050, false)).toBe(100_000);
  });

  it('가격 0 이하 → 0 반환', () => {
    expect(roundToTick(0, true)).toBe(0);
    expect(roundToTick(-100, false)).toBe(0);
  });

  it('tick 경계 직후값', () => {
    // 2,003원 → tick=5 → ceil=2,005, floor=2,000
    expect(roundToTick(2_003, true)).toBe(2_005);
    expect(roundToTick(2_003, false)).toBe(2_000);
    // 20,025원 → tick=50 → ceil=20,050, floor=20,000
    expect(roundToTick(20_025, true)).toBe(20_050);
    expect(roundToTick(20_025, false)).toBe(20_000);
    // 200,250원 → tick=500 → ceil=200,500, floor=200,000
    expect(roundToTick(200_250, true)).toBe(200_500);
    expect(roundToTick(200_250, false)).toBe(200_000);
  });
});
