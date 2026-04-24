import type { LotEntry } from '@renderer/entities/account';
import type { BalanceStageCellMode } from '@renderer/entities/display-settings';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { POSITION_COLS } from '../config/position-cols';
import { formatStageCell, formatStageTitle } from '../lib/position-row-format';

interface PositionStageCellsProps {
  currentPrice: number;
  gridMaxStages: number;
  lots: LotEntry[];
  stageCellMode: BalanceStageCellMode;
}

export const PositionStageCells = ({
  currentPrice,
  gridMaxStages,
  lots,
  stageCellMode,
}: PositionStageCellsProps): ReactElement[] => {
  const lotByNth = new Map<number, LotEntry>();
  for (const lot of lots) lotByNth.set(lot.nth, lot);

  const cells: ReactElement[] = [];
  for (let nth = 1; nth <= gridMaxStages; nth += 1) {
    const lot = lotByNth.get(nth);
    if (!lot) {
      cells.push(
        <TableGrid.Cell key={`stage-${nth}`} width={POSITION_COLS.stage} numeric className="muted">
          {'\u00A0'}
        </TableGrid.Cell>,
      );
      continue;
    }

    const stagePnlRate =
      lot.buyPrice > 0 ? ((currentPrice - lot.buyPrice) / lot.buyPrice) * 100 : null;
    const stagePnlClass =
      stagePnlRate === null
        ? 'num-flat'
        : stagePnlRate > 0
          ? 'num-up'
          : stagePnlRate < 0
            ? 'num-down'
            : 'num-flat';
    const cellClassName =
      stageCellMode === 'PERCENT' ? stagePnlClass : stageCellMode === 'DATE' ? 'muted' : undefined;

    cells.push(
      <TableGrid.Cell
        key={`stage-${nth}`}
        width={POSITION_COLS.stage}
        numeric
        title={formatStageTitle(nth, lot, stagePnlRate)}
        {...(cellClassName ? { className: cellClassName } : {})}
      >
        {formatStageCell(stageCellMode, lot, stagePnlRate)}
      </TableGrid.Cell>,
    );
  }

  return cells;
};
