import { Checkbox, KpiStrip, NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { FeeRates, ProfitAmountState } from '../model/profit-calculator-types';
import type { ProfitCalcResult } from '../model/use-profit-calc';
import { FeeInfo } from './fee-info';
import {
  formatKrw,
  formatPercent,
  formatSignedKrw,
  profitKpiTone,
  profitToneClass,
} from './profit-calculator-styles';
import { QuickPresetRow } from './quick-preset-row';

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
}: ProfitAmountFormProps): ReactElement => {
  const expectedProfit = result.resultAmount - input.buyAmount;

  return (
    <div className="profit-calculator__layout">
      <section className="profit-calculator__panel" aria-label="목표 수익률 입력">
        <div className="profit-calculator__section-header">
          <div>
            <div className="profit-calculator__section-title">목표 수익률 입력</div>
            <div className="profit-calculator__section-desc">
              매수금액과 목표 수익률로 예상 매도 결과를 계산합니다.
            </div>
          </div>
        </div>

        <div className="profit-calculator__field-grid">
          <label className="profit-calculator__field" htmlFor="profit-buy-amount">
            <span className="profit-calculator__label">매수금액</span>
            <NumberInput
              id="profit-buy-amount"
              dense
              showSpinner
              step={1000}
              value={String(input.buyAmount)}
              onValueChange={(raw) => onInputChange({ ...input, buyAmount: Number(raw || '0') })}
            />
          </label>
          <label className="profit-calculator__field" htmlFor="profit-rate">
            <span className="profit-calculator__label">목표 수익률</span>
            <NumberInput
              id="profit-rate"
              dense
              showSpinner
              allowDecimal
              allowNegative
              step={0.1}
              value={String(input.profitRate)}
              onValueChange={(raw) => onInputChange({ ...input, profitRate: Number(raw || '0') })}
            />
          </label>
        </div>

        <div className="profit-calculator__preset-stack">
          <QuickPresetRow
            label="매수금액 프리셋"
            options={[
              { label: '100만', value: 1_000_000 },
              { label: '300만', value: 3_000_000 },
              { label: '500만', value: 5_000_000 },
              { label: '1,000만', value: 10_000_000 },
            ]}
            onSelect={(buyAmount) => onInputChange({ ...input, buyAmount })}
          />
          <QuickPresetRow
            label="수익률 프리셋"
            options={[
              { label: '-3%', value: -3 },
              { label: '3%', value: 3 },
              { label: '5%', value: 5 },
              { label: '10%', value: 10 },
            ]}
            onSelect={(profitRate) => onInputChange({ ...input, profitRate })}
          />
        </div>

        <Checkbox
          dense
          checked={input.includeFees}
          onChange={(event) => onInputChange({ ...input, includeFees: event.target.checked })}
          label="수수료 및 세금 포함"
          description="결과액에서 매도 수수료와 매도 차익 세금을 차감합니다."
        />
      </section>

      <section
        className="profit-calculator__panel profit-calculator__result-panel"
        aria-live="polite"
      >
        <div className={`profit-calculator__hero-result ${profitToneClass(expectedProfit)}`}>
          <span className="profit-calculator__hero-label">예상 결과액</span>
          <strong className="profit-calculator__hero-value num">
            {formatKrw(result.resultAmount)}
          </strong>
          <span className="profit-calculator__hero-meta">
            예상 손익 {formatSignedKrw(expectedProfit)} · {formatPercent(input.profitRate)}
          </span>
        </div>

        <KpiStrip
          dense
          ariaLabel="목표 수익률 계산 결과"
          items={[
            {
              label: '매수금액',
              value: formatKrw(input.buyAmount),
            },
            {
              label: '매수 수수료',
              value: formatKrw(result.buyFee),
              tone: input.includeFees ? 'muted' : 'default',
            },
            {
              label: '실제 매수 기준',
              value: formatKrw(result.netBuyAmount),
            },
            {
              label: '예상 손익',
              value: formatSignedKrw(expectedProfit),
              tone: profitKpiTone(expectedProfit),
            },
          ]}
        />

        <FeeInfo
          active={input.includeFees}
          buyFeeRate={buyFeeRate}
          sellFeeRate={sellFeeRate}
          taxRate={taxRate}
        />
      </section>
    </div>
  );
};
