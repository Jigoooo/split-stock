import { describe, expect, it } from 'vitest';
import { applyFees } from './fees';

describe('applyFees', () => {
  const realFees = { buy: 0.015, sell: 0.015, tax: 0.2 };
  const mockFees = { buy: 0.35, sell: 0.35, tax: 0.2 };

  describe('매수 (buy)', () => {
    it('실 계좌 매수: 수수료 + 세금 적용', () => {
      const result = applyFees('real', 'buy', 1000, realFees);
      const expectedFee = 1000 * 0.015; // 15
      const expectedTax = 1000 * 0.2; // 200
      const expectedNet = 1000 - expectedFee - expectedTax; // 785

      expect(result.fee).toBe(expectedFee);
      expect(result.tax).toBe(expectedTax);
      expect(result.netAmount).toBe(expectedNet);
    });

    it('모의 계좌 매수: 수수료 + 세금 적용', () => {
      const result = applyFees('mock', 'buy', 1000, mockFees);
      const expectedFee = 1000 * 0.35; // 350
      const expectedTax = 1000 * 0.2; // 200
      const expectedNet = 1000 - expectedFee - expectedTax; // 450

      expect(result.fee).toBe(expectedFee);
      expect(result.tax).toBe(expectedTax);
      expect(result.netAmount).toBe(expectedNet);
    });

    it('매수 시 제세금 항상 적용됨', () => {
      const result = applyFees('real', 'buy', 10000, realFees);
      expect(result.tax).toBe(10000 * 0.2);
      expect(result.tax).not.toBe(0);
    });
  });

  describe('매도 (sell)', () => {
    it('실 계좌 매도: 수수료만 적용 (세금 미적용)', () => {
      const result = applyFees('real', 'sell', 1000, realFees);
      const expectedFee = 1000 * 0.015; // 15
      const expectedTax = 0; // 매도 시 세금 미적용
      const expectedNet = 1000 - expectedFee; // 985

      expect(result.fee).toBe(expectedFee);
      expect(result.tax).toBe(expectedTax);
      expect(result.netAmount).toBe(expectedNet);
    });

    it('모의 계좌 매도: 수수료만 적용 (세금 미적용)', () => {
      const result = applyFees('mock', 'sell', 1000, mockFees);
      const expectedFee = 1000 * 0.35; // 350
      const expectedTax = 0;
      const expectedNet = 1000 - expectedFee; // 650

      expect(result.fee).toBe(expectedFee);
      expect(result.tax).toBe(expectedTax);
      expect(result.netAmount).toBe(expectedNet);
    });

    it('매도 시 세금은 항상 0', () => {
      const result = applyFees('real', 'sell', 10000, realFees);
      expect(result.tax).toBe(0);
    });
  });

  describe('엣지 케이스', () => {
    it('금액 0일 때', () => {
      const result = applyFees('real', 'buy', 0, realFees);
      expect(result.fee).toBe(0);
      expect(result.tax).toBe(0);
      expect(result.netAmount).toBe(0);
    });

    it('소수점 계산', () => {
      const result = applyFees('real', 'buy', 100.5, realFees);
      const expectedFee = 100.5 * 0.015;
      const expectedTax = 100.5 * 0.2;
      const expectedNet = 100.5 - expectedFee - expectedTax;

      expect(result.fee).toBe(expectedFee);
      expect(result.tax).toBe(expectedTax);
      expect(result.netAmount).toBe(expectedNet);
    });
  });
});
