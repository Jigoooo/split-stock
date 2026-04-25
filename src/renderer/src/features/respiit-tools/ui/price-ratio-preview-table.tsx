import type { ReactElement } from 'react';

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
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          fontSize: '0.9rem',
          borderCollapse: 'collapse',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>차수</th>
            <th style={{ textAlign: 'right', padding: '0.5rem' }}>변경 전</th>
            <th style={{ textAlign: 'right', padding: '0.5rem' }}>변경 후</th>
            <th style={{ textAlign: 'right', padding: '0.5rem' }}>수량</th>
            <th style={{ textAlign: 'right', padding: '0.5rem' }}>소계</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => {
            const original = originals?.[idx];
            return (
              <tr
                key={entry.nth}
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  backgroundColor:
                    original?.buyPrice !== entry.buyPrice ? 'var(--color-highlight-bg)' : '',
                }}
              >
                <td style={{ textAlign: 'left', padding: '0.5rem' }}>{entry.nth}차</td>
                <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                  {original?.buyPrice.toLocaleString()}원
                </td>
                <td style={{ textAlign: 'right', padding: '0.5rem', fontWeight: 'bold' }}>
                  {entry.buyPrice.toLocaleString()}원
                </td>
                <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                  {entry.qty.toLocaleString()}주
                </td>
                <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                  {entry.amountKrw.toLocaleString()}원
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
