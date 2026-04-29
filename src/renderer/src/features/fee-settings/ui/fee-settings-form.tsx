import type { FeeEnv, FeeSettings } from '@renderer/entities/fee-settings';
import { useGetFeeSettings, useUpdateFeeSettings } from '@renderer/entities/fee-settings';
import { Button, NumberInput } from '@renderer/shared/ui';
import { type ReactElement, useEffect, useState } from 'react';

const DEFAULT_FEES: Record<FeeEnv, FeeSettings> = {
  real: { buy: 0.015, sell: 0.015, tax: 0.2 },
  mock: { buy: 0.35, sell: 0.35, tax: 0.2 },
};

export interface FeeSettingsFormProps {
  /** 현재 활성 환경. 자동매매 영향이 있는 환경의 수수료만 표시/수정. */
  env: FeeEnv;
}

/**
 * 단일 환경(real | mock)의 매입/매도 수수료 + 제세금 입력 폼.
 * 환경별 분리 저장 — env 가 바뀌면 이 컴포넌트가 자동으로 새 환경 데이터를 로드.
 */
export const FeeSettingsForm = ({ env }: FeeSettingsFormProps): ReactElement => {
  const { data, isPending, error } = useGetFeeSettings(env);
  const updateMutation = useUpdateFeeSettings();

  const [form, setForm] = useState<FeeSettings>(DEFAULT_FEES[env]);
  const [savedForm, setSavedForm] = useState<FeeSettings>(DEFAULT_FEES[env]);

  useEffect(() => {
    const next = data ?? DEFAULT_FEES[env];
    setForm(next);
    setSavedForm(next);
  }, [data, env]);

  const handleChange = (field: keyof FeeSettings, value: number): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = (): void => {
    void updateMutation.mutateAsync({ env, ...form }).then(() => {
      setSavedForm(form);
    });
  };

  const handleReset = (): void => {
    setForm(savedForm);
  };

  if (isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">수수료 설정 로드 중…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down" role="alert">
            오류: {error instanceof Error ? error.message : '알 수 없는 오류'}
          </span>
        </div>
      </div>
    );
  }

  const envLabel = env === 'real' ? 'PROD 환경' : 'MOCK 환경';
  const isSaving = updateMutation.isPending;
  const isDirty =
    form.buy !== savedForm.buy || form.sell !== savedForm.sell || form.tax !== savedForm.tax;

  return (
    <div className="panel">
      <div className="panel__title">
        <span>수수료 / 제세금</span>
        <span
          className="chip"
          style={{ marginLeft: '0.5rem', fontSize: '0.85em' }}
          title={`현재 환경: ${envLabel}`}
        >
          {envLabel}
        </span>
      </div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
        <div className="muted" style={{ fontSize: '0.95rem' }}>
          자동매매 손익 계산에 직접 영향을 주는 설정입니다. 변경 후 저장하면 즉시 반영됩니다.
        </div>

        <FeeRow
          id={`fee-${env}-buy`}
          label="매입 수수료 (%)"
          hint="예: 0.015 (= 0.015%), 0.35 (= 0.35%)"
          value={form.buy}
          disabled={isSaving}
          onChange={(v) => handleChange('buy', v)}
        />
        <FeeRow
          id={`fee-${env}-sell`}
          label="매도 수수료 (%)"
          hint="예: 0.015 (= 0.015%), 0.35 (= 0.35%)"
          value={form.sell}
          disabled={isSaving}
          onChange={(v) => handleChange('sell', v)}
        />
        <FeeRow
          id={`fee-${env}-tax`}
          label="제세금 (%)"
          hint="예: 0.20 (= 0.20%)"
          value={form.tax}
          disabled={isSaving}
          onChange={(v) => handleChange('tax', v)}
        />

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button onClick={handleReset} disabled={isSaving || !isDirty} dense>
            초기화
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !isDirty} variant="primary" dense>
            {isSaving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  );
};

interface FeeRowProps {
  id: string;
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

const FeeRow = ({ id, label, hint, value, disabled, onChange }: FeeRowProps): ReactElement => (
  <div style={{ display: 'grid', gap: '0.3rem' }}>
    <label htmlFor={id} className="muted">
      {label}
    </label>
    <NumberInput
      id={id}
      showSpinner
      allowDecimal
      step={0.001}
      min={0}
      value={String(value)}
      onValueChange={(raw) => {
        const v = Number.parseFloat(raw || '0');
        onChange(Number.isFinite(v) ? v : 0);
      }}
      disabled={disabled}
      dense
    />
    <span className="muted" style={{ fontSize: '0.85em' }}>
      {hint}
    </span>
  </div>
);
