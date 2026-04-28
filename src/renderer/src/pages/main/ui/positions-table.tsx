import type { BalanceStageCellMode } from '@renderer/entities/display-settings';
import { TableGrid, useTableGridVirtual } from '@renderer/shared/ui';
import { type ReactElement, useRef, useState } from 'react';
import { POSITION_COLS } from '../config/position-cols';
import { shouldRenderInlineBalanceError, stageNumbers } from '../lib/positions-grid-format';
import type { UsePositionsGridResult } from '../model/use-positions-grid';
import { PositionRow } from './position-row';

interface PositionsTableProps {
  accountId: number;
  error: UsePositionsGridResult['error'];
  gridMaxStages: number;
  isPending: boolean;
  onSelect: ((pdno: string) => void) | undefined;
  rows: UsePositionsGridResult['rows'];
  selectedPdno: string | null;
  stageCellMode: BalanceStageCellMode;
  summary: UsePositionsGridResult['summary'];
}

export const PositionsTable = ({
  accountId,
  error,
  gridMaxStages,
  isPending,
  onSelect,
  rows,
  selectedPdno,
  stageCellMode,
  summary,
}: PositionsTableProps): ReactElement => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useTableGridVirtual({
    count: rows.length,
    estimateSize: () => 36,
    parentRef: scrollRef,
    overscan: 8,
  });
  const showInlineError = shouldRenderInlineBalanceError(
    error?.message ?? null,
    rows.length,
    summary,
  );

  const handleToggleExpand = (pdno: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pdno)) next.delete(pdno);
      else next.add(pdno);
      return next;
    });
  };

  return (
    <TableGrid.Root
      variant="hts"
      stickyHeader
      horizontalScroll
      storageKey="main-positions-table"
      className="positions-table"
      aria-label="보유 종목 테이블"
      style={{ flex: 1, minHeight: 0 }}
    >
      <TableGrid.Header>
        <TableGrid.Cell width={POSITION_COLS.expand} />
        <TableGrid.Cell width={POSITION_COLS.name}>종목명</TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.changeRate} numeric>
          등락
        </TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.qty} numeric>
          수량
        </TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.avgPrice} numeric>
          매입가
        </TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.curPrice} numeric>
          현재가
        </TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.pnlAmount} numeric>
          평가손익
        </TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.pnlRate} numeric>
          수익률
        </TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.buyAmount} numeric>
          매입금액
        </TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.evalAmount} numeric>
          평가금액
        </TableGrid.Cell>
        <TableGrid.Cell width={POSITION_COLS.auto}>자동</TableGrid.Cell>
        {stageNumbers(gridMaxStages).map((nth) => (
          <TableGrid.Cell key={`hdr-${nth}`} width={POSITION_COLS.stage} numeric>
            {nth}차
          </TableGrid.Cell>
        ))}
      </TableGrid.Header>
      <TableGrid.Body scrollRef={scrollRef}>
        {showInlineError && error ? (
          <div className="chip chip--down" role="alert" style={{ margin: '0.6rem' }}>
            {error.message}
          </div>
        ) : null}
        {isPending ? (
          <div className="muted" style={{ padding: '1rem' }}>
            로드 중…
          </div>
        ) : rows.length === 0 ? (
          <div className="muted" style={{ padding: '1rem' }}>
            보유 종목이 없습니다.
          </div>
        ) : (
          <div style={{ height: virtual.totalSize, position: 'relative', width: '100%' }}>
            {virtual.items.map((vItem) => {
              const row = rows[vItem.index];
              if (!row) return null;
              return (
                <PositionRow
                  key={vItem.key}
                  ref={virtual.measureElement}
                  row={row}
                  virtualIndex={vItem.index}
                  gridMaxStages={gridMaxStages}
                  selectedPdno={selectedPdno}
                  expanded={expanded.has(row.position.code)}
                  onToggleExpand={handleToggleExpand}
                  onSelect={(pdno) => onSelect?.(pdno)}
                  accountId={accountId}
                  stageCellMode={stageCellMode}
                  style={{
                    position: 'absolute',
                    top: vItem.start,
                    left: 0,
                    right: 0,
                  }}
                />
              );
            })}
          </div>
        )}
      </TableGrid.Body>
    </TableGrid.Root>
  );
};
