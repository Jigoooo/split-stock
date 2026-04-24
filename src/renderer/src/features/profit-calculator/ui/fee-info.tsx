import type { ReactElement } from 'react';
import type { FeeRates } from '../model/profit-calculator-types';
import { profitCalculatorStyles as styles } from './profit-calculator-styles';

export const FeeInfo = ({ buyFeeRate, sellFeeRate, taxRate }: FeeRates): ReactElement => (
  <div style={styles.feeInfo}>
    <div style={styles.feeRow}>
      <span>매수 수수료율:</span>
      <span>{buyFeeRate.toFixed(3)}%</span>
    </div>
    <div style={styles.feeRow}>
      <span>매도 수수료율:</span>
      <span>{sellFeeRate.toFixed(3)}%</span>
    </div>
    <div style={styles.feeRow}>
      <span>세금률:</span>
      <span>{taxRate.toFixed(3)}%</span>
    </div>
  </div>
);
