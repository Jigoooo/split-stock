import { Checkbox, KpiStrip, NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { FeeRates, ProfitRateState } from '../model/profit-calculator-types';
import type { ProfitRateResult } from '../model/use-profit-calc';
import { FeeInfo } from './fee-info';
import {
  formatKrw,
  formatPercent,
  formatSignedKrw,
  profitKpiTone,
  profitToneClass,
} from './profit-calculator-styles';
import { QuickPresetRow } from './quick-preset-row';

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
}: ProfitRateFormProps): ReactElement => {
  const applyTargetRate = (rate: number): void => {
    const nextSellAmount = Math.round(input.buyAmount * (1 + rate / 100));
    onInputChange({ ...input, sellAmount: nextSellAmount });
  };

  return (
    <div className="profit-calculator__layout">
      <section className="profit-calculator__panel" aria-label="매도금액 기준 입력">
        <div className="profit-calculator__section-header">
          <div>
            <div className="profit-calculator__section-title">매도금액 기준 입력</div>
            <div className="profit-calculator__section-desc">
              실제 매도금액을 넣어 손익과 수익률을 역산합니다.
            </div>
          </div>
        </div>

        <div className="profit-calculator__field-grid">
          <label className="profit-calculator__field" htmlFor="rate-buy-amount">
            <span className="profit-calculator__label">매수금액</span>
            <NumberInput
              id="rate-buy-amount"
              dense
              showSpinner
              step={1000}
              value={String(input.buyAmount)}
              onValueChange={(raw) => onInputChange({ ...input, buyAmount: Number(raw || '0') })}
            />
          </label>
          <label className="profit-calculator__field" htmlFor="rate-sell-amount">
            <span className="profit-calculator__label">매도금액</span>
            <NumberInput
              id="rate-sell-amount"
              dense
              showSpinner
              step={1000}
              value={String(input.sellAmount)}
              onValueChange={(raw) => onInputChange({ ...input, sellAmount: Number(raw || '0') })}
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
            label="목표 매도금액"
            options={[
              { label: '-3%', value: -3 },
              { label: '3%', value: 3 },
              { label: '5%', value: 5 },
              { label: '10%', value: 10 },
            ]}
            onSelect={applyTargetRate}
          />
        </div>

        <Checkbox
          dense
          checked={input.includeFees}
          onChange={(event) => onInputChange({ ...input, includeFees: event.target.checked })}
          label="수수료 및 세금 포함"
          description="매수/매도 수수료와 이익 구간의 세금을 반영한 순수익률을 계산합니다."
        />
      </section>

      <section
        className="profit-calculator__panel profit-calculator__result-panel"
        aria-live="polite"
      >
        <div className={`profit-calculator__hero-result ${profitToneClass(result.netProfit)}`}>
          <span className="profit-calculator__hero-label">계산 수익률</span>
          <strong className="profit-calculator__hero-value num">
            {formatPercent(result.profitRate)}
          </strong>
          <span className="profit-calculator__hero-meta">
            순수익 {formatSignedKrw(result.netProfit)} · 매도 {formatKrw(input.sellAmount)}
          </span>
        </div>

        <KpiStrip
          dense
          ariaLabel="매도금액 기준 계산 결과"
          items={[
            {
              label: '총손익',
              value: formatSignedKrw(result.profit),
              tone: profitKpiTone(result.profit),
            },
            {
              label: '순수익',
              value: formatSignedKrw(result.netProfit),
              tone: profitKpiTone(result.netProfit),
            },
            {
              label: '매수 수수료',
              value: formatKrw(result.buyFee),
              tone: input.includeFees ? 'muted' : 'default',
            },
            {
              label: '매도 수수료 + 세금',
              value: formatKrw(result.sellFee + result.tax),
              tone: input.includeFees ? 'muted' : 'default',
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
