import type { LotEntry } from '@renderer/entities/account';
import type { BalanceStageCellMode } from '@renderer/entities/display-settings';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { TableGrid } from '@renderer/shared/ui';
import { deriveStrategyAutoMode, type StrategyAutoMode } from '@shared/contracts/strategy';
import { type CSSProperties, forwardRef, type ReactElement, useTransition } from 'react';
import type { PositionsGridRow } from '../model/use-positions-grid';

export interface PositionRowProps {
  row: PositionsGridRow;
  /** @tanstack/react-virtual 측정용 index */
  virtualIndex: number;
  /** 그리드 전체 차수 컬럼 수. */
  gridMaxStages: number;
  /** 현재 선택된 종목 코드 (시각적 강조용). */
  selectedPdno: string | null;
  /** 현재 expand 상태. */
  expanded: boolean;
  /** [+] 클릭 → expand toggle. useTransition 으로 deferred 처리. */
  onToggleExpand: (pdno: string) => void;
  /** 행 클릭 → 종목 선택. */
  onSelect: (pdno: string) => void;
  /** 가상화 absolute positioning style. */
  style?: CSSProperties;
  /** 활성 계좌 ID — toggleSymbol mutation 에 필요. */
  accountId: number;
  stageCellMode: BalanceStageCellMode;
}

/** 컬럼 정의 — Header(positions-grid) 와 Row(position-row) 가 공유. */
export const POSITION_COLS = {
  expand: 38,
  name: 128,
  changeRate: 68,
  qty: 80,
  avgPrice: 96,
  curPrice: 96,
  pnlAmount: 112,
  pnlRate: 68,
  buyAmount: 128,
  evalAmount: 128,
  auto: 122,
  stage: 72,
} as const;

/**
 * 한 종목 행. 메인 행 + (expanded 면) 차수별 sub-row.
 *
 * forwardRef 로 가상화 measureElement 를 받음 — expand 시 동적 높이 측정.
 */
export const PositionRow = forwardRef<HTMLDivElement, PositionRowProps>(
  function PositionRow(props, ref): ReactElement {
    const {
      accountId,
      expanded,
      gridMaxStages,
      onSelect,
      onToggleExpand,
      row,
      selectedPdno,
      stageCellMode,
      style,
      virtualIndex,
    } = props;
    const [isPending, startTransition] = useTransition();

    const utils = trpc.useUtils();
    const setAutoModeQuick = trpc.strategy.setAutoModeQuick.useMutation({
      onSuccess: async () => {
        await Promise.all([
          utils.account.getBalanceWithLots.invalidate(),
          utils.strategy.getActive.invalidate({ pdno: position.code }),
        ]);
      },
    });
    const { lots, position, strategyMeta } = row;
    const isSelected = selectedPdno === position.code;
    const autoMode = strategyMeta ? deriveStrategyAutoMode(strategyMeta) : 'ALL_ON';

    const sign = position.pnlAmount === 0 ? 'flat' : position.pnlAmount > 0 ? 'up' : 'down';
    const pnlColorClass = sign === 'up' ? 'num-up' : sign === 'down' ? 'num-down' : 'num-flat';

    const buyAmount = position.qty * position.avgPrice;

    const handleToggle = (): void => {
      startTransition(() => onToggleExpand(position.code));
    };

    // 차수별 셀 (1차 ~ N차) — 비어있는 차수는 빈 셀
    const lotByNth = new Map<number, LotEntry>();
    for (const lot of lots) lotByNth.set(lot.nth, lot);

    const stageCells: ReactElement[] = [];
    for (let nth = 1; nth <= gridMaxStages; nth += 1) {
      const lot = lotByNth.get(nth);
      if (!lot) {
        stageCells.push(
          <TableGrid.Cell
            key={`stage-${nth}`}
            width={POSITION_COLS.stage}
            numeric
            className="muted"
          >
            {'\u00A0'}
          </TableGrid.Cell>,
        );
        continue;
      }
      const stagePnlRate =
        lot.buyPrice > 0 ? ((position.currentPrice - lot.buyPrice) / lot.buyPrice) * 100 : null;
      const stagePnlClass =
        stagePnlRate === null
          ? 'num-flat'
          : stagePnlRate > 0
            ? 'num-up'
            : stagePnlRate < 0
              ? 'num-down'
              : 'num-flat';
      const stageText = formatStageCell(stageCellMode, nth, lot, stagePnlRate);
      const stageTitle = formatStageTitle(nth, lot, stagePnlRate);
      const cellClassName =
        stageCellMode === 'PERCENT'
          ? stagePnlClass
          : stageCellMode === 'DATE'
            ? 'muted'
            : undefined;
      stageCells.push(
        <TableGrid.Cell
          key={`stage-${nth}`}
          width={POSITION_COLS.stage}
          numeric
          title={stageTitle}
          {...(cellClassName ? { className: cellClassName } : {})}
        >
          {stageText}
        </TableGrid.Cell>,
      );
    }

    return (
      <div ref={ref} style={style} data-index={virtualIndex} data-position-row={position.code}>
        <TableGrid.Row
          selected={isSelected}
          expanded={expanded}
          onClick={() => onSelect(position.code)}
          {...(isSelected
            ? {
                style: {
                  background: 'var(--accent-tint-12)',
                  boxShadow: 'inset 0.2rem 0 0 0 var(--accent)',
                },
              }
            : {})}
        >
          <TableGrid.Cell width={POSITION_COLS.expand}>
            <button
              type="button"
              aria-label={expanded ? '차수 접기' : '차수 펼치기'}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
              disabled={isPending}
              style={expandBtnStyle}
            >
              {expanded ? '−' : '+'}
            </button>
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.name}>{position.name}</TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.changeRate} numeric className={pnlColorClass}>
            {position.pnlRate.toFixed(2)}%
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.qty} numeric>
            {thousandSeparator(position.qty)}
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.avgPrice} numeric>
            {formatKrw(position.avgPrice)}
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.curPrice} numeric>
            {formatKrw(position.currentPrice)}
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.pnlAmount} numeric className={pnlColorClass}>
            {formatSigned(position.pnlAmount)}
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.pnlRate} numeric className={pnlColorClass}>
            {position.pnlRate.toFixed(2)}%
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.buyAmount} numeric>
            {thousandSeparator(Math.round(buyAmount))}
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.evalAmount} numeric>
            {thousandSeparator(Math.round(position.evalAmount))}
          </TableGrid.Cell>
          <TableGrid.Cell width={POSITION_COLS.auto}>
            <select
              className="hts-input hts-input--dense"
              value={autoMode}
              disabled={setAutoModeQuick.isPending}
              aria-label={`${position.name} 자동매매 상태`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                setAutoModeQuick.mutate({
                  accountId,
                  pdno: position.code,
                  mode: event.target.value as StrategyAutoMode,
                });
              }}
              style={{ minWidth: '8.8rem' }}
            >
              <option value="ALL_ON">전체 ON</option>
              <option value="ALL_OFF">전체 OFF</option>
              <option value="BUY_ONLY">매수만 ON</option>
              <option value="SELL_ONLY">매도만 ON</option>
            </select>
          </TableGrid.Cell>
          {stageCells}
        </TableGrid.Row>

        {/* expand: 차수별 상세 sub-row (가상화 행 안에서 동적 높이 — measureElement 가 처리) */}
        {expanded ? <ExpandedLots lots={lots} /> : null}
      </div>
    );
  },
);

