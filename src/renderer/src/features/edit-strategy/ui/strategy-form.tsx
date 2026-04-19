import { Button, NumberInput, TextInput } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { DEFAULT_PROFILE, type StrategyFormErrors, validateProfile } from '../model/validate';

type FormRaw = {
  totalAmountKrw: string;
  maxStages: string;
  dropPct: string;
  profitPct: string;
  boosterPct: string;
  boosterAmountKrw: string;
};

function toRaw(profile: StrategyProfile | null): FormRaw {
  const p = profile ?? DEFAULT_PROFILE;
  return {
    totalAmountKrw: String(p.totalAmountKrw),
    maxStages: String(p.maxStages),
    dropPct: String(p.dropPct * 100),
    profitPct: String(p.profitPct * 100),
    boosterPct: p.boosterPct === undefined ? '' : String(p.boosterPct * 100),
    boosterAmountKrw: p.boosterAmountKrw === undefined ? '' : String(p.boosterAmountKrw),
  };
}

function toProfile(raw: FormRaw): Record<string, unknown> {
  const out: Record<string, unknown> = {
    totalAmountKrw: Number(raw.totalAmountKrw),
    maxStages: Number(raw.maxStages),
    dropPct: Number(raw.dropPct) / 100,
    profitPct: Number(raw.profitPct) / 100,
  };
  if (raw.boosterPct.trim().length > 0) out.boosterPct = Number(raw.boosterPct) / 100;
  if (raw.boosterAmountKrw.trim().length > 0) out.boosterAmountKrw = Number(raw.boosterAmountKrw);
  return out;
}

export interface StrategyFormProps {
  initial: StrategyProfile | null;
  disabled?: boolean;
  onSubmit: (profile: StrategyProfile) => void;
  onApplyPreset?: (profile: StrategyProfile) => void;
  presetName?: string;
  onSaveAsPreset?: (name: string, profile: StrategyProfile) => void;
}

/**
 * 전략 파라미터 편집 폼.
 * - 내부 상태는 문자열(raw)로 관리 — DB 저장 시 퍼센트를 소수로 환산
 * - Zod 검증 실패 시 필드별 에러 메시지 표시
 */
export const StrategyForm = (props: StrategyFormProps): ReactElement => {
  const [raw, setRaw] = useState<FormRaw>(() => toRaw(props.initial));
  const [errors, setErrors] = useState<StrategyFormErrors>({});
  const [presetInput, setPresetInput] = useState('');
  const initialKey = JSON.stringify(toRaw(props.initial));
  const [lastInitialKey, setLastInitialKey] = useState(initialKey);

  if (lastInitialKey !== initialKey) {
    setLastInitialKey(initialKey);
    setRaw(toRaw(props.initial));
    setErrors({});
  }

  const update = (key: keyof FormRaw) => (value: string) => {
    setRaw((prev) => ({ ...prev, [key]: value }));
  };

  const validated = validateProfile(toProfile(raw));

  const onSubmit = (): void => {
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    props.onSubmit(validated.profile);
  };

  const onSavePreset = (): void => {
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    const name = presetInput.trim();
    if (name.length === 0) return;
    props.onSaveAsPreset?.(name, validated.profile);
    setPresetInput('');
  };

  return (
    <form className="panel" onSubmit={(e) => e.preventDefault()} aria-label="전략 파라미터 폼">
      <div className="panel__title">전략 파라미터</div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.8rem', maxWidth: 520 }}>
        <Field
          id="strategy-total-amount"
          label="총 투입 금액 (원)"
          value={raw.totalAmountKrw}
          onValueChange={update('totalAmountKrw')}
          error={errors.totalAmountKrw}
          inputMode="numeric"
        />
        <Field
          id="strategy-max-stages"
          label="차수 (1~20)"
          value={raw.maxStages}
          onValueChange={update('maxStages')}
          error={errors.maxStages}
          inputMode="numeric"
        />
        <Field
          id="strategy-drop-pct"
          label="하향매수 비율 (%)"
          value={raw.dropPct}
          onValueChange={update('dropPct')}
          error={errors.dropPct}
          allowDecimal
          inputMode="decimal"
        />
        <Field
          id="strategy-profit-pct"
          label="익절 비율 (%)"
          value={raw.profitPct}
          onValueChange={update('profitPct')}
          error={errors.profitPct}
          allowDecimal
          inputMode="decimal"
        />
        <Field
          id="strategy-booster-pct"
          label="부스터 비율 (%, 선택)"
          value={raw.boosterPct}
          onValueChange={update('boosterPct')}
          error={errors.boosterPct}
          allowDecimal
          inputMode="decimal"
        />
        <Field
          id="strategy-booster-amount"
          label="부스터 금액 (원, 선택)"
          value={raw.boosterAmountKrw}
          onValueChange={update('boosterAmountKrw')}
          error={errors.boosterAmountKrw}
          inputMode="numeric"
        />
      </div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}
      >
        <TextInput
          id="strategy-preset-name"
          value={presetInput}
          onChange={(e) => setPresetInput(e.target.value)}
          placeholder="프리셋 이름"
          aria-label="프리셋 이름"
          disabled={props.disabled}
          dense
          style={{ flex: 1, minWidth: 120 }}
        />
        <Button
          onClick={onSavePreset}
          disabled={props.disabled || presetInput.trim().length === 0 || !validated.ok}
          aria-label="프리셋 저장"
          dense
        >
          프리셋 저장
        </Button>
        <Button
          onClick={onSubmit}
          disabled={props.disabled || !validated.ok}
          aria-label="전략 저장"
          variant="primary"
          dense
        >
          저장
        </Button>
      </div>
    </form>
  );
};

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error: string | undefined;
  allowDecimal?: boolean;
  inputMode?: 'numeric' | 'decimal';
}

const Field = (p: FieldProps): ReactElement => (
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
