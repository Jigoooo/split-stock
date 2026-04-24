import { NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { StageRuleChangeFactory, StageRuleRowRaw } from '../model/strategy-form-types';

interface StageRuleCardProps {
  disabled: boolean;
  inactive: boolean;
  onChange: StageRuleChangeFactory;
  row: StageRuleRowRaw;
}

export const StageRuleCard = ({
  disabled,
  inactive,
  onChange,
  row,
}: StageRuleCardProps): ReactElement => (
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
