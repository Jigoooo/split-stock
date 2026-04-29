import { useGetFeeSettings } from '@renderer/entities/fee-settings';
import { Checkbox, PageHeader } from '@renderer/shared/ui';
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
import { formatKrw, formatPercent, profitToneClass } from './profit-calculator-styles';
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
  const profitResult = calculateProfitAmount(profitCalcInput);
  const rateResult = calculateProfitRate(rateCalcInput);
  const activeDelta =
    activeTab === 'profit'
      ? profitResult.resultAmount - profitInput.buyAmount
      : rateResult.netProfit;
  const activeMeta =
    activeTab === 'profit'
      ? `${formatKrw(profitInput.buyAmount)} 기준 ${formatPercent(profitInput.profitRate)}`
      : `${formatKrw(rateInput.buyAmount)} -> ${formatKrw(rateInput.sellAmount)}`;

  const handleAlwaysOnTop = async (value: boolean): Promise<void> => {
    setAlwaysOnTop(value);
    if (window.appShell?.setAlwaysOnTop) {
      await window.appShell.setAlwaysOnTop(value);
    }
  };

  return (
    <div className="profit-calculator-page">
      <PageHeader
        title="수익률 계산기"
        description="목표 수익률과 매도금액 기준을 빠르게 전환해 예상 결과를 비교합니다."
        dense
        meta={
          <span className={`profit-calculator__summary-chip ${profitToneClass(activeDelta)}`}>
            {activeMeta}
          </span>
        }
        actions={
          <Checkbox
            dense
            checked={alwaysOnTop}
            onChange={(event) => {
              void handleAlwaysOnTop(event.target.checked);
            }}
            label="항상 위"
          />
        }
      />
      <ProfitCalculatorTabs activeTab={activeTab} onChange={setActiveTab} />
      <div className="profit-calculator__content">
        {activeTab === 'profit' ? (
          <ProfitAmountForm
            input={profitInput}
            onInputChange={setProfitInput}
            result={profitResult}
            {...feeRates}
          />
        ) : (
          <ProfitRateForm
            input={rateInput}
            onInputChange={setRateInput}
            result={rateResult}
            {...feeRates}
          />
        )}
      </div>
    </div>
  );
};
