import { NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { AutoFillParams, DropBaseline, StageGridRaw, StageRow } from '../model/use-stage-grid';
import { AutoFillTool } from './auto-fill-tool';

export interface StageGridProps {
  raw: StageGridRaw;
  errors: { dropPct: string | undefined; profitPct: string | undefined };
  dropBaseline: DropBaseline;
  rows: StageRow[];
  maxStages: number;
  disabled?: boolean | undefined;
  onUpdate: (key: keyof StageGridRaw) => (value: string) => void;
  onToggleDropBaseline: () => void;
  onAutoFill: (params: AutoFillParams) => void;
}

/**
 * 차수별 하향매수 비율 / 익절 비율 그리드.
 * - 글로벌 비율 입력 (dropPct / profitPct)
 * - 감지% 자동입력 도구 (E3): AutoFillTool 인라인 포함
 * - autoFill 후 차수별 rows 표시
 * - dropBaseline: 'PREV_LOT' = 직전차수 기준, 'FIRST_LOT' = 처음매수가 기준
 */
export const StageGrid = (props: StageGridProps): ReactElement => {
  const {
    raw,
    errors,
    dropBaseline,
    rows,
    maxStages,
    disabled,
    onUpdate,
    onToggleDropBaseline,
    onAutoFill,
  } = props;

  return (
    <section aria-label="차수 그리드">
      {/* 하향매수 기준 토글 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
        <span className="muted" style={{ fontSize: '1.1rem' }}>
          하향매수 기준
        </span>
        <button
          type="button"
          onClick={onToggleDropBaseline}
          disabled={disabled}
          aria-label={`하향매수 기준: ${dropBaseline === 'PREV_LOT' ? '직전차수' : '처음매수가'}`}
          style={{ fontSize: '1.1rem', cursor: 'pointer' }}
        >
          {dropBaseline === 'PREV_LOT' ? '직전차수' : '처음매수가'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: '0.8rem' }}>
        {/* 글로벌 비율 입력 */}
        <StageGridField
          id="strategy-drop-pct"
          label="하향매수 비율 (%)"
          value={raw.dropPct}
          onValueChange={onUpdate('dropPct')}
          error={errors.dropPct}
          allowDecimal
          inputMode="decimal"
          disabled={disabled}
        />
        <StageGridField
          id="strategy-profit-pct"
          label="익절 비율 (%)"
          value={raw.profitPct}
          onValueChange={onUpdate('profitPct')}
          error={errors.profitPct}
          allowDecimal
          inputMode="decimal"
          disabled={disabled}
        />

        {/* 감지% 자동입력 도구 (E3) */}
        <AutoFillTool
          dropBaseline={dropBaseline}
          maxStages={maxStages}
          disabled={disabled}
          onAutoFill={onAutoFill}
        />

        {/* 자동 채우기 후 차수별 rows 표시 */}
        {rows.length > 0 ? <StageRowsTable rows={rows} /> : null}
      </div>
    </section>
  );
};

/* ── 차수별 rows 테이블 ── */

const StageRowsTable = ({ rows }: { rows: StageRow[] }): ReactElement => (
  <section aria-label="차수별 매수 설정" style={{ overflowX: 'auto' }}>
    <table
      style={{
        fontSize: '1.05rem',
        borderCollapse: 'collapse',
        width: '100%',
        maxWidth: 400,
      }}
    >
      <caption style={{ display: 'none' }}>차수별 매수 설정</caption>
      <thead>
        <tr>
          <Th>차수</Th>
          <Th>하향 감지%</Th>
          <Th>매수금액 (원)</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.stage}>
            <Td>{row.stage}차</Td>
            <Td>{row.dropPct}%</Td>
            <Td>{row.amountKrw !== '' ? Number(row.amountKrw).toLocaleString() : '-'}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

const Th = ({ children }: { children: React.ReactNode }): ReactElement => (
  <th style={{ textAlign: 'left', padding: '2px 8px 2px 0', opacity: 0.7, fontWeight: 500 }}>
    {children}
  </th>
);

const Td = ({ children }: { children: React.ReactNode }): ReactElement => (
  <td style={{ padding: '2px 8px 2px 0' }}>{children}</td>
);

/* ── 글로벌 비율 입력 필드 ── */

interface StageGridFieldProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error: string | undefined;
  allowDecimal?: boolean | undefined;
  inputMode?: 'numeric' | 'decimal' | undefined;
  disabled?: boolean | undefined;
}

const StageGridField = (p: StageGridFieldProps): ReactElement => (
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
      disabled={p.disabled}
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
