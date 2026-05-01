import { EmptyState, TableGrid } from '@renderer/shared/ui';
import type { CSSProperties, ReactElement } from 'react';

interface PreviewEntry {
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
}

interface OriginalEntry {
  nth: number;
  buyPrice: number;
  qty: number;
}

interface Props {
  entries: PreviewEntry[];
  originals: OriginalEntry[] | undefined;
}

/**
 * 차수별 변경 전/후 비교 테이블. 변경된 행만 highlight.
 */
export const PriceRatioPreviewTable = ({ entries, originals }: Props): ReactElement => {
  if (entries.length === 0) {
    return <EmptyState dense title="미리보기 데이터가 없습니다" />;
  }

  return (
    <TableGrid.Root
      variant="hts"
      horizontalScroll
      overlayScrollbar={false}
      aria-label="차수별 변경 전후 비교"
      style={{ height: 'auto', '--hts-row-height': '3rem' } as CSSProperties}
    >
      <TableGrid.Header>
        <TableGrid.Cell width="7.2rem" numeric>
          차수
        </TableGrid.Cell>
        <TableGrid.Cell width="11rem" numeric>
          변경 전
        </TableGrid.Cell>
        <TableGrid.Cell width="11rem" numeric>
          변경 후
        </TableGrid.Cell>
        <TableGrid.Cell width="9rem" numeric>
          수량
        </TableGrid.Cell>
        <TableGrid.Cell width="12rem" numeric>
          소계
        </TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body>
        {entries.map((entry, idx) => {
          const original = originals?.[idx];
          const changed = original?.buyPrice !== entry.buyPrice;
          return (
            <TableGrid.Row
              key={entry.nth}
              style={{ backgroundColor: changed ? 'var(--warning-soft)' : undefined }}
            >
              <TableGrid.Cell width="7.2rem" numeric>
                {entry.nth}차
              </TableGrid.Cell>
              <TableGrid.Cell width="11rem" numeric>
                {original?.buyPrice.toLocaleString()}원
              </TableGrid.Cell>
              <TableGrid.Cell width="11rem" numeric style={{ fontWeight: 700 }}>
                {entry.buyPrice.toLocaleString()}원
              </TableGrid.Cell>
              <TableGrid.Cell width="9rem" numeric>
                {entry.qty.toLocaleString()}주
              </TableGrid.Cell>
              <TableGrid.Cell width="12rem" numeric>
                {entry.amountKrw.toLocaleString()}원
              </TableGrid.Cell>
            </TableGrid.Row>
          );
        })}
      </TableGrid.Body>
    </TableGrid.Root>
  );
};
