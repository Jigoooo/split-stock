import type { BalanceStageCellMode } from '@renderer/entities/display-settings';
import { STRATEGY_AUTO_MODE_OPTIONS } from '@renderer/features/edit-strategy';
import { useSafetySwitch } from '@renderer/features/safety-switch';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Select, TableGrid } from '@renderer/shared/ui';
import { deriveStrategyAutoMode, type StrategyAutoMode } from '@shared/contracts/strategy';
import { type CSSProperties, forwardRef, type ReactElement, useTransition } from 'react';
import { POSITION_COLS } from '../config/position-cols';
import { formatKrw, formatSigned, getPnlColorClass } from '../lib/position-row-format';
import { usePositionAutoMode } from '../model/use-position-auto-mode';
import type { PositionsGridRow } from '../model/use-positions-grid';
import { ExpandedLots } from './expanded-lots';
import { PositionStageCells } from './position-stage-cells';

export interface PositionRowProps {
  row: PositionsGridRow;
  virtualIndex: number;
  gridMaxStages: number;
  selectedPdno: string | null;
  expanded: boolean;
  onToggleExpand: (pdno: string) => void;
  onSelect: (pdno: string) => void;
  style?: CSSProperties;
  accountId: number;
  stageCellMode: BalanceStageCellMode;
}

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
    const { lots, position, strategyMeta } = row;
    const [isPending, startTransition] = useTransition();
    const autoMode = strategyMeta ? deriveStrategyAutoMode(strategyMeta) : 'ALL_OFF';
    const autoModeMutation = usePositionAutoMode(position.code, autoMode);
    const safety = useSafetySwitch();
    const orderingBlocked =
      safety.snapshot !== null &&
      (safety.snapshot.master === false || safety.snapshot.errorLock.active);
    const blockedReason = orderingBlocked
      ? safety.snapshot?.errorLock.active
        ? `에러 잠금: ${safety.snapshot.errorLock.reason ?? '원인 불명'}`
        : '주문이 차단되어 있어 자동매매가 발동되지 않습니다'
      : undefined;
    const isSelected = selectedPdno === position.code;
    const pnlColorClass = getPnlColorClass(position.pnlAmount);
    const buyAmount = position.qty * position.avgPrice;

    const handleToggle = (): void => {
      startTransition(() => onToggleExpand(position.code));
    };

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
              onClick={(event) => {
                event.stopPropagation();
                handleToggle();
              }}
              disabled={isPending}
              style={expandBtnFullStyle}
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
          <TableGrid.Cell
            width={POSITION_COLS.auto}
            className={
              orderingBlocked
                ? 'positions-table__auto-cell positions-table__auto-cell--blocked'
                : 'positions-table__auto-cell'
            }
            {...(blockedReason ? { title: blockedReason } : {})}
          >
            <Select
              value={autoModeMutation.displayMode}
              aria-label={
                orderingBlocked
                  ? `${position.name} 자동매매 상태 — ${blockedReason}`
                  : `${position.name} 자동매매 상태`
              }
              className="positions-table__auto-select"
              dense
              disabled={orderingBlocked}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                autoModeMutation.setAutoMode({
                  accountId,
                  pdno: position.code,
                  mode: event.target.value as StrategyAutoMode,
                });
              }}
              style={{ minWidth: '100%' }}
            >
              {STRATEGY_AUTO_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </TableGrid.Cell>
          <PositionStageCells
            currentPrice={position.currentPrice}
            gridMaxStages={gridMaxStages}
            lots={lots}
            stageCellMode={stageCellMode}
          />
        </TableGrid.Row>

        {expanded ? <ExpandedLots lots={lots} /> : null}
      </div>
    );
  },
);

const expandBtnFullStyle: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(232,236,242,0.95))',
  border: 'none',
  borderRadius: 0,
  width: '100%',
  height: '100%',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '1rem',
  lineHeight: 1,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
