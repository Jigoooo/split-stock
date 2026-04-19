import type { StrategyProfile } from '@shared/contracts';
import type { ChangeEvent, ReactElement } from 'react';
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

  const update = (key: keyof FormRaw) => (e: ChangeEvent<HTMLInputElement>) => {
    setRaw((prev) => ({ ...prev, [key]: e.target.value }));
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
      <div className="panel__body" style={{ display: 'grid', gap: '0.8rem', maxWidth: 480 }}>
        <Field
          label="총 투입 금액 (원)"
          value={raw.totalAmountKrw}
          onChange={update('totalAmountKrw')}
          error={errors.totalAmountKrw}
          fieldKey="totalAmountKrw"
        />
        <Field
          label="차수 (1~20)"
          value={raw.maxStages}
          onChange={update('maxStages')}
          error={errors.maxStages}
          fieldKey="maxStages"
        />
        <Field
          label="하향매수 비율 (%)"
          value={raw.dropPct}
          onChange={update('dropPct')}
          error={errors.dropPct}
          fieldKey="dropPct"
        />
        <Field
          label="익절 비율 (%)"
          value={raw.profitPct}
          onChange={update('profitPct')}
          error={errors.profitPct}
          fieldKey="profitPct"
        />
        <Field
          label="부스터 비율 (%, 선택)"
          value={raw.boosterPct}
          onChange={update('boosterPct')}
          error={errors.boosterPct}
          fieldKey="boosterPct"
        />
        <Field
          label="부스터 금액 (원, 선택)"
          value={raw.boosterAmountKrw}
          onChange={update('boosterAmountKrw')}
          error={errors.boosterAmountKrw}
          fieldKey="boosterAmountKrw"
        />
      </div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}
      >
        <input
          type="text"
          value={presetInput}
          onChange={(e) => setPresetInput(e.target.value)}
          placeholder="프리셋 이름"
          aria-label="프리셋 이름"
          disabled={props.disabled}
          style={{ flex: 1, minWidth: 120 }}
        />
        <button
          type="button"
          className="hts-btn"
          onClick={onSavePreset}
          disabled={props.disabled || presetInput.trim().length === 0 || !validated.ok}
          aria-label="프리셋 저장"
        >
          프리셋 저장
        </button>
        <button
          type="button"
          className="hts-btn hts-btn--primary"
          onClick={onSubmit}
          disabled={props.disabled || !validated.ok}
          aria-label="전략 저장"
        >
          저장
        </button>
      </div>
    </form>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  error: string | undefined;
  fieldKey: string;
}

const Field = (p: FieldProps): ReactElement => (
  <label style={{ display: 'grid', gap: '0.3rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {p.label}
    </span>
    <input
      type="text"
      inputMode="decimal"
      value={p.value}
      onChange={p.onChange}
      aria-label={p.label}
      aria-invalid={Boolean(p.error)}
      name={p.fieldKey}
    />
    {p.error ? (
      <span className="chip chip--down" role="alert">
        {p.error}
      </span>
    ) : null}
  </label>
);
