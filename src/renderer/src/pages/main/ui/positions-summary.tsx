import type { ReactElement } from 'react';
import { formatKrw, formatSigned, numberClassName } from '../lib/positions-grid-format';
import type { UsePositionsGridResult } from '../model/use-positions-grid';

interface PositionsSummaryProps {
  summary: UsePositionsGridResult['summary'];
}

export const PositionsSummary = ({ summary }: PositionsSummaryProps): ReactElement => {
  const pnlClassName = numberClassName(summary.totalPnlAmount);

  return (
    <div
      className="panel__body"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
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
        {...(pnlClassName ? { className: pnlClassName } : {})}
      />
      <SummaryCard
        label="수익률"
        value={`${summary.totalPnlRate.toFixed(2)}%`}
        {...(pnlClassName ? { className: pnlClassName } : {})}
      />
      <SummaryCard label="추정자산" value={formatKrw(summary.estimatedAsset)} />
    </div>
  );
};

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
