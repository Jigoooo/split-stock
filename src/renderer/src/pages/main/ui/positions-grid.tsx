import {
  type BalanceStageCellMode,
  useGetDisplaySettings,
  useUpdateDisplaySettings,
} from '@renderer/entities/display-settings';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, Select, TableGrid, useTableGridVirtual } from '@renderer/shared/ui';
import { type ReactElement, useRef, useState } from 'react';
import { usePositionsGrid } from '../model/use-positions-grid';
import { POSITION_COLS, PositionRow } from './position-row';

const STAGE_CELL_MODE_OPTIONS = [
  { value: 'PERCENT', label: '수익률' },
  { value: 'DATE', label: '날짜' },
  { value: 'QTY', label: '수량' },
] as const satisfies ReadonlyArray<{ value: BalanceStageCellMode; label: string }>;

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
  const { error, gridMaxStages, isPending, mismatches, rows, summary, syncStatus } =
    usePositionsGrid();
  const showInlineError = shouldRenderInlineBalanceError(
    error?.message ?? null,
    rows.length,
    summary,
  );
  const utils = trpc.useUtils();
  const displaySettings = useGetDisplaySettings();
  const updateDisplaySettings = useUpdateDisplaySettings();
  const stageCellMode: BalanceStageCellMode =
    displaySettings.settings?.grid.stageCellMode ?? 'PERCENT';

  const syncCurrentState = trpc.account.syncCurrentState.useMutation({
    onMutate: () => {
      console.info('[PositionsGrid] syncCurrentState requested', {
        accountId: props.accountId,
      });
    },
    onSuccess: (result) => {
      console.info('[PositionsGrid] syncCurrentState accepted', result);
      void Promise.all([
        utils.account.getBalanceWithLots.invalidate(),
        utils.account.getPositionOverlay.invalidate(),
        utils.lots.cyclesByPdno.invalidate(),
        utils.lots.tradeHistory.invalidate(),
        utils.order.listActive.invalidate(),
        utils.order.listMyFills.invalidate(),
      ]);
    },
    onError: (error) => {
      console.error('[PositionsGrid] syncCurrentState failed', error);
    },
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showMismatchDetails, setShowMismatchDetails] = useState(false);

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
      <div
        className="panel__title"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.8rem',
          flexWrap: 'wrap',
        }}
      >
        <span>보유 종목 ({thousandSeparator(rows.length)}건)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="muted" style={{ fontSize: '1rem' }}>
            차수 표시
          </span>
          <Select
            dense
            aria-label="차수 셀 표시 방식"
            value={stageCellMode}
            disabled={updateDisplaySettings.isPending}
            onChange={(event) => {
              void updateDisplaySettings.mutateAsync({
                grid: { stageCellMode: event.target.value as BalanceStageCellMode },
              });
            }}
            style={{ minWidth: '7rem' }}
          >
            {STAGE_CELL_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div
        className="panel__body"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))',
          gap: '0.5rem',
          flexShrink: 0,
        }}
      >
        <SummaryCard label="예수금" value={formatKrw(summary.deposit)} />
        <SummaryCard label="예수금 + 2" value={formatKrw(summary.d2Deposit)} />
        <SummaryCard label="총매입금액" value={formatKrw(summary.totalBuyAmount)} />
        <SummaryCard label="총평가금액" value={formatKrw(summary.totalEval)} />
        <SummaryCard
          label="총평가손익"
          value={formatSigned(summary.totalPnlAmount)}
          {...(numberClassName(summary.totalPnlAmount)
            ? { className: numberClassName(summary.totalPnlAmount) }
            : {})}
        />
        <SummaryCard
          label="수익률"
          value={`${summary.totalPnlRate.toFixed(2)}%`}
          {...(numberClassName(summary.totalPnlAmount)
            ? { className: numberClassName(summary.totalPnlAmount) }
            : {})}
        />
        <SummaryCard label="추정자산" value={formatKrw(summary.estimatedAsset)} />
      </div>
      {syncStatus === 'MISMATCH' ? (
        <div style={{ flexShrink: 0 }}>
          <div
            className="panel__body"
            style={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: '0.6rem' }}
          >
            <span className="chip chip--down" role="status">
              KIS 잔고와 차수 장부 불일치 {thousandSeparator(mismatches.length)}건
            </span>
            <Button
              dense
              disabled={syncCurrentState.isPending}
              onClick={() => void syncCurrentState.mutateAsync({ accountId: props.accountId })}
            >
              {syncCurrentState.isPending ? '동기화 중…' : '동기화'}
            </Button>
            <Button
              dense
              onClick={() => setShowMismatchDetails((current) => !current)}
              aria-expanded={showMismatchDetails}
            >
              {showMismatchDetails ? '상세 숨기기' : '상세 보기'}
            </Button>
          </div>
          {showMismatchDetails ? (
            <div className="panel__body muted" style={{ display: 'grid', gap: '0.3rem' }}>
              {mismatches.map((mismatch) => (
                <div key={`${mismatch.pdno}:${mismatch.reason}`}>
                  <span className="num">{mismatch.pdno}</span>
                  {' · '}
                  {describeMismatchReason(mismatch.reason)}
                  {' · KIS '}
                  <span className="num">{thousandSeparator(mismatch.kisQty)}주</span>
                  {' / lot '}
                  <span className="num">{thousandSeparator(mismatch.lotQty)}주</span>
                </div>
              ))}
            </div>
          ) : null}
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
                    onSelect={handleSelect}
                    accountId={props.accountId}
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
    </section>
  );
};

function stageNumbers(count: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= count; n += 1) out.push(n);
  return out;
}

function shouldRenderInlineBalanceError(
  message: string | null,
  rowCount: number,
  summary: {
    deposit: number;
    d2Deposit: number;
    totalBuyAmount: number;
    totalEval: number;
    estimatedAsset: number;
  },
): boolean {
  if (!message) return false;
  const hasSnapshot =
    rowCount > 0 ||
    summary.deposit > 0 ||
    summary.d2Deposit > 0 ||
    summary.totalBuyAmount > 0 ||
    summary.totalEval > 0 ||
    summary.estimatedAsset > 0;
  if (!hasSnapshot) return true;

  return !isTransientBalanceError(message);
}

function isTransientBalanceError(message: string): boolean {
  return (
    message.startsWith('잔고조회 요청이 너무 많습니다.') ||
    message.startsWith('잔고 서버에 일시적인 문제가 있습니다.')
  );
}

function describeMismatchReason(reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH'): string {
  switch (reason) {
    case 'NO_LOTS':
      return '잔고는 있는데 차수 장부가 없음';
    case 'STALE_LOTS':
      return '차수 장부만 남아 있음';
    case 'QTY_MISMATCH':
      return '수량 불일치';
  }
}

const SummaryCard = ({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string | undefined;
}): ReactElement => (
  <div
    style={{
      border: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(246,248,252,0.98))',
      borderRadius: 6,
      padding: '0.45rem 0.6rem',
      minWidth: 0,
    }}
  >
    <div className="muted" style={{ fontSize: '0.95rem' }}>
      {label}
    </div>
    <div
      className={className}
      style={{
        marginTop: '0.15rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {value}
    </div>
  </div>
);

function formatKrw(value: number): string {
  return thousandSeparator(Math.round(value));
}

function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${thousandSeparator(Math.round(value))}`;
}

function numberClassName(value: number): string | undefined {
  if (value > 0) return 'num-up';
  if (value < 0) return 'num-down';
  return 'num-flat';
}
