import type { PriceCorrectionStrategy } from '@renderer/entities/price-correction-settings';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { usePriceCorrectionForm } from '../model/use-price-correction-form';

type CorrectionSide = 'BUY' | 'SELL';

interface StrategyOption {
  value: PriceCorrectionStrategy;
  label: string;
  desc: string;
}

function buildStrategyOptions(side: CorrectionSide): StrategyOption[] {
  if (side === 'BUY') {
    return [
      {
        value: 'AGGRESSIVE',
        label: '즉시 체결 우선',
        desc: '매도 1호가로 보정 (올림, 살짝 비싸게)',
      },
      {
        value: 'CONSERVATIVE',
        label: '유리한 가격 우선',
        desc: '매수 1호가로 보정 (내림, 미체결 위험)',
      },
    ];
  }
  return [
    {
      value: 'AGGRESSIVE',
      label: '즉시 체결 우선',
      desc: '매수 1호가로 보정 (내림, 살짝 싸게)',
    },
    {
      value: 'CONSERVATIVE',
      label: '유리한 가격 우선',
      desc: '매도 1호가로 보정 (올림, 미체결 위험)',
    },
  ];
}

interface StrategyRadioGroupProps {
  id: string;
  label: string;
  side: CorrectionSide;
  value: PriceCorrectionStrategy;
  disabled: boolean;
  onChange: (v: PriceCorrectionStrategy) => void;
}

const StrategyRadioGroup = ({
  id,
  label,
  side,
  value,
  disabled,
  onChange,
}: StrategyRadioGroupProps): ReactElement => {
  const options = buildStrategyOptions(side);
  return (
    <div style={{ display: 'grid', gap: '0.3rem' }}>
      <span className="muted" style={{ fontSize: '1.1rem' }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: '1.2rem' }}>
        {options.map((opt) => (
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
};

/**
 * 호가 자동 보정 설정 폼.
 * - 매수/매도 각각 즉시 체결 우선(AGGRESSIVE) / 유리한 가격 우선(CONSERVATIVE) 선택
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
      <div className="muted" style={{ fontSize: '1rem' }}>
        차수 매매 발동 시 계산된 가격이 호가단위에 안 맞으면 아래 정책에 따라 주문 직전에 자동
        보정합니다.
      </div>

      <StrategyRadioGroup
        id="pc-buy"
        label="자동 매수 호가 전략"
        side="BUY"
        value={resolvedBuy}
        disabled={isSaving}
        onChange={handleBuyChange}
      />

      <StrategyRadioGroup
        id="pc-sell"
        label="자동 매도 호가 전략"
        side="SELL"
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
