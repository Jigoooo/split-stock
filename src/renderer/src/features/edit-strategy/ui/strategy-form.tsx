import { Button, NumberInput, TextInput } from '@renderer/shared/ui';
import {
  applyStrategyAutoMode,
  createStrategyRules,
  DEFAULT_STRATEGY_PROFILE,
  deriveStrategyAutoMode,
  migrateLegacyStrategyProfile,
  type StrategyAutoMode,
  type StrategyProfile,
} from '@shared/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { type StrategyFormErrors, validateProfile } from '../model/validate';
import { BoosterSection } from './booster-section';

interface StageRuleRowRaw {
  nth: number;
  amountKrw: string;
  targetProfitPct: string;
  triggerDropPct: string;
}

type FormRaw = {
  maxStages: string;
  autoBuyOrderType: 'LIMIT' | 'MARKET';
  autoMode: StrategyAutoMode;
  autoSellOrderType: 'LIMIT' | 'MARKET';
};

function toStageRows(profile: StrategyProfile | null): StageRuleRowRaw[] {
  const resolved = migrateLegacyStrategyProfile(profile) ?? DEFAULT_STRATEGY_PROFILE;
  return Array.from({ length: resolved.maxStages }, (_, index) => {
    const nth = index + 1;
    const buyRule = resolved.buyRules[index];
    const sellRule = resolved.sellRules[index];
    return {
      nth,
      amountKrw: String(buyRule?.amountKrw ?? DEFAULT_STRATEGY_PROFILE.buyRules[0]?.amountKrw ?? 0),
      targetProfitPct: String((sellRule?.targetProfitPct ?? 0.05) * 100),
      triggerDropPct:
        nth === 1
          ? ''
          : String(
              (buyRule?.triggerDropPct ??
                DEFAULT_STRATEGY_PROFILE.buyRules[1]?.triggerDropPct ??
                0.03) * 100,
            ),
    };
  });
}

function toFormRaw(profile: StrategyProfile | null): FormRaw {
  const resolved = migrateLegacyStrategyProfile(profile) ?? DEFAULT_STRATEGY_PROFILE;
  return {
    maxStages: String(resolved.maxStages),
    autoMode: deriveStrategyAutoMode(resolved),
    autoBuyOrderType: resolved.autoBuyOrderType,
    autoSellOrderType: resolved.autoSellOrderType,
  };
}

function toBoosterRaw(profile: StrategyProfile | null): {
  boosterPct: string;
  boosterAmountKrw: string;
} {
  const resolved = migrateLegacyStrategyProfile(profile) ?? DEFAULT_STRATEGY_PROFILE;
  return {
    boosterPct: resolved.boosterPct === undefined ? '' : String(resolved.boosterPct * 100),
    boosterAmountKrw:
      resolved.boosterAmountKrw === undefined ? '' : String(resolved.boosterAmountKrw),
  };
}

function resizeStageRows(current: StageRuleRowRaw[], nextMaxStages: number): StageRuleRowRaw[] {
  if (nextMaxStages <= 0) return current;
  const fallback = current.at(-1) ?? toStageRows(DEFAULT_STRATEGY_PROFILE).at(-1);
  return Array.from({ length: nextMaxStages }, (_, index) => {
    const nth = index + 1;
    const existing = current[index];
    if (existing)
      return { ...existing, nth, triggerDropPct: nth === 1 ? '' : existing.triggerDropPct };
    return {
      nth,
      amountKrw: fallback?.amountKrw ?? '1000000',
      targetProfitPct: fallback?.targetProfitPct ?? '5',
      triggerDropPct: nth === 1 ? '' : fallback?.triggerDropPct || '3',
    };
  });
}

