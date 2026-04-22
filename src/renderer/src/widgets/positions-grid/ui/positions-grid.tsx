import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { TableGrid, useTableGridVirtual } from '@renderer/shared/ui';
import { type ReactElement, useRef, useState } from 'react';
import { usePositionsGrid } from '../model/use-positions-grid';
import { POSITION_COLS, PositionRow } from './position-row';

export interface PositionsGridProps {
  /** 활성 계좌 ID — Wave 4 cutover 시 props 로 주입. 본 wave 는 entity hook 의 active 계좌 사용. */
  accountId: number;
  selectedPdno?: string | null;
  onSelect?: (pdno: string) => void;
}

/**
 * 보유 종목 그리드 — 종목별 차수(lot) expand 지원.
 *
 * 구조:
 *   - TableGrid.Root(variant=hts) + Header(sticky) + Body
 *   - useTableGridVirtual 로 가상화. 각 PositionRow 는 forwardRef 로 measureElement 부착
 *   - expand 시 sub-row 가 추가되면 measureElement 가 자동으로 새 높이 측정
 */
export const PositionsGrid = (props: PositionsGridProps): ReactElement => {
  const { onSelect, selectedPdno = null } = props;
  const { error, gridMaxStages, isPending, mismatches, rows, syncStatus } = usePositionsGrid();

  // 종목별 자동매매 상태 — grid 레벨 1회 조회
  const safetyState = trpc.safety.getState.useQuery(
    { accountId: props.accountId },
    { refetchInterval: 3000 },
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useTableGridVirtual({
    count: rows.length,
    estimateSize: () => 36, // expand 시 measureElement 가 정확한 높이 갱신
    parentRef: scrollRef,
    overscan: 8,
  });

  const handleToggleExpand = (pdno: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pdno)) next.delete(pdno);
      else next.add(pdno);
      return next;
    });
  };

  const handleSelect = (pdno: string): void => {
    onSelect?.(pdno);
  };

  return (
    <section
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
      aria-label={`보유 종목 그리드 (계좌 ${props.accountId})`}
    >
      <div className="panel__title" style={{ flexShrink: 0 }}>
        보유 종목 ({thousandSeparator(rows.length)}건)
      </div>
      {syncStatus === 'MISMATCH' ? (
        <div className="panel__body" style={{ flexShrink: 0 }}>
          <span className="chip chip--down" role="status">
            KIS 잔고와 차수 장부 불일치 {thousandSeparator(mismatches.length)}건
          </span>
        </div>
      ) : null}

      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
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
          {error ? (
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
                    onSelect={handleSelect}
                    accountId={props.accountId}
                    autoOn={safetyState.data?.bySymbol[row.position.code] ?? null}
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
    </section>
  );
};

function stageNumbers(count: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= count; n += 1) out.push(n);
  return out;
}
