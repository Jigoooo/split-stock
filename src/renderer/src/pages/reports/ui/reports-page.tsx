import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, DateInput } from '@renderer/shared/ui';
import { type ReactElement, useMemo } from 'react';
import { useReports } from '../model/use-reports';
import { DailyPnlChart } from './daily-pnl-chart';

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
  const {
    exportCsv,
    fromStr,
    setFromStr,
    summary,
    summaryError,
    summaryPending,
    toStr,
    setToStr,
    dailyPnlPending,
    dailyPnlPoints,
  } = useReports();

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const opsQuery = trpc.reports.getDailyOpsSummary.useQuery({ date: today });
  const realtimeStatsQuery = trpc.monitoring.getRealtimeStats.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const onExport = async (kind: 'trades' | 'lots' | 'events'): Promise<void> => {
    const result = await exportCsv(kind);
    downloadCsv(result.csv, result.filename);
  };

  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div className="panel">
        <div className="panel__title">오늘의 운영 요약</div>
        <div className="panel__body">
          {opsQuery.isPending ? (
            <span className="muted">집계 중…</span>
          ) : opsQuery.error ? (
            <span className="chip chip--down">{opsQuery.error.message}</span>
          ) : opsQuery.data ? (
            <DailyOpsSummary data={opsQuery.data} realtimeStats={realtimeStatsQuery.data ?? null} />
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">기간</div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <label htmlFor="reports-from" style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="muted">시작</span>
            <DateInput
              id="reports-from"
              value={fromStr}
              onChange={(e) => setFromStr(e.target.value)}
              aria-label="리포트 시작일"
              dense
            />
          </label>
          <label htmlFor="reports-to" style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="muted">종료</span>
            <DateInput
              id="reports-to"
              value={toStr}
              onChange={(e) => setToStr(e.target.value)}
              aria-label="리포트 종료일"
              dense
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
              <Kpi
                label="실현손익"
                value={formatKrwSigned(summary.realizedPnlKrw)}
                signOf={summary.realizedPnlKrw}
              />
              <Kpi label="승률" value={`${(summary.winRate * 100).toFixed(1)}%`} />
              <Kpi
                label="최대 Drawdown"
                value={
                  summary.maxDrawdownKrw === 0 ? '0원' : formatKrwSigned(-summary.maxDrawdownKrw)
                }
                signOf={summary.maxDrawdownKrw === 0 ? 0 : -1}
              />
              <Kpi label="청산 차수" value={`${thousandSeparator(summary.soldLots)}건`} />
              <Kpi label="체결 건수" value={`${thousandSeparator(summary.totalTrades)}건`} />
              <Kpi label="평균 보유일" value={`${summary.avgHoldingDays.toFixed(1)}일`} />
            </>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">일별 누적 손익</div>
        <div className="panel__body">
          {dailyPnlPending ? (
            <div
              className="muted"
              style={{
                height: 240,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              집계 중…
            </div>
          ) : (
            <DailyPnlChart points={dailyPnlPoints} height={240} />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">CSV Export</div>
        <div className="panel__body" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Button onClick={() => onExport('trades')} dense>
            체결 CSV
          </Button>
          <Button onClick={() => onExport('lots')} dense>
            차수 CSV
          </Button>
          <Button onClick={() => onExport('events')} dense>
            이벤트 로그 CSV
          </Button>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            BOM 포함 UTF-8 — Excel에서 한글 정상 표시
          </span>
        </div>
      </div>
    </div>
  );
};

const Kpi = ({
  label,
  value,
  signOf,
}: {
  label: string;
  value: string;
  signOf?: number;
}): ReactElement => {
  const color =
    signOf === undefined
      ? undefined
      : signOf > 0
        ? 'var(--up)'
        : signOf < 0
          ? 'var(--down)'
          : 'var(--fg)';
  return (
    <div>
      <div className="muted" style={{ fontSize: '1.1rem' }}>
        {label}
      </div>
      <div
        className="num"
        style={{ fontSize: '1.6rem', fontWeight: 600, ...(color ? { color } : {}) }}
      >
        {value}
      </div>
    </div>
  );
};

function formatKrwSigned(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${thousandSeparator(Math.abs(v))}원`;
}

interface DailyOpsSummaryData {
  date: string;
  autoBuy: {
    executed: number;
    watchExecuted: number;
    watchFailed: number;
    blockedProtection: number;
    blockedTimeWindow: number;
    blockedRateGuard: number;
  };
  pendingCancel: {
    success: number;
    failed: number;
    skipped: number;
    limitReached: number;
  };
  priceCorrection: { applied: number };
  quoteFeed: { cooldownEvents: number; cooldownPdnos: string[] };
}

interface RealtimeStatsData {
  capacity: number;
  wsCount: number;
  restFallbackCount: number;
  total: number;
}

const DailyOpsSummary = ({
  data,
  realtimeStats,
}: {
  data: DailyOpsSummaryData;
  realtimeStats: RealtimeStatsData | null;
}): ReactElement => {
  const totalBlocked =
    data.autoBuy.blockedProtection + data.autoBuy.blockedTimeWindow + data.autoBuy.blockedRateGuard;
  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div style={{ display: 'flex', gap: '2.4rem', flexWrap: 'wrap' }}>
        <Kpi label="자동매매 시도" value={`${thousandSeparator(data.autoBuy.executed)}건`} />
        <Kpi label="자동감시 실행" value={`${thousandSeparator(data.autoBuy.watchExecuted)}건`} />
        <Kpi label="자동감시 실패" value={`${thousandSeparator(data.autoBuy.watchFailed)}건`} />
        <Kpi label="자동매수 차단" value={`${thousandSeparator(totalBlocked)}건`} />
        <Kpi label="미체결 자동취소" value={`${thousandSeparator(data.pendingCancel.success)}건`} />
        <Kpi label="자동취소 실패" value={`${thousandSeparator(data.pendingCancel.failed)}건`} />
        <Kpi label="호가 자동보정" value={`${thousandSeparator(data.priceCorrection.applied)}건`} />
        <Kpi
          label="시세 cooldown"
          value={`${thousandSeparator(data.quoteFeed.cooldownPdnos.length)}종목`}
        />
        {realtimeStats && realtimeStats.capacity > 0 ? (
          <Kpi
            label="WS 슬롯"
            value={`${realtimeStats.wsCount}/${realtimeStats.capacity}${
              realtimeStats.restFallbackCount > 0
                ? ` (REST ${realtimeStats.restFallbackCount})`
                : ''
            }`}
          />
        ) : null}
      </div>
      {totalBlocked > 0 ? (
        <div className="muted" style={{ fontSize: '1rem' }}>
          차단 내역: 보호한도 {data.autoBuy.blockedProtection} · 시간대{' '}
          {data.autoBuy.blockedTimeWindow} · RateGuard {data.autoBuy.blockedRateGuard}
        </div>
      ) : null}
      {data.quoteFeed.cooldownPdnos.length > 0 ? (
        <div className="muted" style={{ fontSize: '1rem' }}>
          cooldown 종목: {data.quoteFeed.cooldownPdnos.join(', ')}
        </div>
      ) : null}
    </div>
  );
};
