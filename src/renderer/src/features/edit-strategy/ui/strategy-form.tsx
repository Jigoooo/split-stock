import { Button, Select, TextInput } from '@renderer/shared/ui';
import type { StrategyAutoMode, StrategyOrderType, StrategyProfile } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { STRATEGY_AUTO_MODE_OPTIONS } from '../model/options';
import { toFormRaw, toProfile, toStageRows } from '../model/strategy-form-adapter';
import type {
  ApplyScope,
  FormChrome,
  FormRaw,
  StageRuleField,
  StageRuleRowRaw,
} from '../model/strategy-form-types';
import { type StrategyFormErrors, validateProfile } from '../model/validate';
import { NumberField } from './number-field';
import { StageRulesEditor } from './stage-rules-editor';
import { StrategyFormActions } from './strategy-form-actions';

export interface StrategyFormProps {
  initial: StrategyProfile | null;
  disabled?: boolean | undefined;
  onSubmit: (profile: StrategyProfile) => void;
  presetName?: string;
  onSaveAsPreset?: (name: string, profile: StrategyProfile) => void;
  chrome?: FormChrome;
  submitLabel?: string;
  submitAriaLabel?: string;
  submitDisabled?: boolean;
  submitContextLabel?: string;
}

export const StrategyForm = (props: StrategyFormProps): ReactElement => {
  const chrome = props.chrome ?? 'panel';
  const [raw, setRaw] = useState<FormRaw>(() => toFormRaw(props.initial));
  const [rows, setRows] = useState<StageRuleRowRaw[]>(() => toStageRows(props.initial));
  const [errors, setErrors] = useState<StrategyFormErrors>({});
  const [presetInput, setPresetInput] = useState('');
  const [templateNth, setTemplateNth] = useState('2');

  const activeMaxStages = Number(raw.maxStages);
  const validated = validateProfile(toProfile(raw, rows, props.initial));
  const showPresetSave = props.onSaveAsPreset !== undefined;
  const canSavePreset = !props.disabled && presetInput.trim().length > 0 && validated.ok;

  const updateRaw = <K extends keyof FormRaw>(key: K, value: FormRaw[K]): void => {
    setRaw((prev) => ({ ...prev, [key]: value }));
  };

  const updateRow =
    (nth: number, key: StageRuleField) =>
    (value: string): void => {
      setRows((prev) => prev.map((row) => (row.nth === nth ? { ...row, [key]: value } : row)));
    };

  const applyTemplate = (scope: ApplyScope): void => {
    const sourceNth = Number(templateNth);
    const source = rows.find((row) => row.nth === sourceNth);
    if (!source) return;
    setRows((prev) =>
      prev.map((row) => {
        const inScope =
          scope === 'all' ||
          (Number.isInteger(activeMaxStages) && row.nth >= 1 && row.nth <= activeMaxStages);
        if (!inScope) return row;
        return {
          ...row,
          amountKrw: source.amountKrw,
          targetProfitPct: source.targetProfitPct,
          triggerDropPct:
            row.nth === 1
              ? ''
              : source.triggerDropPct.trim() !== ''
                ? source.triggerDropPct
                : row.triggerDropPct || '3',
        };
      }),
    );
  };

  const handleSubmit = (): void => {
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    props.onSubmit(validated.profile);
  };

  const handleSavePreset = (): void => {
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    const name = presetInput.trim();
    if (name.length === 0) return;
    props.onSaveAsPreset?.(name, validated.profile);
    setPresetInput('');
  };

  const autoBuyEnabled = raw.autoMode === 'ALL_ON' || raw.autoMode === 'BUY_ONLY';
  const autoSellEnabled = raw.autoMode === 'ALL_ON' || raw.autoMode === 'SELL_ONLY';
  const bodyStyle = { display: 'grid', gap: '1rem' } as const;
  const formClassName =
    chrome === 'panel' ? 'panel strategy-form' : 'strategy-form strategy-form--content';
  const submitContextLabel =
    props.submitContextLabel ?? inferSubmitContextLabel(props.submitLabel ?? '자동매매 설정 저장');

  return (
    <form
      className={formClassName}
      onSubmit={(event) => event.preventDefault()}
      aria-label="자동매매 설정 폼"
    >
      <div className={chrome === 'panel' ? 'panel__body' : undefined} style={bodyStyle}>
        <section
          style={{
            display: 'grid',
            gap: '0.8rem',
            gridTemplateColumns: 'minmax(180px, 220px) minmax(180px, 240px)',
            alignItems: 'end',
          }}
        >
          <NumberField
            id="strategy-max-stages"
            label="최대 관리차수 (1~50)"
            value={raw.maxStages}
            onValueChange={(value) => updateRaw('maxStages', value)}
            error={errors.maxStages}
            disabled={props.disabled}
            inputMode="numeric"
          />
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted" style={{ fontSize: '1.1rem' }}>
              자동매매 상태
            </span>
            <Select
              value={raw.autoMode}
              disabled={props.disabled}
              aria-label="자동매매 상태"
              onChange={(event) => updateRaw('autoMode', event.target.value as StrategyAutoMode)}
              dense
            >
              {STRATEGY_AUTO_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </section>

        {showPresetSave ? (
          <section
            aria-label="템플릿으로 저장"
            style={{
              display: 'grid',
              gap: '0.6rem',
              padding: '0.8rem',
              border: '0.1rem solid var(--border)',
              borderRadius: '0.6rem',
              background: 'var(--bg-2, rgba(0,0,0,0.03))',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.8rem',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'grid', gap: '0.2rem', minWidth: '12rem' }}>
                <strong style={{ fontSize: '1.05rem', color: 'var(--fg)' }}>템플릿으로 저장</strong>
                <span className="muted" style={{ fontSize: '0.95rem' }}>
                  현재 차수 설정을 새 템플릿 이름으로 저장합니다.
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '0.5rem',
                  flex: '1 1 18rem',
                  minWidth: 0,
                }}
              >
                <TextInput
                  id="strategy-preset-name"
                  value={presetInput}
                  onChange={(event) => setPresetInput(event.target.value)}
                  placeholder="템플릿 이름"
                  aria-label="템플릿 이름"
                  disabled={props.disabled}
                  dense
                  style={{ flex: '1 1 12rem', minWidth: '10rem' }}
                />
                <Button
                  onClick={handleSavePreset}
                  disabled={!canSavePreset}
                  dense
                  aria-label="템플릿 저장"
                >
                  템플릿 저장
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        <StageRulesEditor
          rows={rows}
          activeMaxStages={activeMaxStages}
          errors={errors}
          disabled={props.disabled}
          autoBuyEnabled={autoBuyEnabled}
          autoSellEnabled={autoSellEnabled}
          autoBuyOrderType={raw.autoBuyOrderType}
          autoSellOrderType={raw.autoSellOrderType}
          templateNth={templateNth}
          onTemplateNthChange={setTemplateNth}
          onApplyTemplate={applyTemplate}
          onAutoBuyOrderTypeChange={(value: StrategyOrderType) =>
            updateRaw('autoBuyOrderType', value)
          }
          onAutoSellOrderTypeChange={(value: StrategyOrderType) =>
            updateRaw('autoSellOrderType', value)
          }
          onChange={updateRow}
        />
      </div>
      <StrategyFormActions
        canSubmit={!props.disabled && !props.submitDisabled && validated.ok}
        chrome={chrome}
        onSubmit={handleSubmit}
        submitAriaLabel={props.submitAriaLabel}
        submitContextLabel={submitContextLabel}
        submitLabel={props.submitLabel}
      />
    </form>
  );
};

function inferSubmitContextLabel(label: string): string {
  if (label.includes('종목')) return '종목 설정';
  if (label.includes('기본')) return '기본값';
  if (label.includes('템플릿')) return '템플릿';
  return '자동매매 설정';
}
