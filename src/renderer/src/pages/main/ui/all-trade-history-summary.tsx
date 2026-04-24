import type { ReactElement } from 'react';
import type { AllTradeHistorySummary } from '../lib/all-trade-history';
import { formatNumber, formatSigned, numberClassName } from '../lib/all-trade-history-format';

interface AllTradeHistorySummaryBarProps {
  summary: AllTradeHistorySummary;
}

export const AllTradeHistorySummaryBar = ({
  summary,
}: AllTradeHistorySummaryBarProps): ReactElement => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
      gap: '0.6rem',
      padding: '0.8rem',
      borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
      flexShrink: 0,
    }}
  >
    <SummaryCard label="매매건수" value={`${summary.count}건`} />
    <SummaryCard label="매입금액" value={formatNumber(summary.buyAmount)} />
    <SummaryCard label="평가/매도금액" value={formatNumber(summary.evaluationAmount)} />
    <SummaryCard
      label="손익액"
      value={formatSigned(summary.pnlAmount)}
      className={numberClassName(summary.pnlAmount)}
    />
    <SummaryCard
      label="수익률"
      value={`${summary.pnlRate.toFixed(2)}%`}
      className={numberClassName(summary.pnlAmount)}
    />
  </div>
);

const SummaryCard = ({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}): ReactElement => (
  <div
    style={{
      padding: '0.55rem 0.65rem',
      border: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
      background: 'rgba(255,255,255,0.5)',
    }}
  >
    <div className="muted" style={{ fontSize: '1rem' }}>
      {label}
    </div>
    <div
      className={['num', className ?? ''].filter(Boolean).join(' ')}
      style={{ fontSize: '1.45rem', fontWeight: 600 }}
    >
      {value}
    </div>
  </div>
);
