import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { ReactElement } from 'react';

export interface AccountSummaryPanelProps {
  deposit: number;
  totalEval: number;
  positionsCount: number;
}

export const AccountSummaryPanel = ({
  deposit,
  totalEval,
  positionsCount,
}: AccountSummaryPanelProps): ReactElement => {
  return (
    <div className="panel">
      <div className="panel__title">계좌 요약</div>
      <div className="panel__body dashboard-summary-grid">
        <Kpi label="예수금 총액" value={deposit} unit="원" primary />
        <Kpi label="총 평가금액" value={totalEval} unit="원" />
        <Kpi label="보유 종목 수" value={positionsCount} unit="종목" />
      </div>
    </div>
  );
};

const Kpi = ({
  label,
  value,
  unit,
  primary = false,
}: {
  label: string;
  value: number;
  unit?: string;
  primary?: boolean;
}): ReactElement => (
  <div
    className={
      primary ? 'dashboard-summary-card dashboard-summary-card--primary' : 'dashboard-summary-card'
    }
  >
    <div className="dashboard-summary-label">{label}</div>
    <div className="dashboard-summary-value">
      {formatValue(value)}
      {unit ? <span className="dashboard-summary-unit">{unit}</span> : null}
    </div>
  </div>
);

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return thousandSeparator(Math.round(value));
}
