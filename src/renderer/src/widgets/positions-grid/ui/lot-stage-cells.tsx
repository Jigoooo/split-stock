import type { LotEntry } from '@renderer/entities/account';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { ReactElement } from 'react';

export interface LotStageCellsProps {
  lots: LotEntry[];
  /** 그리드 전체 차수 컬럼 수 — 비어있는 차수는 빈 셀로 채움. */
  gridMaxStages: number;
}

/**
 * 1~N차 셀 — 종목 행 한 줄 안에서 1차부터 gridMaxStages 까지 차수별 매수가/수량을 컴팩트하게 표시.
 * - 비어있는 차수는 빈 셀.
 * - status === 'OPEN' / 'BUYING' 차수만 노출 (서버에서 이미 open/buying 만 내려줌)
 * - 표시 형식: 매수가\n×수량 (2줄)
 */
export const LotStageCells = (props: LotStageCellsProps): ReactElement[] => {
  const { gridMaxStages, lots } = props;
  const lotByNth = new Map<number, LotEntry>();
  for (const lot of lots) lotByNth.set(lot.nth, lot);

  const cells: ReactElement[] = [];
  for (let nth = 1; nth <= gridMaxStages; nth += 1) {
    const lot = lotByNth.get(nth);
    if (!lot) {
      cells.push(
        <td key={nth} className="num muted">
          {'\u00A0'}
        </td>,
      );
      continue;
    }
    cells.push(
      <td key={nth} className="num" title={`${nth}차 · ${lot.status}`}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span>{thousandSeparator(lot.buyPrice)}</span>
          <span className="muted" style={{ fontSize: '0.95em' }}>
            ×{thousandSeparator(lot.qty)}
          </span>
        </div>
      </td>,
    );
  }
  return cells;
};
