import { Button, NumberInput, OverlayScrollbar, Select, TextInput } from '@renderer/shared/ui';
import {
  applyStrategyAutoMode,
  DEFAULT_STRATEGY_PROFILE,
  deriveStrategyAutoMode,
  MAX_STRATEGY_STAGES,
  normalizeStrategyProfile,
  type StrategyAutoMode,
  type StrategyOrderType,
  type StrategyProfile,
} from '@shared/contracts';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { ORDER_TYPE_OPTIONS, STRATEGY_AUTO_MODE_OPTIONS } from '../model/options';
import { type StrategyFormErrors, validateProfile } from '../model/validate';

interface StageRuleRowRaw {
  nth: number;
  amountKrw: string;
  targetProfitPct: string;
  triggerDropPct: string;
}

type FormRaw = {
  maxStages: string;
  autoBuyOrderType: StrategyOrderType;
  autoMode: StrategyAutoMode;
  autoSellOrderType: StrategyOrderType;
};

type FormChrome = 'panel' | 'content';
type ApplyScope = 'active' | 'all';

function resolveProfile(profile: StrategyProfile | null): StrategyProfile {
  return normalizeStrategyProfile(profile) ?? DEFAULT_STRATEGY_PROFILE;
}

function toStageRows(profile: StrategyProfile | null): StageRuleRowRaw[] {
  const resolved = resolveProfile(profile);
  return Array.from({ length: MAX_STRATEGY_STAGES }, (_, index) => {
    const nth = index + 1;
    const buyRule = resolved.buyRules[index] ?? DEFAULT_STRATEGY_PROFILE.buyRules[index];
    const sellRule = resolved.sellRules[index] ?? DEFAULT_STRATEGY_PROFILE.sellRules[index];
    return {
      nth,
      amountKrw: String(buyRule?.amountKrw ?? 1_000_000),
      targetProfitPct: String(((sellRule?.targetProfitPct ?? 0.05) * 100).toLocaleString('ko-KR')),
      triggerDropPct:
        nth === 1 ? '' : String(((buyRule?.triggerDropPct ?? 0.03) * 100).toLocaleString('ko-KR')),
    };
  });
}

function toFormRaw(profile: StrategyProfile | null): FormRaw {
  const resolved = resolveProfile(profile);
  return {
    maxStages: String(resolved.maxStages),
    autoMode: deriveStrategyAutoMode(resolved),
    autoBuyOrderType: resolved.autoBuyOrderType,
    autoSellOrderType: resolved.autoSellOrderType,
  };
}

function toProfile(
  raw: FormRaw,
  rows: StageRuleRowRaw[],
  initial: StrategyProfile | null,
): Record<string, unknown> {
  const base = resolveProfile(initial);
  const profile = applyStrategyAutoMode(
    {
      version: 2,
      maxStages: Number(raw.maxStages),
      buyRules: rows.map((row, index) => ({
        nth: row.nth,
        triggerDropPct: index === 0 ? null : Number(row.triggerDropPct) / 100,
        amountKrw: Number(row.amountKrw),
      })),
      sellRules: rows.map((row) => ({
        nth: row.nth,
        targetProfitPct: Number(row.targetProfitPct) / 100,
      })),
      autoBuyEnabled: true,
      autoBuyOrderType: raw.autoBuyOrderType,
      autoSellEnabled: true,
      autoSellOrderType: raw.autoSellOrderType,
      ...(base.respiitPlan ? { respiitPlan: base.respiitPlan } : {}),
      ...(base.autoTradingEnabled !== undefined
        ? { autoTradingEnabled: base.autoTradingEnabled }
        : {}),
    },
    raw.autoMode,
  );
  return profile;
}

export interface StrategyFormProps {
  initial: StrategyProfile | null;
  disabled?: boolean | undefined;
  onSubmit: (profile: StrategyProfile) => void;
  onApplyPreset?: (profile: StrategyProfile) => void;
  presetName?: string;
  onSaveAsPreset?: (name: string, profile: StrategyProfile) => void;
  chrome?: FormChrome;
  submitLabel?: string;
  submitAriaLabel?: string;
  submitDisabled?: boolean;
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

  const updateRaw = (key: keyof FormRaw, value: FormRaw[keyof FormRaw]): void => {
    setRaw((prev) => ({ ...prev, [key]: value }));
  };

  const updateMaxStages = (value: string): void => {
    setRaw((prev) => ({ ...prev, maxStages: value }));
  };

  const updateRow =
    (nth: number, key: keyof Omit<StageRuleRowRaw, 'nth'>) =>
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

