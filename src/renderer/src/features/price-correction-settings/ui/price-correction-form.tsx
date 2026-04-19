import type { PriceCorrectionStrategy } from '@renderer/entities/price-correction-settings';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { usePriceCorrectionForm } from '../model/use-price-correction-form';

const STRATEGY_OPTIONS: Array<{ value: PriceCorrectionStrategy; label: string; desc: string }> = [
  { value: 'AGGRESSIVE', label: '적극적 (매도호가)', desc: '매수: 매도 1호가 / 매도: 매수 1호가' },
  {
    value: 'CONSERVATIVE',
    label: '보수적 (매수호가)',
    desc: '매수: 매수 1호가 / 매도: 매도 1호가',
  },
];

interface StrategyRadioGroupProps {
  id: string;
  label: string;
  value: PriceCorrectionStrategy;
  disabled: boolean;
  onChange: (v: PriceCorrectionStrategy) => void;
}

const StrategyRadioGroup = ({
  id,
  label,
  value,
  disabled,
  onChange,
}: StrategyRadioGroupProps): ReactElement => (
  <div style={{ display: 'grid', gap: '0.3rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {label}
    </span>
    <div style={{ display: 'flex', gap: '1.2rem' }}>
      {STRATEGY_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.4rem',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <input
            type="radio"
            name={id}
            value={opt.value}
            checked={value === opt.value}
            disabled={disabled}
            onChange={() => onChange(opt.value)}
            style={{ marginTop: '0.2rem' }}
          />
          <span>
            <span style={{ fontWeight: 500 }}>{opt.label}</span>
            <br />
            <span className="muted" style={{ fontSize: '1rem' }}>
              {opt.desc}
            </span>
          </span>
        </label>
      ))}
    </div>
  </div>
);

/**
 * 호가 자동 보정 설정 폼.
 * - 매수/매도 각각 AGGRESSIVE(매도호가) / CONSERVATIVE(매수호가) 선택
 */
export const PriceCorrectionForm = (): ReactElement => {
  const {
    isPending,
    error,
    resolvedBuy,
    resolvedSell,
    isSaving,
    handleBuyChange,
    handleSellChange,
    handleSave,
  } = usePriceCorrectionForm();

  if (isPending) {
    return (
      <section aria-label="호가 자동 보정">
        <p className="muted">로딩 중…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section aria-label="호가 자동 보정">
        <p className="chip chip--down" role="alert">
          {error.message}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="호가 자동 보정" style={{ display: 'grid', gap: '0.8rem' }}>
      <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        호가 자동 보정
      </div>

      <StrategyRadioGroup
        id="pc-buy"
        label="매수 호가 전략"
        value={resolvedBuy}
        disabled={isSaving}
        onChange={handleBuyChange}
      />

      <StrategyRadioGroup
        id="pc-sell"
        label="매도 호가 전략"
        value={resolvedSell}
        disabled={isSaving}
        onChange={handleSellChange}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          variant="primary"
          dense
          aria-label="호가 자동 보정 저장"
        >
          저장
        </Button>
      </div>
    </section>
  );
};
