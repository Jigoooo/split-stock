import type { ReactElement } from 'react';
import type { FeeRates, ProfitRateState } from '../model/profit-calculator-types';
import type { ProfitRateResult } from '../model/use-profit-calc';
import { FeeInfo } from './fee-info';
import { profitCalculatorStyles as styles } from './profit-calculator-styles';

interface ProfitRateFormProps extends FeeRates {
  input: ProfitRateState;
  onInputChange: (input: ProfitRateState) => void;
  result: ProfitRateResult;
}

export const ProfitRateForm = ({
  buyFeeRate,
  input,
  onInputChange,
  result,
  sellFeeRate,
  taxRate,
}: ProfitRateFormProps): ReactElement => (
  <div style={styles.form}>
    <div style={styles.formGroup}>
      <label htmlFor="rate-buy-amount" style={styles.label}>
        매수금액 (원)
      </label>
      <input
        id="rate-buy-amount"
        type="number"
        value={input.buyAmount}
        onChange={(event) => onInputChange({ ...input, buyAmount: Number(event.target.value) })}
        style={styles.input}
      />
    </div>
    <div style={styles.formGroup}>
      <label htmlFor="rate-sell-amount" style={styles.label}>
        매도금액 (원)
      </label>
      <input
        id="rate-sell-amount"
        type="number"
        value={input.sellAmount}
        onChange={(event) => onInputChange({ ...input, sellAmount: Number(event.target.value) })}
        style={styles.input}
      />
    </div>
    <div style={styles.formGroup}>
      <label style={styles.label}>
        <input
          type="checkbox"
          checked={input.includeFees}
          onChange={(event) => onInputChange({ ...input, includeFees: event.target.checked })}
          style={styles.checkbox}
        />
        수수료 및 세금 포함
      </label>
    </div>
    {input.includeFees ? (
      <FeeInfo buyFeeRate={buyFeeRate} sellFeeRate={sellFeeRate} taxRate={taxRate} />
    ) : null}
    <div style={styles.results}>
      <div style={styles.resultRow}>
        <span style={styles.resultLabel}>수익률:</span>
        <span style={styles.resultValue}>{result.profitRate.toFixed(2)}%</span>
      </div>
      <div style={styles.resultRow}>
        <span style={styles.resultLabel}>수익:</span>
        <span style={styles.resultValue}>{Math.round(result.profit).toLocaleString()} 원</span>
      </div>
      {input.includeFees ? (
        <>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>매수 수수료:</span>
            <span style={styles.resultValue}>{Math.round(result.buyFee).toLocaleString()} 원</span>
          </div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>매도 수수료:</span>
            <span style={styles.resultValue}>{Math.round(result.sellFee).toLocaleString()} 원</span>
          </div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>세금:</span>
            <span style={styles.resultValue}>{Math.round(result.tax).toLocaleString()} 원</span>
          </div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>순수익:</span>
            <span style={styles.resultValue}>
              {Math.round(result.netProfit).toLocaleString()} 원
            </span>
          </div>
        </>
      ) : null}
    </div>
  </div>
);
