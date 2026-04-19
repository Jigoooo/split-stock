import { Button, NumberInput, TextInput } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useBoosterSection } from '../model/use-booster-section';
import { useStageGrid } from '../model/use-stage-grid';
import { DEFAULT_PROFILE, type StrategyFormErrors, validateProfile } from '../model/validate';
import { BoosterSection } from './booster-section';
import { ProtectionLimits } from './protection-limits';
import { RateGuard } from './rate-guard';
import { StageGrid } from './stage-grid';
import { TimeWindows } from './time-windows';

// ── 폼 raw 타입: totalAmountKrw / maxStages 는 form-level (그리드 확장과 무관)
type FormBaseRaw = {
  totalAmountKrw: string;
  maxStages: string;
};

function toBaseRaw(profile: StrategyProfile | null): FormBaseRaw {
  const p = profile ?? DEFAULT_PROFILE;
  return {
    totalAmountKrw: String(p.totalAmountKrw),
    maxStages: String(p.maxStages),
  };
}

function toStageRaw(profile: StrategyProfile | null) {
  const p = profile ?? DEFAULT_PROFILE;
  return {
    dropPct: String(p.dropPct * 100),
    profitPct: String(p.profitPct * 100),
  };
}

function toBoosterRaw(profile: StrategyProfile | null) {
  const p = profile ?? DEFAULT_PROFILE;
  return {
    boosterPct: p.boosterPct === undefined ? '' : String(p.boosterPct * 100),
    boosterAmountKrw: p.boosterAmountKrw === undefined ? '' : String(p.boosterAmountKrw),
  };
}

function toProfile(
  base: FormBaseRaw,
  stage: ReturnType<typeof toStageRaw>,
  booster: ReturnType<typeof toBoosterRaw>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    totalAmountKrw: Number(base.totalAmountKrw),
    maxStages: Number(base.maxStages),
    dropPct: Number(stage.dropPct) / 100,
    profitPct: Number(stage.profitPct) / 100,
  };
  if (booster.boosterPct.trim().length > 0) out.boosterPct = Number(booster.boosterPct) / 100;
  if (booster.boosterAmountKrw.trim().length > 0)
    out.boosterAmountKrw = Number(booster.boosterAmountKrw);
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
 * - totalAmountKrw / maxStages: form-level 상태 (여기서 관리)
 * - dropPct / profitPct: useStageGrid (Wave 1에서 차수별 그리드로 확장)
 * - boosterPct / boosterAmountKrw: useBoosterSection
 * - 내부 상태는 문자열(raw)로 관리 — DB 저장 시 퍼센트를 소수로 환산
 * - Zod 검증 실패 시 필드별 에러 메시지 표시
 */
export const StrategyForm = (props: StrategyFormProps): ReactElement => {
  // form-level 상태 (totalAmountKrw, maxStages)
  const [base, setBase] = useState<FormBaseRaw>(() => toBaseRaw(props.initial));

  // sub-hooks: 각각 독립 상태 보유.
  //
  // 주의: props.initial 이 바뀌어도 sub-hook 의 useState initializer 는 최초 렌더만 실행되어
  // sub-hook 의 raw 값은 stale 이 된다. 이 컴포넌트는 호출측에서 `key` prop 으로 폼을 재마운트해
  // sub-hook 들이 새 initial 로 다시 시드되도록 설계되었다 (settings-page 참고).
  const stageGrid = useStageGrid(toStageRaw(props.initial));
  const boosterSection = useBoosterSection(toBoosterRaw(props.initial));

  const [errors, setErrors] = useState<StrategyFormErrors>({});
  const [presetInput, setPresetInput] = useState('');

  const updateBase = (key: keyof FormBaseRaw) => (value: string) => {
    setBase((prev) => ({ ...prev, [key]: value }));
  };

  const validated = validateProfile(toProfile(base, stageGrid.raw, boosterSection.raw));

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
        {/* form-level: 총 투입 금액 / 차수 */}
        <Field
          id="strategy-total-amount"
          label="총 투입 금액 (원)"
          value={base.totalAmountKrw}
          onValueChange={updateBase('totalAmountKrw')}
          error={errors.totalAmountKrw}
          inputMode="numeric"
        />
        <Field
          id="strategy-max-stages"
          label="차수 (1~20)"
          value={base.maxStages}
          onValueChange={updateBase('maxStages')}
          error={errors.maxStages}
          inputMode="numeric"
        />

        {/* 차수별 그리드 (Wave 1에서 1~50차 가변 행으로 확장) */}
        <StageGrid
          raw={stageGrid.raw}
          errors={{ dropPct: errors.dropPct, profitPct: errors.profitPct }}
          dropBaseline={stageGrid.dropBaseline}
          disabled={props.disabled}
          onUpdate={stageGrid.update}
          onToggleDropBaseline={stageGrid.toggleDropBaseline}
        />

        {/* 수익부스터 */}
        <BoosterSection
          raw={boosterSection.raw}
          errors={{ boosterPct: errors.boosterPct, boosterAmountKrw: errors.boosterAmountKrw }}
          disabled={props.disabled}
          onUpdate={boosterSection.update}
        />

        {/* Wave 1 placeholder 섹션 */}
        <ProtectionLimits />
        <TimeWindows />
        <RateGuard />
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
