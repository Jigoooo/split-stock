import type { ReactElement } from 'react';
import { useReports } from '../model/use-reports';

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ReportsPage = (): ReactElement => {
  const { exportCsv, fromStr, setFromStr, summary, summaryError, summaryPending, toStr, setToStr } =
    useReports();

  const onExport = async (kind: 'trades' | 'lots' | 'events'): Promise<void> => {
    const result = await exportCsv(kind);
    downloadCsv(result.csv, result.filename);
  };

  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div className="panel">
        <div className="panel__title">기간</div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <label>
            시작:{' '}
            <input
              type="date"
              value={fromStr}
              onChange={(e) => setFromStr(e.target.value)}
              aria-label="리포트 시작일"
            />
          </label>
          <label>
            종료:{' '}
            <input
              type="date"
              value={toStr}
              onChange={(e) => setToStr(e.target.value)}
              aria-label="리포트 종료일"
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">KPI 요약</div>
        <div className="panel__body" style={{ display: 'flex', gap: '2.4rem', flexWrap: 'wrap' }}>
          {summaryPending ? (
            <span className="muted">집계 중…</span>
          ) : summaryError ? (
            <span className="chip chip--down">{summaryError.message}</span>
          ) : summary ? (
            <>
              <Kpi label="실현손익" value={formatKrwSigned(summary.realizedPnlKrw)} />
              <Kpi label="승률" value={`${(summary.winRate * 100).toFixed(1)}%`} />
              <Kpi
                label="최대 Drawdown"
                value={`-${summary.maxDrawdownKrw.toLocaleString('ko-KR')}원`}
              />
              <Kpi label="청산 차수" value={`${summary.soldLots}건`} />
              <Kpi label="체결 건수" value={`${summary.totalTrades}건`} />
              <Kpi label="평균 보유일" value={`${summary.avgHoldingDays.toFixed(1)}일`} />
            </>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">CSV Export</div>
        <div className="panel__body" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="button" className="hts-btn" onClick={() => onExport('trades')}>
            체결 CSV
          </button>
          <button type="button" className="hts-btn" onClick={() => onExport('lots')}>
            차수 CSV
          </button>
          <button type="button" className="hts-btn" onClick={() => onExport('events')}>
            이벤트 로그 CSV
          </button>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            BOM 포함 UTF-8 — Excel에서 한글 정상 표시
          </span>
        </div>
      </div>
    </div>
  );
};

const Kpi = ({ label, value }: { label: string; value: string }): ReactElement => (
  <div>
    <div className="muted" style={{ fontSize: '1.1rem' }}>
      {label}
    </div>
    <div className="num" style={{ fontSize: '1.6rem', fontWeight: 600 }}>
      {value}
    </div>
  </div>
);

function formatKrwSigned(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${Math.abs(v).toLocaleString('ko-KR')}원`;
}
