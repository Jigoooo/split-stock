import type { ReactElement } from 'react';
import type { FeeRates, ProfitAmountState } from '../model/profit-calculator-types';
import type { ProfitCalcResult } from '../model/use-profit-calc';
import { FeeInfo } from './fee-info';
import { profitCalculatorStyles as styles } from './profit-calculator-styles';

interface ProfitAmountFormProps extends FeeRates {
  input: ProfitAmountState;
  onInputChange: (input: ProfitAmountState) => void;
  result: ProfitCalcResult;
}

export const ProfitAmountForm = ({
  buyFeeRate,
  input,
  onInputChange,
  result,
  sellFeeRate,
  taxRate,
}: ProfitAmountFormProps): ReactElement => (
  <div style={styles.form}>
    <div style={styles.formGroup}>
      <label htmlFor="profit-buy-amount" style={styles.label}>
        매수금액 (원)
      </label>
      <input
        id="profit-buy-amount"
        type="number"
        value={input.buyAmount}
        onChange={(event) => onInputChange({ ...input, buyAmount: Number(event.target.value) })}
        style={styles.input}
      />
    </div>
    <div style={styles.formGroup}>
      <label htmlFor="profit-rate" style={styles.label}>
        수익률 (%)
      </label>
      <input
        id="profit-rate"
        type="number"
        step="0.01"
        value={input.profitRate}
        onChange={(event) => onInputChange({ ...input, profitRate: Number(event.target.value) })}
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
        <span style={styles.resultLabel}>결과액:</span>
        <span style={styles.resultValue}>
          {Math.round(result.resultAmount).toLocaleString()} 원
        </span>
      </div>
      <div style={styles.resultRow}>
        <span style={styles.resultLabel}>매수 수수료:</span>
        <span style={styles.resultValue}>{Math.round(result.buyFee).toLocaleString()} 원</span>
      </div>
      <div style={styles.resultRow}>
        <span style={styles.resultLabel}>실제 매수 금액:</span>
        <span style={styles.resultValue}>
          {Math.round(result.netBuyAmount).toLocaleString()} 원
        </span>
      </div>
    </div>
  </div>
);