function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${thousandSeparator(Math.round(value))}`;
}

function formatKrw(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return thousandSeparator(Math.round(value));
}

function formatStageCell(
  mode: BalanceStageCellMode,
  _nth: number,
  lot: LotEntry,
  stagePnlRate: number | null,
): string {
  switch (mode) {
    case 'DATE':
      return new Date(lot.boughtAt).toLocaleDateString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
      });
    case 'QTY':
      return thousandSeparator(lot.qty);
    case 'PERCENT':
      return stagePnlRate === null ? '-' : `${stagePnlRate.toFixed(2)}%`;
  }
}

function formatStageTitle(nth: number, lot: LotEntry, stagePnlRate: number | null): string {
  return [
    `${nth}차`,
    lot.status,
    `매수일 ${new Date(lot.boughtAt).toLocaleDateString('ko-KR')}`,
    `수량 ${thousandSeparator(lot.qty)}주`,
    `수익률 ${stagePnlRate === null ? '-' : `${stagePnlRate.toFixed(2)}%`}`,
  ].join(' · ');
}

const expandBtnStyle: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(232,236,242,0.95))',
  border: '1px solid var(--hts-line, rgba(0,0,0,0.18))',
  borderRadius: 5,
  width: '1.6rem',
  height: '1.6rem',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '1rem',
  lineHeight: 1,
  padding: 0,
};

interface ExpandedLotsProps {
  lots: LotEntry[];
}

const EXPANDED_LOTS_COLS = {
  nth: 52,
  buyPrice: 100,
  qty: 80,
  amount: 120,
  status: 96,
  boughtAt: 116,
} as const;

const ExpandedLots = ({ lots }: ExpandedLotsProps): ReactElement => {
  if (lots.length === 0) {
    return (
      <div
        className="muted"
        style={{
          padding: '0.4rem 1rem',
          fontSize: '1.05rem',
          background: 'var(--hts-accent-bg, rgba(0,0,0,0.02))',
        }}
      >
        보유 차수 없음
      </div>
    );
  }
  return (
    <div
      style={{
        padding: '0.45rem 0.7rem 0.65rem',
        background: 'linear-gradient(180deg, rgba(246,248,252,0.96), rgba(239,243,249,0.98))',
        borderTop: '1px solid var(--hts-line, rgba(0,0,0,0.06))',
        borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.1))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65)',
      }}
    >
      <TableGrid.Root
        variant="hts"
        stickyHeader={false}
        overlayScrollbar={false}
        horizontalScroll
        style={{ height: 'auto', width: '100%' }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.nth}>차수</TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.buyPrice} numeric>
            매입가
          </TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.qty} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.amount} numeric>
            투입금액
          </TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.status}>상태</TableGrid.Cell>
          <TableGrid.Cell width={EXPANDED_LOTS_COLS.boughtAt}>매수일</TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {lots.map((lot) => (
            <TableGrid.Row key={`${lot.nth}-${lot.boughtAt}`}>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.nth}>{lot.nth}차</TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.buyPrice} numeric>
                {formatKrw(lot.buyPrice)}
              </TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.qty} numeric>
                {thousandSeparator(lot.qty)}
              </TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.amount} numeric>
                {thousandSeparator(Math.round(lot.amountKrw))}
              </TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.status}>{lot.status}</TableGrid.Cell>
              <TableGrid.Cell width={EXPANDED_LOTS_COLS.boughtAt} className="muted">
                {new Date(lot.boughtAt).toLocaleDateString('ko-KR')}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
        </TableGrid.Body>
      </TableGrid.Root>
    </div>
  );
};
