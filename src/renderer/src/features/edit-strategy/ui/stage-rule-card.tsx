import { NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { StageRuleChangeFactory, StageRuleRowRaw } from '../model/strategy-form-types';

/**
 * 원 단위 금액을 한국식 보조 표기로. 1억 이상 "X.XX억", 1만 이상 "X,XXX만",
 * 그 외엔 빈 문자열 (보조 표시 불필요).
 */
function formatKrwShort(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10_000) return '';
  if (n >= 100_000_000) {
    const v = n / 100_000_000;
    return `≈ ${v >= 10 ? v.toFixed(0) : v.toFixed(2)}억`;
  }
  return `≈ ${Math.round(n / 10_000).toLocaleString()}만`;
}

interface StageRuleCardProps {
  disabled: boolean;
  inactive: boolean;
  onChange: StageRuleChangeFactory;
  row: StageRuleRowRaw;
}

export const STAGE_RULE_CARD_COLUMNS = '4rem minmax(0, 1.2fr) minmax(13rem, 0.8fr)';
export const STAGE_RULE_SCROLLBAR_GUTTER = '0.85rem';

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
      gridTemplateColumns: STAGE_RULE_CARD_COLUMNS,
      alignItems: 'stretch',
      border: '1px solid var(--border)',
      borderRadius: '0.35rem',
      background: inactive ? 'var(--bg-3)' : 'var(--bg)',
      opacity: inactive ? 0.72 : 1,
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.55rem 0.65rem',
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-2)',
        fontWeight: 600,
      }}
    >
      {row.nth}차
    </div>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.55rem 0.75rem',
        borderRight: '1px solid var(--border)',
      }}
    >
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
              style={{ width: '4.8rem' }}
            />
            <span style={{ whiteSpace: 'nowrap' }}>% 하락시 {row.nth}차 매수</span>
          </>
        )}
      </div>
      <div
        title={formatKrwShort(row.amountKrw) || undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          flex: '0 0 auto',
          whiteSpace: 'nowrap',
        }}
      >
        <NumberInput
          value={row.amountKrw}
          onValueChange={onChange(row.nth, 'amountKrw')}
          dense
          inputMode="numeric"
          disabled={disabled}
          aria-label={`${row.nth}차 매수금액`}
          style={{ width: '9.5rem' }}
        />
        <span>원</span>
      </div>
    </div>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.55rem 0.75rem',
        minWidth: 0,
        whiteSpace: 'nowrap',
      }}
    >
      <NumberInput
        value={row.targetProfitPct}
        onValueChange={onChange(row.nth, 'targetProfitPct')}
        dense
        allowDecimal
        inputMode="decimal"
        disabled={disabled}
        aria-label={`${row.nth}차 자동매도 익절률`}
        style={{ width: '4.8rem' }}
      />
      <span>% 수익시 {row.nth}차 매도</span>
    </div>
  </div>
);
