import { describe, expect, it } from 'vitest';
import {
  calculateProfitAmount,
  calculateProfitRate,
  type ProfitCalcInput,
  type ProfitRateInput,
} from './use-profit-calc';

describe('use-profit-calc', () => {
  describe('calculateProfitAmount', () => {
    it('수익률만 포함하여 계산 (수수료 미포함)', () => {
      const input: ProfitCalcInput = {
        buyAmount: 1000000,
        profitRate: 5,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: false,
      };
      const result = calculateProfitAmount(input);
      // 실제 매수 금액: 1000000 + (1000000 * 0.015% / 100) = 1000150
      // 수익률 적용: 1000150 * 1.05 = 1050157.5
      expect(result.resultAmount).toBeCloseTo(1050157.5, 0);
      expect(result.buyFee).toBeCloseTo(150, 0);
      expect(result.netBuyAmount).toBeCloseTo(1000150, 0);
    });

    it('수수료 및 세금 포함하여 계산', () => {
      const input: ProfitCalcInput = {
        buyAmount: 1000000,
        profitRate: 5,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: true,
      };
      const result = calculateProfitAmount(input);
      // 실제 매수: 1000150
      // 목표 매도: 1050157.5
      // 매도 수수료: 1050157.5 * 0.015 / 100 = 157.52
      // 세금: (1050157.5 - 1000150) * 0.225 / 100 = 1126.68
      // 최종: 1050157.5 - 157.52 - 1126.68 = 1048873.3
      expect(result.resultAmount).toBeLessThan(1050157.5);
      expect(result.buyFee).toBeCloseTo(150, 0);
      expect(result.netBuyAmount).toBeCloseTo(1000150, 0);
    });

    it('0 이하 금액 처리', () => {
      const input: ProfitCalcInput = {
        buyAmount: 0,
        profitRate: 5,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: false,
      };
      const result = calculateProfitAmount(input);
      expect(result.resultAmount).toBe(0);
      expect(result.buyFee).toBe(0);
      expect(result.netBuyAmount).toBe(0);
    });
  });

  describe('calculateProfitRate', () => {
    it('수익률만 계산 (수수료 미포함)', () => {
      const input: ProfitRateInput = {
        buyAmount: 1000000,
        sellAmount: 1050000,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: false,
      };
      const result = calculateProfitRate(input);
      // 매수 수수료는 항상 계산됨 (정보 제공 목적)
      // 매수 수수료: 1000000 * 0.015 / 100 = 150
      // 순수익: 1050000 - 1000000 = 50000 (수수료 미포함이므로 공제 안 함)
      // 수익률: 50000 / 1000000 * 100 = 5%
      expect(result.profitRate).toBeCloseTo(5, 1);
      expect(result.profit).toBe(50000);
      expect(result.buyFee).toBeCloseTo(150, 0);
      expect(result.sellFee).toBe(0);
      expect(result.tax).toBe(0);
      expect(result.netProfit).toBe(50000);
    });

    it('수수료 및 세금 포함하여 계산', () => {
      const input: ProfitRateInput = {
        buyAmount: 1000000,
        sellAmount: 1050000,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: true,
      };
      const result = calculateProfitRate(input);
      // 매수 수수료: 1000000 * 0.015 / 100 = 150
      // 실제 매수: 1000150
      // 그로스 수익: 1050000 - 1000150 = 49850
      // 매도 수수료: 1050000 * 0.015 / 100 = 157.5
      // 세금: 49850 * 0.225 / 100 = 112.16
      // 순수익: 49850 - 157.5 - 112.16 = 49580.34
      expect(result.profitRate).toBeLessThan(5);
      expect(result.profit).toBeCloseTo(49850, 0);
      expect(result.buyFee).toBeCloseTo(150, 0);
      expect(result.sellFee).toBeCloseTo(157.5, 0);
      expect(result.tax).toBeCloseTo(112.16, 0);
      expect(result.netProfit).toBeCloseTo(49580.34, 0);
    });

    it('손실 상황 (매도 < 매수) 처리', () => {
      const input: ProfitRateInput = {
        buyAmount: 1000000,
        sellAmount: 950000,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: true,
      };
      const result = calculateProfitRate(input);
      // 손실이므로 세금 0
      expect(result.profitRate).toBeLessThan(0);
      expect(result.profit).toBeLessThan(0);
      expect(result.tax).toBe(0);
      expect(result.netProfit).toBeLessThan(0);
    });

    it('0 이하 금액 처리', () => {
      const input: ProfitRateInput = {
        buyAmount: 0,
        sellAmount: 1000000,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: false,
      };
      const result = calculateProfitRate(input);
      expect(result.profitRate).toBe(0);
      expect(result.profit).toBe(0);
      expect(result.buyFee).toBe(0);
      expect(result.sellFee).toBe(0);
      expect(result.tax).toBe(0);
      expect(result.netProfit).toBe(0);
    });

    it('KIS 기본 수수료율로 계산', () => {
      const input: ProfitRateInput = {
        buyAmount: 1000000,
        sellAmount: 1050000,
        buyFeeRate: 0.015, // KIS 기본값
        sellFeeRate: 0.015, // KIS 기본값
        taxRate: 0.225, // KIS 기본 세금
        includeFees: true,
      };
      const result = calculateProfitRate(input);
      // 검증: 수익률이 합리적인 범위 내
      expect(result.profitRate).toBeGreaterThan(0);
      expect(result.profitRate).toBeLessThan(5);
    });
  });

  describe('엣지 케이스', () => {
    it('매우 작은 금액 처리', () => {
      const input: ProfitCalcInput = {
        buyAmount: 100,
        profitRate: 10,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: false,
      };
      const result = calculateProfitAmount(input);
      expect(result.resultAmount).toBeGreaterThan(0);
    });

    it('높은 수익률 계산', () => {
      const input: ProfitCalcInput = {
        buyAmount: 1000000,
        profitRate: 100,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: true,
      };
      const result = calculateProfitAmount(input);
      expect(result.resultAmount).toBeGreaterThan(1000000);
    });

    it('수수료 미포함 vs 포함 비교', () => {
      const baseInput: ProfitRateInput = {
        buyAmount: 1000000,
        sellAmount: 1050000,
        buyFeeRate: 0.015,
        sellFeeRate: 0.015,
        taxRate: 0.225,
        includeFees: false,
      };
      const resultNoFees = calculateProfitRate(baseInput);

      const withFees: ProfitRateInput = { ...baseInput, includeFees: true };
      const resultWithFees = calculateProfitRate(withFees);

      // 수수료 포함 시 수익률이 더 낮아야 함
      expect(resultWithFees.profitRate).toBeLessThan(resultNoFees.profitRate);
      // 순수익도 더 낮아야 함
      expect(resultWithFees.netProfit).toBeLessThan(resultNoFees.netProfit);
    });
  });
});
