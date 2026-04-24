import { useGetFeeSettings } from '@renderer/entities/fee-settings';
import { type ReactElement, useState } from 'react';
import type {
  ProfitAmountState,
  ProfitCalculatorTab,
  ProfitRateState,
} from '../model/profit-calculator-types';
import {
  calculateProfitAmount,
  calculateProfitRate,
  type ProfitCalcInput,
  type ProfitRateInput,
} from '../model/use-profit-calc';
import { ProfitAmountForm } from './profit-amount-form';
import { profitCalculatorStyles as styles } from './profit-calculator-styles';
import { ProfitCalculatorTabs } from './profit-calculator-tabs';
import { ProfitRateForm } from './profit-rate-form';

export const ProfitCalculatorPage = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<ProfitCalculatorTab>('profit');
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [profitInput, setProfitInput] = useState<ProfitAmountState>({
    buyAmount: 1_000_000,
    profitRate: 5,
    includeFees: false,
  });
  const [rateInput, setRateInput] = useState<ProfitRateState>({
    buyAmount: 1_000_000,
    sellAmount: 1_050_000,
    includeFees: false,
  });

  const { data: feeSettings } = useGetFeeSettings('real');
  const buyFeeRate = feeSettings?.buy ?? 0.015;
  const sellFeeRate = feeSettings?.sell ?? 0.015;
  const taxRate = feeSettings?.tax ?? 0.225;
  const feeRates = { buyFeeRate, sellFeeRate, taxRate };

  const profitCalcInput: ProfitCalcInput = {
    buyAmount: profitInput.buyAmount,
    profitRate: profitInput.profitRate,
    includeFees: profitInput.includeFees,
    ...feeRates,
  };
  const rateCalcInput: ProfitRateInput = {
    buyAmount: rateInput.buyAmount,
    sellAmount: rateInput.sellAmount,
    includeFees: rateInput.includeFees,
    ...feeRates,
  };

  const handleAlwaysOnTop = async (value: boolean): Promise<void> => {
    setAlwaysOnTop(value);
    if (window.appShell?.setAlwaysOnTop) {
      await window.appShell.setAlwaysOnTop(value);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <label style={styles.alwaysOnTopLabel}>
          <input
            type="checkbox"
            checked={alwaysOnTop}
            onChange={(event) => handleAlwaysOnTop(event.target.checked)}
            style={styles.checkbox}
          />
          창 항상 위로
        </label>
      </div>
      <ProfitCalculatorTabs activeTab={activeTab} onChange={setActiveTab} />
      <div style={styles.content}>
        {activeTab === 'profit' ? (
          <ProfitAmountForm
            input={profitInput}
            onInputChange={setProfitInput}
            result={calculateProfitAmount(profitCalcInput)}
            {...feeRates}
          />
        ) : (
          <ProfitRateForm
            input={rateInput}
            onInputChange={setRateInput}
            result={calculateProfitRate(rateCalcInput)}
            {...feeRates}
          />
        )}
      </div>
    </div>
  );
};
