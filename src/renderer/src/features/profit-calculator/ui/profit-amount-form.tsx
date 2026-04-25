import { NumberInput } from '@renderer/shared/ui';
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
      <NumberInput
        id="profit-buy-amount"
        showSpinner
        step={1000}
        value={String(input.buyAmount)}
        onValueChange={(raw) => onInputChange({ ...input, buyAmount: Number(raw || '0') })}
        style={styles.input}
      />
    </div>
    <div style={styles.formGroup}>
      <label htmlFor="profit-rate" style={styles.label}>
        수익률 (%)
      </label>
      <NumberInput
        id="profit-rate"
        showSpinner
        allowDecimal
        allowNegative
        step={0.1}
        value={String(input.profitRate)}
        onValueChange={(raw) => onInputChange({ ...input, profitRate: Number(raw || '0') })}
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
