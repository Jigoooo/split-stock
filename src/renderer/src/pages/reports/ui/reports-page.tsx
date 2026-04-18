import { trpc } from '@renderer/shared/api/trpc';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

type CsvKind = 'trades' | 'lots' | 'events';

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const [fromStr, setFromStr] = useState(toISODate(oneMonthAgo));
  const [toStr, setToStr] = useState(toISODate(today));

  const range = useMemo(
    () => ({ from: new Date(`${fromStr}T00:00:00Z`), to: new Date(`${toStr}T23:59:59Z`) }),
    [fromStr, toStr],
  );

  const summary = trpc.reports.getSummary.useQuery(range);
  const utils = trpc.useUtils();

  const onExport = async (kind: CsvKind): Promise<void> => {
    const r = await utils.reports.exportCsv.fetch({ ...range, kind });
    const stamp = `${fromStr}_${toStr}`;
    downloadCsv(r.csv, `${kind}-${stamp}.csv`);
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
          {summary.isPending ? (
            <span className="muted">집계 중…</span>
          ) : summary.error ? (
            <span className="chip chip--down">{summary.error.message}</span>
          ) : summary.data ? (
            <>
              <Kpi label="실현손익" value={formatKrwSigned(summary.data.realizedPnlKrw)} />
              <Kpi label="승률" value={`${(summary.data.winRate * 100).toFixed(1)}%`} />
              <Kpi
                label="최대 Drawdown"
                value={`-${summary.data.maxDrawdownKrw.toLocaleString('ko-KR')}원`}
              />
              <Kpi label="청산 차수" value={`${summary.data.soldLots}건`} />
              <Kpi label="체결 건수" value={`${summary.data.totalTrades}건`} />
              <Kpi label="평균 보유일" value={`${summary.data.avgHoldingDays.toFixed(1)}일`} />
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
