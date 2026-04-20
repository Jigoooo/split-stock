import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactElement, useRef, useState } from 'react';
import { usePositionsGrid } from '../model/use-positions-grid';
import { PositionRow } from './position-row';

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
 *   - sticky header table (열 너비 colgroup 으로 고정)
 *   - 가상화된 body (TanStack useVirtualizer + measureElement)
 *   - 각 행은 PositionRow — expand 시 sub-row 가 동적으로 늘어나 measureElement 가 높이 재측정
 *
 * 주의:
 *   - props.accountId 는 Wave 4 에서 활용 — 현재는 useBalanceWithLots 가 useActiveAccountId 로 자체 주입.
 *   - 컬럼 너비는 colgroup 으로 PositionRow 와 동기화 (헤더/바디 정렬 보장).
 */
export const PositionsGrid = (props: PositionsGridProps): ReactElement => {
  const { onSelect, selectedPdno = null } = props;
  const { error, gridMaxStages, isPending, rows } = usePositionsGrid();

  // 종목별 자동매매 상태 — grid 레벨 1회 조회
  const safetyState = trpc.safety.getState.useQuery(
    { accountId: props.accountId },
    { refetchInterval: 3000 },
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36, // 헤더 미포함, expand 시 measureElement 가 정확한 높이 갱신
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

  const handleChartPopout = (pdno: string, name: string): void => {
    const shell = window.appShell;
    if (!shell) return;
    void shell.openPopout('trade');
    shell.assignStock(pdno, name);
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

      {/* sticky header — 가상화 영역 밖에 별도 table 로 분리 */}
      <table
        className="hts-table"
        style={{ tableLayout: 'fixed', width: '100%', flexShrink: 0 }}
        aria-hidden="true"
      >
        <colgroup>
          <col style={{ width: '2.4rem' }} />
          <col style={{ width: '8rem' }} />
          <col style={{ width: '5rem' }} />
          <col style={{ width: '5rem' }} />
          <col style={{ width: '6rem' }} />
          <col style={{ width: '6rem' }} />
          <col style={{ width: '7rem' }} />
          <col style={{ width: '5rem' }} />
          <col style={{ width: '8rem' }} />
          <col style={{ width: '8rem' }} />
          <col style={{ width: '3.2rem' }} />
          {stageNumbers(gridMaxStages).map((nth) => (
            <col key={`hdr-stage-${nth}`} style={{ width: '5.5rem' }} />
          ))}
          <col style={{ width: '2.8rem' }} />
        </colgroup>
        <thead>
          <tr>
            <th />
            <th>종목명</th>
            <th className="num">등락</th>
            <th className="num">수량</th>
            <th className="num">매입가</th>
            <th className="num">현재가</th>
            <th className="num">평가손익</th>
            <th className="num">수익률</th>
            <th className="num">매입금액</th>
            <th className="num">평가금액</th>
            <th>자동</th>
            {stageNumbers(gridMaxStages).map((nth) => (
              <th key={`hdr-${nth}`} className="num">
                {nth}차
              </th>
            ))}
            <th />
          </tr>
        </thead>
      </table>

      {/* virtualized body */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
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
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = rows[vItem.index];
              if (!row) return null;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: vItem.start,
                    left: 0,
                    right: 0,
                  }}
                >
                  <PositionRow
                    row={row}
                    gridMaxStages={gridMaxStages}
                    selectedPdno={selectedPdno}
                    expanded={expanded.has(row.position.code)}
                    onToggleExpand={handleToggleExpand}
                    onSelect={handleSelect}
                    onChartPopout={handleChartPopout}
                    accountId={props.accountId}
                    autoOn={safetyState.data?.bySymbol[row.position.code] ?? null}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

function stageNumbers(count: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= count; n += 1) out.push(n);
  return out;
}