  const autoMode = raw.autoMode;
  const autoBuyEnabled = autoMode === 'ALL_ON' || autoMode === 'BUY_ONLY';
  const autoSellEnabled = autoMode === 'ALL_ON' || autoMode === 'SELL_ONLY';
  const bodyStyle = { display: 'grid', gap: '1rem' } as const;
  const actionsStyle = {
    display: 'flex',
    gap: '0.6rem',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  } as const;

  return (
    <form
      className={chrome === 'panel' ? 'panel' : undefined}
      onSubmit={(event) => event.preventDefault()}
      aria-label="자동매매 설정 폼"
      style={chrome === 'content' ? bodyStyle : undefined}
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
          <Field
            id="strategy-max-stages"
            label="최대 관리차수 (1~50)"
            value={raw.maxStages}
            onValueChange={updateMaxStages}
            error={errors.maxStages}
            disabled={props.disabled}
            inputMode="numeric"
          />

          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted" style={{ fontSize: '1.1rem' }}>
              자동매매 상태
            </span>
            <Select
              value={autoMode}
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
          onAutoBuyOrderTypeChange={(value) => updateRaw('autoBuyOrderType', value)}
          onAutoSellOrderTypeChange={(value) => updateRaw('autoSellOrderType', value)}
          onChange={updateRow}
        />
      </div>
      <div className={chrome === 'panel' ? 'panel__body' : undefined} style={actionsStyle}>
        {showPresetSave ? (
          <>
            <TextInput
              id="strategy-preset-name"
              value={presetInput}
              onChange={(event) => setPresetInput(event.target.value)}
              placeholder="템플릿 이름"
              aria-label="템플릿 이름"
              disabled={props.disabled}
              dense
              style={{ flex: 1, minWidth: 120 }}
            />
            <Button
              onClick={handleSavePreset}
              disabled={props.disabled || presetInput.trim().length === 0 || !validated.ok}
              dense
              aria-label="템플릿 저장"
            >
              템플릿 저장
            </Button>
          </>
        ) : null}
        <Button
          onClick={handleSubmit}
          disabled={props.disabled || props.submitDisabled || !validated.ok}
          dense
          variant="primary"
          aria-label={props.submitAriaLabel ?? '자동매매 설정 저장'}
        >
          {props.submitLabel ?? '저장'}
        </Button>
      </div>
    </form>
  );
};

