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
      <div className="panel__body" style={{ display: 'flex', gap: '2.4rem', flexWrap: 'wrap' }}>
        <Kpi label="예수금 총액" value={deposit} />
        <Kpi label="총 평가금액" value={totalEval} />
        <Kpi label="보유 종목 수" value={positionsCount} unit="종목" />
      </div>
    </div>
  );
};

const Kpi = ({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}): ReactElement => (
  <div>
    <div className="muted" style={{ fontSize: '1.1rem' }}>
      {label}
    </div>
    <div className="num" style={{ fontSize: '1.6rem', fontWeight: 600 }}>
      {formatKrw(value)}
      {unit ? (
        <span className="muted" style={{ fontSize: '1.1rem', marginLeft: '0.4rem' }}>
          {unit}
        </span>
      ) : null}
    </div>
  </div>
);

function formatKrw(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return Math.round(value).toLocaleString('ko-KR');
}