function toProfile(
  raw: FormRaw,
  rows: StageRuleRowRaw[],
  booster: { boosterPct: string; boosterAmountKrw: string },
): Record<string, unknown> {
  const maxStages = Number(raw.maxStages);
  const profile = applyStrategyAutoMode(
    {
      version: 2,
      maxStages,
      ...createStrategyRules(maxStages),
      autoBuyEnabled: true,
      autoBuyOrderType: raw.autoBuyOrderType,
      autoSellEnabled: true,
      autoSellOrderType: raw.autoSellOrderType,
    },
    raw.autoMode,
  );

  profile.buyRules = rows.map((row, index) => ({
    nth: row.nth,
    triggerDropPct: index === 0 ? null : Number(row.triggerDropPct) / 100,
    amountKrw: Number(row.amountKrw),
  }));
  profile.sellRules = rows.map((row) => ({
    nth: row.nth,
    targetProfitPct: Number(row.targetProfitPct) / 100,
  }));
  if (booster.boosterPct.trim().length > 0) profile.boosterPct = Number(booster.boosterPct) / 100;
  if (booster.boosterAmountKrw.trim().length > 0) {
    profile.boosterAmountKrw = Number(booster.boosterAmountKrw);
  }
  return profile;
}

export interface StrategyFormProps {
  initial: StrategyProfile | null;
  disabled?: boolean;
  onSubmit: (profile: StrategyProfile) => void;
  onApplyPreset?: (profile: StrategyProfile) => void;
  presetName?: string;
  onSaveAsPreset?: (name: string, profile: StrategyProfile) => void;
}

export const StrategyForm = (props: StrategyFormProps): ReactElement => {
  const [raw, setRaw] = useState<FormRaw>(() => toFormRaw(props.initial));
  const [rows, setRows] = useState<StageRuleRowRaw[]>(() => toStageRows(props.initial));
  const [booster, setBooster] = useState(() => toBoosterRaw(props.initial));
  const [errors, setErrors] = useState<StrategyFormErrors>({});
  const [presetInput, setPresetInput] = useState('');

  const validated = validateProfile(toProfile(raw, rows, booster));

  const updateRaw = (key: keyof FormRaw, value: FormRaw[keyof FormRaw]): void => {
    setRaw((prev) => ({ ...prev, [key]: value }));
  };

  const updateMaxStages = (value: string): void => {
    setRaw((prev) => ({ ...prev, maxStages: value }));
    const next = Number(value);
    if (Number.isInteger(next) && next >= 1 && next <= 50) {
      setRows((prev) => resizeStageRows(prev, next));
    }
  };

  const updateRow =
    (nth: number, key: keyof Omit<StageRuleRowRaw, 'nth'>) =>
    (value: string): void => {
      setRows((prev) => prev.map((row) => (row.nth === nth ? { ...row, [key]: value } : row)));
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

  return (
    <form
      className="panel"
      onSubmit={(event) => event.preventDefault()}
      aria-label="자동매매 설정 폼"
    >
      <div className="panel__title">자동매매 설정</div>
      <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
        <section style={{ display: 'grid', gap: '0.8rem', maxWidth: 540 }}>
          <Field
            id="strategy-max-stages"
            label="최대 관리차수 (1~50)"
            value={raw.maxStages}
            onValueChange={updateMaxStages}
            error={errors.maxStages}
            inputMode="numeric"
          />

          <label style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted" style={{ fontSize: '1.1rem' }}>
              자동매매 상태
            </span>
            <select
              className="hts-input hts-input--dense"
              value={autoMode}
              disabled={props.disabled}
              aria-label="자동매매 상태"
              onChange={(event) => updateRaw('autoMode', event.target.value as StrategyAutoMode)}
            >
              <option value="ALL_ON">전체 ON</option>
              <option value="ALL_OFF">전체 OFF (수동모드)</option>
              <option value="BUY_ONLY">매수만 ON</option>
              <option value="SELL_ONLY">매도만 ON</option>
            </select>
          </label>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
              gap: '0.8rem',
            }}
          >
            <TradingOrderTypeField
              label="자동매수 주문방식"
              enabled={autoBuyEnabled}
              value={raw.autoBuyOrderType}
              disabled={props.disabled}
              onChange={(value) => updateRaw('autoBuyOrderType', value)}
            />
            <TradingOrderTypeField
              label="자동매도 주문방식"
              enabled={autoSellEnabled}
              value={raw.autoSellOrderType}
              disabled={props.disabled}
              onChange={(value) => updateRaw('autoSellOrderType', value)}
            />
          </div>
        </section>

        <StageRulesTable
          rows={rows}
          errors={errors}
          disabled={props.disabled}
          onChange={updateRow}
        />

        <BoosterSection
          raw={booster}
          errors={{ boosterPct: errors.boosterPct, boosterAmountKrw: errors.boosterAmountKrw }}
          disabled={props.disabled}
          onUpdate={(key) => (value) => setBooster((prev) => ({ ...prev, [key]: value }))}
        />
      </div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}
      >
        <TextInput
          id="strategy-preset-name"
          value={presetInput}
          onChange={(event) => setPresetInput(event.target.value)}
          placeholder="프리셋 이름"
          aria-label="프리셋 이름"
          disabled={props.disabled}
          dense
          style={{ flex: 1, minWidth: 120 }}
        />
        <Button
          onClick={handleSavePreset}
          disabled={props.disabled || presetInput.trim().length === 0 || !validated.ok}
          dense
          aria-label="프리셋 저장"
        >
          프리셋 저장
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={props.disabled || !validated.ok}
          dense
          variant="primary"
          aria-label="자동매매 설정 저장"
        >
          저장
        </Button>
      </div>
    </form>
  );
};

