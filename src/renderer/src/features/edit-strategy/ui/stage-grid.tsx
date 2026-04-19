import { NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { DropBaseline, StageGridRaw } from '../model/use-stage-grid';

export interface StageGridProps {
  raw: StageGridRaw;
  errors: { dropPct?: string | undefined; profitPct?: string | undefined };
  dropBaseline: DropBaseline;
  disabled?: boolean | undefined;
  onUpdate: (key: keyof StageGridRaw) => (value: string) => void;
  onToggleDropBaseline: () => void;
}

/**
 * 차수별 하향매수 비율 / 익절 비율 그리드.
 * Wave 1에서 1~50차 가변 입력 행으로 확장될 영역.
 * dropBaseline: 'PREV_LOT' = 직전차수 기준, 'FIRST_LOT' = 처음매수가 기준
 */
export const StageGrid = (props: StageGridProps): ReactElement => {
  const { raw, errors, dropBaseline, disabled, onUpdate, onToggleDropBaseline } = props;

  return (
    <section aria-label="차수 그리드">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
        <span className="muted" style={{ fontSize: '1.1rem' }}>
          하향매수 기준
        </span>
        <button
          type="button"
          onClick={onToggleDropBaseline}
          disabled={disabled}
          aria-label={`하향매수 기준: ${dropBaseline === 'PREV_LOT' ? '직전차수' : '처음매수가'}`}
          style={{ fontSize: '1.1rem', cursor: 'pointer' }}
        >
          {dropBaseline === 'PREV_LOT' ? '직전차수' : '처음매수가'}
        </button>
      </div>
      <div style={{ display: 'grid', gap: '0.8rem' }}>
        {/* Wave 1: 1~50차 가변 행으로 확장 예정. 현재는 단일 글로벌 비율 */}
        <StageGridField
          id="strategy-drop-pct"
          label="하향매수 비율 (%)"
          value={raw.dropPct}
          onValueChange={onUpdate('dropPct')}
          error={errors.dropPct}
          allowDecimal
          inputMode="decimal"
          disabled={disabled}
        />
        <StageGridField
          id="strategy-profit-pct"
          label="익절 비율 (%)"
          value={raw.profitPct}
          onValueChange={onUpdate('profitPct')}
          error={errors.profitPct}
          allowDecimal
          inputMode="decimal"
          disabled={disabled}
        />
      </div>
    </section>
  );
};

interface StageGridFieldProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error: string | undefined;
  allowDecimal?: boolean | undefined;
  inputMode?: 'numeric' | 'decimal' | undefined;
  disabled?: boolean | undefined;
}

const StageGridField = (p: StageGridFieldProps): ReactElement => (
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
