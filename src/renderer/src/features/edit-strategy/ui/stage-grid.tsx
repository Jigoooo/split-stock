import { NumberInput, TableGrid } from '@renderer/shared/ui';
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
  <section aria-label="차수별 매수 설정">
    <TableGrid.Root
      variant="hts"
      stickyHeader={false}
      overlayScrollbar={false}
      style={{ height: 'auto', maxWidth: 400, fontSize: '1.05rem' }}
    >
      <TableGrid.Header>
        <TableGrid.Cell width={48}>차수</TableGrid.Cell>
        <TableGrid.Cell flex={1}>하향 감지%</TableGrid.Cell>
        <TableGrid.Cell flex={2} numeric>
          매수금액 (원)
        </TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body>
        {rows.map((row) => (
          <TableGrid.Row key={row.stage}>
            <TableGrid.Cell width={48}>{row.stage}차</TableGrid.Cell>
            <TableGrid.Cell flex={1}>{row.dropPct}%</TableGrid.Cell>
            <TableGrid.Cell flex={2} numeric>
              {row.amountKrw !== '' ? Number(row.amountKrw).toLocaleString() : '-'}
            </TableGrid.Cell>
          </TableGrid.Row>
        ))}
      </TableGrid.Body>
    </TableGrid.Root>
  </section>
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