const StageRulesEditor = ({
  activeMaxStages,
  autoBuyEnabled,
  autoBuyOrderType,
  autoSellEnabled,
  autoSellOrderType,
  disabled,
  errors,
  onApplyTemplate,
  onAutoBuyOrderTypeChange,
  onAutoSellOrderTypeChange,
  onChange,
  onTemplateNthChange,
  rows,
  templateNth,
}: {
  rows: StageRuleRowRaw[];
  activeMaxStages: number;
  errors: StrategyFormErrors;
  disabled?: boolean | undefined;
  autoBuyEnabled: boolean;
  autoSellEnabled: boolean;
  autoBuyOrderType: StrategyOrderType;
  autoSellOrderType: StrategyOrderType;
  templateNth: string;
  onTemplateNthChange: (value: string) => void;
  onApplyTemplate: (scope: ApplyScope) => void;
  onAutoBuyOrderTypeChange: (value: StrategyOrderType) => void;
  onAutoSellOrderTypeChange: (value: StrategyOrderType) => void;
  onChange: (nth: number, key: keyof Omit<StageRuleRowRaw, 'nth'>) => (value: string) => void;
}): ReactElement => {
  const rulesScrollRef = useRef<HTMLDivElement | null>(null);

  return (
    <section aria-label="차수별 자동매매 규칙" style={{ display: 'grid', gap: '0.8rem' }}>
      <div
        style={{
          display: 'flex',
          gap: '0.8rem',
          alignItems: 'end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
          차수별 규칙
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: '0.2rem' }}>
            <span className="muted" style={{ fontSize: '0.95rem' }}>
              기준 차수
            </span>
            <Select
              value={templateNth}
              onChange={(event) => onTemplateNthChange(event.target.value)}
              aria-label="전체 적용 기준 차수"
              disabled={disabled}
              dense
              style={{ minWidth: '8rem' }}
            >
              {rows.map((row) => (
                <option key={row.nth} value={String(row.nth)}>
                  {row.nth}차
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={() => onApplyTemplate('active')} disabled={disabled} dense>
            활성 차수 전체 적용
          </Button>
          <Button onClick={() => onApplyTemplate('all')} disabled={disabled} dense>
            1~50 전체 적용
          </Button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '0.8rem',
          gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
        }}
      >
        <TradingOrderTypeField
          label="자동매수 주문방식"
          enabled={autoBuyEnabled}
          value={autoBuyOrderType}
          disabled={disabled}
          onChange={onAutoBuyOrderTypeChange}
        />
        <TradingOrderTypeField
          label="자동매도 주문방식"
          enabled={autoSellEnabled}
          value={autoSellOrderType}
          disabled={disabled}
          onChange={onAutoSellOrderTypeChange}
        />
      </div>

      <div
        ref={rulesScrollRef}
        style={{
          maxHeight: '32rem',
          overflow: 'auto',
          paddingRight: '0.85rem',
          position: 'relative',
          scrollbarWidth: 'none',
        }}
      >
        <OverlayScrollbar containerRef={rulesScrollRef} alwaysVisible />
        <div style={{ display: 'grid', gap: '0.45rem' }}>
          {rows.map((row) => {
            const isActive =
              Number.isInteger(activeMaxStages) &&
              activeMaxStages >= 1 &&
              row.nth <= activeMaxStages;
            return (
              <StageRuleCard
                key={row.nth}
                row={row}
                disabled={disabled || !isActive}
                inactive={!isActive}
                onChange={onChange}
              />
            );
          })}
        </div>
      </div>
      {errors.buyRules ? <ErrorChip message={errors.buyRules} /> : null}
      {errors.sellRules ? <ErrorChip message={errors.sellRules} /> : null}
    </section>
  );
};

const StageRuleCard = ({
  disabled,
  inactive,
  onChange,
  row,
}: {
  row: StageRuleRowRaw;
  disabled: boolean;
  inactive: boolean;
  onChange: (nth: number, key: keyof Omit<StageRuleRowRaw, 'nth'>) => (value: string) => void;
}): ReactElement => (
  <div
    aria-disabled={inactive}
    style={{
      display: 'grid',
      gridTemplateColumns: '4rem minmax(210px, 1.1fr) minmax(120px, 0.7fr) minmax(210px, 1fr)',
      gap: '0.6rem',
      alignItems: 'center',
      padding: '0.55rem 0.65rem',
      border: '1px solid var(--border)',
      borderRadius: '0.35rem',
      background: inactive ? 'var(--bg-3)' : 'var(--bg)',
      opacity: inactive ? 0.72 : 1,
    }}
  >
    <strong>{row.nth}차</strong>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
      {row.nth === 1 ? (
        <span className="muted">수동진입</span>
      ) : (
        <>
          <NumberInput
            value={row.triggerDropPct}
            onValueChange={onChange(row.nth, 'triggerDropPct')}
            dense
            allowDecimal
            inputMode="decimal"
            disabled={disabled}
            aria-label={`${row.nth}차 자동매수 하락률`}
            style={{ width: '6.5rem' }}
          />
          <span>% 하락시 {row.nth}차 매수</span>
        </>
      )}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
      <NumberInput
        value={row.amountKrw}
        onValueChange={onChange(row.nth, 'amountKrw')}
        dense
        inputMode="numeric"
        disabled={disabled}
        aria-label={`${row.nth}차 매수금액`}
        style={{ width: '8rem' }}
      />
      <span>원</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
      <NumberInput
        value={row.targetProfitPct}
        onValueChange={onChange(row.nth, 'targetProfitPct')}
        dense
        allowDecimal
        inputMode="decimal"
        disabled={disabled}
        aria-label={`${row.nth}차 자동매도 익절률`}
        style={{ width: '6.5rem' }}
      />
      <span>% 수익시 {row.nth}차 매도</span>
    </div>
  </div>
);

const TradingOrderTypeField = ({
  label,
  enabled,
  value,
  disabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  value: StrategyOrderType;
  disabled?: boolean | undefined;
  onChange: (value: StrategyOrderType) => void;
}): ReactElement => (
  <div style={{ display: 'grid', gap: '0.3rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {label}
    </span>
    <Select
      value={value}
      disabled={disabled || !enabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value as StrategyOrderType)}
      dense
    >
      {ORDER_TYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  </div>
);

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error: string | undefined;
  disabled?: boolean | undefined;
  inputMode?: 'numeric' | 'decimal';
}

const Field = (props: FieldProps): ReactElement => (
  <label htmlFor={props.id} style={{ display: 'grid', gap: '0.3rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {props.label}
    </span>
    <NumberInput
      id={props.id}
      value={props.value}
      onValueChange={props.onValueChange}
      aria-label={props.label}
      aria-invalid={Boolean(props.error)}
      disabled={props.disabled}
      dense
      inputMode={props.inputMode}
    />
    {props.error ? <ErrorChip message={props.error} /> : null}
  </label>
);

const ErrorChip = ({ message }: { message: string }): ReactElement => (
  <span className="chip chip--down" role="alert">
    {message}
  </span>
);
