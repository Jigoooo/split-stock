import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import {
  Button,
  DateInput,
  EmptyState,
  FilterBar,
  KpiStrip,
  PageHeader,
} from '@renderer/shared/ui';
import { Download } from 'lucide-react';
import { type ReactElement, useMemo } from 'react';
import { useReports } from '../model/use-reports';
import { DailyPnlChart } from './daily-pnl-chart';
import { LotNthBarChart } from './lot-nth-bar-chart';
import { RangePresetButtons } from './range-preset-buttons';
import { WinRateLineChart } from './win-rate-line-chart';

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
    dailyPnlError,
    dailyPnlPoints,
    pnlByLotNthPending,
    pnlByLotNthError,
    pnlByLotNth,
    winRateTimelinePending,
    winRateTimelineError,
    winRateTimeline,
  } = useReports();

  const applyPreset = (from: string, to: string): void => {
    setFromStr(from);
    setToStr(to);
  };

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
      <PageHeader
        title="리포트"
        description="실현손익, 차수별 성과, 운영 이벤트를 기간 기준으로 확인합니다."
        dense
      />

      <div className="panel">
        <div className="panel__title">오늘의 운영 요약</div>
        <div className="panel__body">
          {opsQuery.isPending ? (
            <EmptyState dense title="운영 요약 집계 중…" />
          ) : opsQuery.error ? (
            <EmptyState
              dense
              role="alert"
              title="운영 요약 조회 실패"
              description={opsQuery.error.message}
            />
          ) : opsQuery.data ? (
            <DailyOpsSummary data={opsQuery.data} realtimeStats={realtimeStatsQuery.data ?? null} />
          ) : (
            <EmptyState dense title="오늘의 운영 데이터가 없습니다" />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">기간</div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
          <RangePresetButtons fromStr={fromStr} toStr={toStr} onChange={applyPreset} />
          <FilterBar ariaLabel="리포트 기간 필터" dense>
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
          </FilterBar>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">KPI 요약</div>
        <div className="panel__body">
          {summaryPending ? (
            <EmptyState dense title="KPI 집계 중…" />
          ) : summaryError ? (
            <EmptyState
              dense
              role="alert"
              title="KPI 조회 실패"
              description={summaryError.message}
            />
          ) : summary ? (
            <KpiStrip
              ariaLabel="KPI 요약"
              items={[
                {
                  label: '실현손익',
                  value: formatKrwSigned(summary.realizedPnlKrw),
                  tone: toneForSignedValue(summary.realizedPnlKrw),
                },
                { label: '승률', value: `${(summary.winRate * 100).toFixed(1)}%` },
                {
                  label: '최대 Drawdown',
                  value:
                    summary.maxDrawdownKrw === 0 ? '0원' : formatKrwSigned(-summary.maxDrawdownKrw),
                  tone: summary.maxDrawdownKrw === 0 ? 'default' : 'down',
                },
                { label: '청산 차수', value: `${thousandSeparator(summary.soldLots)}건` },
                { label: '체결 건수', value: `${thousandSeparator(summary.totalTrades)}건` },
                { label: '평균 보유일', value: `${summary.avgHoldingDays.toFixed(1)}일` },
              ]}
            />
          ) : (
            <EmptyState dense title="기간 내 KPI 데이터가 없습니다" />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">일별 누적 손익</div>
        <div className="panel__body">
          {dailyPnlPending ? (
            <ChartStatus height={240} message="집계 중…" />
          ) : dailyPnlError ? (
            <ChartStatus
              height={240}
              message={`일별 손익 조회 실패: ${dailyPnlError.message}`}
              tone="error"
            />
          ) : (
            <DailyPnlChart points={dailyPnlPoints} height={240} />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">차수별 손익 분포</div>
        <div className="panel__body">
          {pnlByLotNthPending ? (
            <ChartStatus height={200} message="집계 중…" />
          ) : pnlByLotNthError ? (
            <ChartStatus
              height={200}
              message={`차수별 손익 조회 실패: ${pnlByLotNthError.message}`}
              tone="error"
            />
          ) : (
            <LotNthBarChart bars={pnlByLotNth} height={200} />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">일별 승률 추이</div>
        <div className="panel__body">
          {winRateTimelinePending ? (
            <ChartStatus height={220} message="집계 중…" />
          ) : winRateTimelineError ? (
            <ChartStatus
              height={220}
              message={`승률 추이 조회 실패: ${winRateTimelineError.message}`}
              tone="error"
            />
          ) : (
            <WinRateLineChart points={winRateTimeline} height={220} />
          )}
        </div>
      </div>

      <div className="panel">
        <div
          className="panel__title"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Download size={14} aria-hidden />
          <span>리포트 내보내기 (CSV)</span>
        </div>
        <div className="panel__body" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Button
            onClick={() => onExport('trades')}
            iconLeading={<Download size={13} />}
            dense
            title="기간 내 모든 체결 내역을 CSV 로 내보냅니다"
          >
            체결 내역
          </Button>
          <Button
            onClick={() => onExport('lots')}
            iconLeading={<Download size={13} />}
            dense
            title="차수별 매매 사이클을 CSV 로 내보냅니다"
          >
            차수 사이클
          </Button>
          <Button
            onClick={() => onExport('events')}
            iconLeading={<Download size={13} />}
            dense
            title="시스템 이벤트 로그를 CSV 로 내보냅니다"
          >
            이벤트 로그
          </Button>
          <span className="muted" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            BOM 포함 UTF-8 — Excel 에서 한글이 정상 표시됩니다
          </span>
        </div>
      </div>
    </div>
  );
};

const ChartStatus = ({
  height,
  message,
  tone = 'muted',
}: {
  height: number;
  message: string;
  tone?: 'muted' | 'error';
}): ReactElement => (
  <div style={{ height }}>
    <EmptyState
      dense
      role={tone === 'error' ? 'alert' : 'status'}
      title={tone === 'error' ? '차트 조회 실패' : message}
      description={tone === 'error' ? message : undefined}
    />
  </div>
);

function formatKrwSigned(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${thousandSeparator(Math.abs(v))}원`;
}

function toneForSignedValue(v: number): 'default' | 'up' | 'down' {
  if (v > 0) return 'up';
  if (v < 0) return 'down';
  return 'default';
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
      <KpiStrip
        dense
        ariaLabel="오늘의 운영 요약"
        items={[
          { label: '자동매매 시도', value: `${thousandSeparator(data.autoBuy.executed)}건` },
          { label: '자동감시 실행', value: `${thousandSeparator(data.autoBuy.watchExecuted)}건` },
          {
            label: '자동감시 실패',
            value: `${thousandSeparator(data.autoBuy.watchFailed)}건`,
            tone: data.autoBuy.watchFailed > 0 ? 'down' : 'default',
          },
          {
            label: '자동매수 차단',
            value: `${thousandSeparator(totalBlocked)}건`,
            tone: totalBlocked > 0 ? 'down' : 'default',
          },
          { label: '미체결 자동취소', value: `${thousandSeparator(data.pendingCancel.success)}건` },
          {
            label: '자동취소 실패',
            value: `${thousandSeparator(data.pendingCancel.failed)}건`,
            tone: data.pendingCancel.failed > 0 ? 'down' : 'default',
          },
          { label: '호가 자동보정', value: `${thousandSeparator(data.priceCorrection.applied)}건` },
          {
            label: '시세 cooldown',
            value: `${thousandSeparator(data.quoteFeed.cooldownPdnos.length)}종목`,
          },
          ...(realtimeStats && realtimeStats.capacity > 0
            ? [
                {
                  label: 'WS 슬롯',
                  value: `${realtimeStats.wsCount}/${realtimeStats.capacity}${
                    realtimeStats.restFallbackCount > 0
                      ? ` (REST ${realtimeStats.restFallbackCount})`
                      : ''
                  }`,
                },
              ]
            : []),
        ]}
      />
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
