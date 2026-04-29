import { NumberInput, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { AutoFillParams, DropBaseline } from '../model/use-stage-grid';

export interface AutoFillToolProps {
  dropBaseline: DropBaseline;
  maxStages: number;
  disabled?: boolean | undefined;
  onAutoFill: (params: AutoFillParams) => void;
}

/**
 * 감지% 자동입력 도구 (E3).
 * - dropPctInterval 입력 + amountKrw 입력 + [1~N차 자동 채우기] 버튼
 * - 채우기 전 N차별 가격 변화 미리보기 테이블 표시
 * - dropBaseline 에 따라 PREV_LOT / FIRST_LOT 계산
 */
export const AutoFillTool = (props: AutoFillToolProps): ReactElement => {
  const { dropBaseline, maxStages, disabled, onAutoFill } = props;

  const [interval, setInterval] = useState('');
  const [amount, setAmount] = useState('');

  const intervalNum = Number(interval);
  const isValid = interval.trim().length > 0 && Number.isFinite(intervalNum) && intervalNum > 0;

  const previewRows = buildPreview({ interval, baseline: dropBaseline, maxStages });

  const handleFill = (): void => {
    if (!isValid) return;
    onAutoFill({
      dropPctInterval: interval,
      amountKrw: amount,
      baseline: dropBaseline,
      maxStages,
    });
  };

  return (
    <section
      aria-label="감지% 자동입력 도구"
      style={{
        border: '1px solid var(--border, #333)',
        borderRadius: 4,
        padding: '0.8rem',
        display: 'grid',
        gap: '0.6rem',
      }}
    >
      <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>감지% 자동입력</span>

      {/* 입력 행 */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label
          htmlFor="autofill-interval"
          style={{ display: 'grid', gap: '0.25rem', minWidth: 120 }}
        >
          <span className="muted" style={{ fontSize: '1.1rem' }}>
            감지% 간격
          </span>
          <NumberInput
            id="autofill-interval"
            value={interval}
            onValueChange={setInterval}
            aria-label="감지% 간격"
            allowDecimal
            inputMode="decimal"
            dense
            disabled={disabled}
          />
        </label>

        <label htmlFor="autofill-amount" style={{ display: 'grid', gap: '0.25rem', minWidth: 140 }}>
          <span className="muted" style={{ fontSize: '1.1rem' }}>
            매수금액 (원)
          </span>
          <NumberInput
            id="autofill-amount"
            value={amount}
            onValueChange={setAmount}
            aria-label="매수금액 (원)"
            inputMode="numeric"
            dense
            disabled={disabled}
          />
        </label>

        <button
          type="button"
          onClick={handleFill}
          disabled={disabled || !isValid}
          aria-label={`1~${maxStages}차 자동 채우기`}
          style={{
            padding: '0.3rem 0.8rem',
            fontSize: '1.1rem',
            cursor: disabled || !isValid ? 'not-allowed' : 'pointer',
            alignSelf: 'flex-end',
          }}
        >
          1~{maxStages}차 자동 채우기
        </button>
      </div>

      {/* 미리보기: interval 입력 시 즉시 표시 */}
      {isValid && previewRows.length > 0 ? (
        <PreviewTable rows={previewRows} baseline={dropBaseline} />
      ) : null}
    </section>
  );
};

/* ── 미리보기 테이블 ── */

interface PreviewTableProps {
  rows: PreviewRow[];
  baseline: DropBaseline;
}

interface PreviewRow {
  stage: number;
  dropPct: number;
  /** 100,000원 가정 시 해당 차수 매수가 */
  examplePrice: number;
}

const PreviewTable = ({ rows, baseline }: PreviewTableProps): ReactElement => {
  const baselineLabel = baseline === 'PREV_LOT' ? '직전차수 대비' : '처음매수가 기준';

  // noUncheckedIndexedAccess 대응: 명시적 필터로 undefined 제거
  const headRows: PreviewRow[] = rows.slice(0, 5).filter((r): r is PreviewRow => r !== undefined);
  const lastRow: PreviewRow | undefined =
    rows.length > 6 ? rows.filter((r): r is PreviewRow => r !== undefined).at(-1) : undefined;
  const allRows: PreviewRow[] = rows.filter((r): r is PreviewRow => r !== undefined);
  const showGap = rows.length > 6;

  return (
    <figure style={{ overflowX: 'auto', margin: 0 }}>
      <figcaption
        style={{
          textAlign: 'left',
          fontSize: '1rem',
          marginBottom: '0.25rem',
          opacity: 0.7,
        }}
      >
        미리보기 ({baselineLabel}, 1차 100,000원 가정)
      </figcaption>
      <TableGrid.Root
        aria-label="자동채우기 미리보기"
        variant="plain"
        resizable={false}
        horizontalScroll
        overlayScrollbar={false}
        style={{
          height: 'auto',
          fontSize: '1.05rem',
          width: '100%',
          maxWidth: 360,
        }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={72}>차수</TableGrid.Cell>
          <TableGrid.Cell width={100} numeric>
            하향 감지%
          </TableGrid.Cell>
          <TableGrid.Cell width={120} numeric>
            예상 매수가
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {showGap ? (
            <>
              {headRows.map((row) => (
                <PreviewGridRow key={row.stage} row={row} />
              ))}
              <TableGrid.Row key="gap">
                <TableGrid.Cell flex={1} align="center" style={{ opacity: 0.5 }}>
                  ···
                </TableGrid.Cell>
              </TableGrid.Row>
              {lastRow !== undefined ? <PreviewGridRow key={lastRow.stage} row={lastRow} /> : null}
            </>
          ) : (
            allRows.map((row) => <PreviewGridRow key={row.stage} row={row} />)
          )}
        </TableGrid.Body>
      </TableGrid.Root>
    </figure>
  );
};

const PreviewGridRow = ({ row }: { row: PreviewRow }): ReactElement => (
  <TableGrid.Row>
    <TableGrid.Cell width={72}>{row.stage}차</TableGrid.Cell>
    <TableGrid.Cell width={100} numeric>
      {row.dropPct.toFixed(2)}%
    </TableGrid.Cell>
    <TableGrid.Cell width={120} numeric>
      {Math.round(row.examplePrice).toLocaleString()}원
    </TableGrid.Cell>
  </TableGrid.Row>
);

/* ── 미리보기 계산 ── */

function buildPreview(params: {
  interval: string;
  baseline: DropBaseline;
  maxStages: number;
}): PreviewRow[] {
  const intervalNum = Number(params.interval);
  if (!Number.isFinite(intervalNum) || intervalNum <= 0) return [];

  const BASE_PRICE = 100_000;
  const rows: PreviewRow[] = [];

  let prevPrice = BASE_PRICE;
  for (let stage = 1; stage <= params.maxStages; stage++) {
    let dropPct: number;
    let price: number;

    if (params.baseline === 'FIRST_LOT') {
      // 처음매수가 기준: N차 = 1차 기준 누적 N * interval%
      dropPct = stage * intervalNum;
      price = BASE_PRICE * (1 - dropPct / 100);
    } else {
      // 직전차수 기준: 매 차수 동일 interval%
      dropPct = intervalNum;
      price = prevPrice * (1 - intervalNum / 100);
      prevPrice = price;
    }

    rows.push({ stage, dropPct, examplePrice: price });
  }

  return rows;
}