const StageRulesTable = ({
  rows,
  errors,
  disabled,
  onChange,
}: {
  rows: StageRuleRowRaw[];
  errors: StrategyFormErrors;
  disabled?: boolean | undefined;
  onChange: (nth: number, key: keyof Omit<StageRuleRowRaw, 'nth'>) => (value: string) => void;
}): ReactElement => (
  <section aria-label="차수별 자동매매 규칙" style={{ display: 'grid', gap: '0.6rem' }}>
    <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
      차수별 규칙
    </div>
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
            <HeaderCell>차수</HeaderCell>
            <HeaderCell>자동매수 하락률</HeaderCell>
            <HeaderCell>매수금액</HeaderCell>
            <HeaderCell>자동매도 익절률</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.nth} style={{ borderTop: '1px solid var(--border)' }}>
              <BodyCell>{row.nth}차</BodyCell>
              <BodyCell>
                {row.nth === 1 ? (
                  <span className="muted">수동진입</span>
                ) : (
                  <NumberInput
                    value={row.triggerDropPct}
                    onValueChange={onChange(row.nth, 'triggerDropPct')}
                    dense
                    allowDecimal
                    inputMode="decimal"
                    disabled={disabled}
                    aria-label={`${row.nth}차 자동매수 하락률`}
                  />
                )}
              </BodyCell>
              <BodyCell>
                <NumberInput
                  value={row.amountKrw}
                  onValueChange={onChange(row.nth, 'amountKrw')}
                  dense
                  inputMode="numeric"
                  disabled={disabled}
                  aria-label={`${row.nth}차 매수금액`}
                />
              </BodyCell>
              <BodyCell>
                <NumberInput
                  value={row.targetProfitPct}
                  onValueChange={onChange(row.nth, 'targetProfitPct')}
                  dense
                  allowDecimal
                  inputMode="decimal"
                  disabled={disabled}
                  aria-label={`${row.nth}차 자동매도 익절률`}
                />
              </BodyCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {errors.buyRules ? <ErrorChip message={errors.buyRules} /> : null}
    {errors.sellRules ? <ErrorChip message={errors.sellRules} /> : null}
  </section>
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
  value: 'LIMIT' | 'MARKET';
  disabled?: boolean | undefined;
  onChange: (value: 'LIMIT' | 'MARKET') => void;
}): ReactElement => (
  <label style={{ display: 'grid', gap: '0.3rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {label}
    </span>
    <select
      className="hts-input hts-input--dense"
      value={value}
      disabled={disabled || !enabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value as 'LIMIT' | 'MARKET')}
    >
      <option value="LIMIT">지정가</option>
      <option value="MARKET">시장가</option>
    </select>
  </label>
);

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error: string | undefined;
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
      dense
      inputMode={props.inputMode}
    />
    {props.error ? <ErrorChip message={props.error} /> : null}
  </label>
);

const HeaderCell = ({ children }: { children: string }): ReactElement => (
  <th
    style={{
      padding: '0.55rem 0.6rem',
      textAlign: 'left',
      fontSize: '0.95rem',
      fontWeight: 600,
    }}
  >
    {children}
  </th>
);

const BodyCell = ({ children }: { children: ReactNode }): ReactElement => (
  <td style={{ padding: '0.45rem 0.6rem', verticalAlign: 'middle' }}>{children}</td>
);

const ErrorChip = ({ message }: { message: string }): ReactElement => (
  <span className="chip chip--down" role="alert">
    {message}
  </span>
);
