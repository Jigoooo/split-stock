import { NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { BoosterSectionRaw } from '../model/use-booster-section';

export interface BoosterSectionProps {
  raw: BoosterSectionRaw;
  errors: { boosterPct: string | undefined; boosterAmountKrw: string | undefined };
  disabled?: boolean | undefined;
  onUpdate: (key: keyof BoosterSectionRaw) => (value: string) => void;
}

/**
 * 수익부스터 섹션.
 * - boosterPct: 감시% (선택, 빈 문자열 = 미설정)
 * - boosterAmountKrw: 재매수금액 (선택, 빈 문자열 = 미설정)
 * Wave 1에서 일간 감시일 필드 추가 예정.
 */
export const BoosterSection = (props: BoosterSectionProps): ReactElement => {
  const { raw, errors, disabled, onUpdate } = props;

  return (
    <section aria-label="수익부스터">
      <div className="muted" style={{ fontSize: '1.1rem', marginBottom: '0.6rem' }}>
        수익부스터 (선택)
      </div>
      <div style={{ display: 'grid', gap: '0.8rem' }}>
        <BoosterField
          id="strategy-booster-pct"
          label="부스터 비율 (%, 선택)"
          value={raw.boosterPct}
          onValueChange={onUpdate('boosterPct')}
          error={errors.boosterPct}
          allowDecimal
          inputMode="decimal"
          disabled={disabled}
        />
        <BoosterField
          id="strategy-booster-amount"
          label="부스터 금액 (원, 선택)"
          value={raw.boosterAmountKrw}
          onValueChange={onUpdate('boosterAmountKrw')}
          error={errors.boosterAmountKrw}
          inputMode="numeric"
          disabled={disabled}
        />
      </div>
    </section>
  );
};

interface BoosterFieldProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error: string | undefined;
  allowDecimal?: boolean | undefined;
  inputMode?: 'numeric' | 'decimal' | undefined;
  disabled?: boolean | undefined;
}

const BoosterField = (p: BoosterFieldProps): ReactElement => (
  <label htmlFor={p.id} style={{ display: 'grid', gap: '0.3rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {p.label}
    </span>
    <NumberInput
      id={p.id}
      value={p.value}
      onValueChange={p.onValueChange}
      aria-label={p.label}
      aria-invalid={Boolean(p.error)}
      dense
      disabled={p.disabled}
      {...(p.allowDecimal ? { allowDecimal: true } : {})}
      {...(p.inputMode ? { inputMode: p.inputMode } : {})}
    />
    {p.error ? (
      <span className="chip chip--down" role="alert">
        {p.error}
      </span>
    ) : null}
  </label>
);
