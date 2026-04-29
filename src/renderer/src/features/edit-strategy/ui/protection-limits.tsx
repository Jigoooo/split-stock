import { Button, NumberInput, Switch } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useProtectionLimitsForm } from '../model/use-protection-limits-form';

type ProtectionValueField =
  | 'perSymbolDailyMaxBuys'
  | 'dailyTotalMaxAmount'
  | 'dailyTotalMaxCount'
  | 'accountTotalMaxAmount';

type ProtectionEnabledField =
  | 'perSymbolDailyMaxBuysEnabled'
  | 'dailyTotalMaxAmountEnabled'
  | 'dailyTotalMaxCountEnabled'
  | 'accountTotalMaxAmountEnabled';

interface ProtectionLimitRowProps {
  title: string;
  description: string;
  unit: string;
  enabled: boolean;
  enabledField: ProtectionEnabledField;
  value: string;
  valueField: ProtectionValueField;
  defaultValue: string;
  disabled: boolean;
  onChange: (field: ProtectionValueField | ProtectionEnabledField, value: string | boolean) => void;
}

const rowStyles = {
  root: (enabled: boolean) => ({
    display: 'grid',
    gridTemplateColumns: 'minmax(16rem, 1fr) minmax(12rem, 16rem) auto',
    gap: '0.8rem',
    alignItems: 'center',
    padding: '0.8rem',
    border: '0.1rem solid var(--border)',
    borderRadius: '0.6rem',
    background: enabled ? 'var(--bg)' : 'var(--bg-2)',
    opacity: enabled ? 1 : 0.72,
  }),
  copy: { display: 'grid', gap: '0.2rem', minWidth: 0 },
  control: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
} as const;

function ProtectionLimitRow({
  title,
  description,
  unit,
  enabled,
  enabledField,
  value,
  valueField,
  defaultValue,
  disabled,
  onChange,
}: ProtectionLimitRowProps): ReactElement {
  const inputId = `protection-${valueField}`;
  return (
    <div style={rowStyles.root(enabled)}>
      <div style={rowStyles.copy}>
        <label htmlFor={inputId} style={{ fontWeight: 700 }}>
          {title}
        </label>
        <span className="muted" style={{ fontSize: '1.05rem' }}>
          {description}
        </span>
      </div>
      <div style={rowStyles.control}>
        <NumberInput
          id={inputId}
          value={value}
          onValueChange={(next) => onChange(valueField, next)}
          aria-label={title}
          disabled={!enabled || disabled}
          dense
          inputMode="numeric"
          emptyDisplay={defaultValue}
        />
        <span className="muted" style={{ whiteSpace: 'nowrap' }}>
          {unit}
        </span>
      </div>
      <Switch
        checked={enabled}
        disabled={disabled}
        onChange={(checked) => {
          onChange(enabledField, checked);
          if (checked && value.trim() === '') onChange(valueField, defaultValue);
        }}
        label={enabled ? '사용' : '끄기'}
        aria-label={`${title} 사용 여부`}
      />
    </div>
  );
}

/**
 * 보호 한도 입력 폼.
 * - 종목별 1일 최대 매수 횟수
 * - 1일 총 최대 매수 금액
 * - 1일 총 최대 매수 건수
 * - 계좌 총 최대 매수 금액
 * 빈 값 = 제한 없음 (null 저장)
 */
export const ProtectionLimits = (): ReactElement => {
  const {
    accountId,
    isPending,
    error,
    resolved,
    isSaving,
    isDirty,
    handleFieldChange,
    handleSave,
  } = useProtectionLimitsForm();

  if (accountId === null) {
    return (
      <section aria-label="보호 한도">
        <p className="muted">활성 계좌가 없습니다.</p>
      </section>
    );
  }

  if (isPending) {
    return (
      <section aria-label="보호 한도">
        <p className="muted">로딩 중…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section aria-label="보호 한도">
        <p className="chip chip--down" role="alert">
          {error.message}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="보호 한도" style={{ display: 'grid', gap: '0.8rem' }}>
      <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        자동매수 보호 한도
      </div>

      <ProtectionLimitRow
        title="종목별 1일 최대 매수 횟수"
        description="같은 종목의 자동매수 제출 횟수를 하루 단위로 제한합니다."
        unit="회"
        enabled={resolved.perSymbolDailyMaxBuysEnabled}
        enabledField="perSymbolDailyMaxBuysEnabled"
        value={resolved.perSymbolDailyMaxBuys}
        valueField="perSymbolDailyMaxBuys"
        defaultValue="3"
        disabled={isSaving}
        onChange={handleFieldChange}
      />
      <ProtectionLimitRow
        title="1일 총 최대 매수 금액"
        description="계좌 전체 자동매수 금액 합계가 한도를 넘으면 추가 매수를 막습니다."
        unit="원"
        enabled={resolved.dailyTotalMaxAmountEnabled}
        enabledField="dailyTotalMaxAmountEnabled"
        value={resolved.dailyTotalMaxAmount}
        valueField="dailyTotalMaxAmount"
        defaultValue="100000"
        disabled={isSaving}
        onChange={handleFieldChange}
      />
      <ProtectionLimitRow
        title="1일 총 최대 매수 건수"
        description="모든 종목의 자동매수 제출 건수를 하루 단위로 제한합니다."
        unit="회"
        enabled={resolved.dailyTotalMaxCountEnabled}
        enabledField="dailyTotalMaxCountEnabled"
        value={resolved.dailyTotalMaxCount}
        valueField="dailyTotalMaxCount"
        defaultValue="10"
        disabled={isSaving}
        onChange={handleFieldChange}
      />
      <ProtectionLimitRow
        title="계좌 총 최대 매수 금액"
        description="현재 보유 중인 자동매수 누적 금액과 신규 매수 금액을 합산합니다."
        unit="원"
        enabled={resolved.accountTotalMaxAmountEnabled}
        enabledField="accountTotalMaxAmountEnabled"
        value={resolved.accountTotalMaxAmount}
        valueField="accountTotalMaxAmount"
        defaultValue="1000000"
        disabled={isSaving}
        onChange={handleFieldChange}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          onClick={handleSave}
          disabled={isSaving || !isDirty}
          variant="primary"
          dense
          aria-label="보호 한도 저장"
        >
          저장
        </Button>
      </div>
    </section>
  );
};
