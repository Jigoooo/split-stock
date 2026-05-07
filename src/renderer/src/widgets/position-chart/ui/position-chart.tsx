import { useActiveAccountId } from '@renderer/entities/account';
import { useGetDisplaySettings } from '@renderer/entities/display-settings';
import { useTradeCycles } from '@renderer/entities/trade-cycle';
import { Button, SegmentedToggle } from '@renderer/shared/ui';
import type { LotOverlayLine } from '@shared/trading/lot-overlay';
import { Settings } from 'lucide-react';
import { type ReactElement, useMemo } from 'react';
import { toTradeMarkers } from '../lib/trade-markers';
import { type ChartPeriod, usePositionChart } from '../model/use-position-chart';
import { CandlestickChart } from './candlestick-chart';
import { PriceChips } from './price-chips';

function openChartSettings(): void {
  // popout 윈도우는 별도 BrowserWindow 지만 default session partition 공유 → localStorage 동기.
  // 진입 시 settings-page 가 mount 직후 read & remove 하여 표시 탭으로 자동 점프.
  try {
    window.localStorage.setItem('popout:settings:initialTab', 'display');
  } catch {
    // localStorage 차단 환경에서는 sliently fallback (사용자가 직접 표시 탭 클릭)
  }
  void window.appShell?.openPopout('settings');
}

const PERIOD_LABEL: Record<ChartPeriod, string> = {
  D: '일',
  W: '주',
  M: '월',
};

export interface PositionChartProps {
  enableDrawingTools?: boolean;
  pdno: string;
  name: string;
  lines: LotOverlayLine[];
}

export const PositionChart = ({
  pdno,
  name,
  lines,
  enableDrawingTools = false,
}: PositionChartProps): ReactElement => {
  const chart = usePositionChart(pdno);
  const { settings: displaySettings } = useGetDisplaySettings();
  const { accountId } = useActiveAccountId();
  const { cycles } = useTradeCycles({
    accountId: accountId ?? 0,
    enabled: accountId !== null,
    pdno,
    status: 'all',
  });
  const markers = useMemo(() => toTradeMarkers(cycles, chart.candles), [cycles, chart.candles]);
  const hasNoCandles = !chart.isLoading && !chart.error && chart.candles.length === 0;

  return (
    <div
      className="panel position-chart__panel"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div
        className="panel__title position-chart__header"
        style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}
      >
        <span>
          {name && name !== pdno ? (
            <>
              {name} ({pdno})
            </>
          ) : (
            pdno
          )}
        </span>
        {chart.isLoading ? (
          <span className="muted" style={{ fontSize: '1rem' }}>
            로드 중…
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <div className="position-chart__quote-strip">
          <PriceChips pdno={pdno} />
        </div>
        <SegmentedToggle
          value={chart.period}
          onChange={chart.setPeriod}
          ariaLabel="봉 단위"
          dense
          items={(['D', 'W', 'M'] as const).map((period) => ({
            value: period,
            label: PERIOD_LABEL[period],
          }))}
        />
        <Button
          iconLeading={<Settings size={14} />}
          iconOnly
          dense
          aria-label="차트 설정"
          title="차트 설정"
          onClick={openChartSettings}
        >
          차트 설정
        </Button>
      </div>
      <div
        className="panel__body position-chart__body"
        style={{
          padding: '0.6rem',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {chart.error ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              flexWrap: 'wrap',
              marginBottom: '0.6rem',
            }}
          >
            <span className="chip chip--down">{chart.error}</span>
            <Button
              onClick={chart.retry}
              disabled={chart.isLoading}
              aria-label="봉 다시 시도"
              dense
            >
              다시 시도
            </Button>
          </div>
        ) : null}
        {chart.isAutoRecovering ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              color: 'var(--fg-2)',
              fontSize: '0.9rem',
              marginBottom: '0.4rem',
            }}
          >
            자동 복구 중…
          </div>
        ) : null}
        {hasNoCandles ? (
          <div
            role="status"
            style={{
              alignItems: 'center',
              color: 'var(--fg-2)',
              display: 'grid',
              flex: 1,
              gap: '0.35rem',
              justifyItems: 'center',
              minHeight: '16rem',
              padding: '1.2rem',
              textAlign: 'center',
            }}
          >
            <strong style={{ color: 'var(--fg)' }}>표시할 봉 데이터가 없습니다</strong>
            <span>다른 봉 단위를 선택하거나 잠시 후 다시 시도하세요.</span>
          </div>
        ) : (
          <CandlestickChart
            candles={chart.candles}
            enableDrawingTools={enableDrawingTools}
            liveCandle={chart.liveCandle}
            lines={lines}
            markers={markers}
            onFetchMore={chart.fetchMore}
            pdno={pdno}
            reachedEnd={chart.reachedEnd}
            displaySettings={displaySettings}
          />
        )}
      </div>
    </div>
  );
};
