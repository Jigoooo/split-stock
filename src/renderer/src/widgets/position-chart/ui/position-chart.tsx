import { useGetDisplaySettings } from '@renderer/entities/display-settings';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, SegmentedToggle } from '@renderer/shared/ui';
import type { LotOverlayLine } from '@shared/trading/lot-overlay';
import type { ReactElement } from 'react';
import { type ChartPeriod, usePositionChart } from '../model/use-position-chart';
import { CandlestickChart } from './candlestick-chart';

const PERIOD_LABEL: Record<ChartPeriod, string> = {
  D: '일',
  W: '주',
  M: '월',
};

export interface PositionChartProps {
  pdno: string;
  name: string;
  lines: LotOverlayLine[];
}

const formatKrw = (value: number): string => (value > 0 ? thousandSeparator(value) : '—');

/**
 * 음수 대응이 필요한 필드(전일대비) 용 — thousandSeparator 기본값은 음수를 0 으로
 * 클램프하므로 반드시 allowNegative 를 지정해야 한다.
 */
const formatSigned = (value: number): string => {
  if (value === 0) return '0';
  const sign = value > 0 ? '+' : '';
  return `${sign}${thousandSeparator(value, { allowNegative: true })}`;
};

const PriceChips = ({ pdno }: { pdno: string }): ReactElement => {
  // 상한가/하한가/고가/저가 는 KIS inquire-price REST 응답에서만 제공 — WS tick 에는 없음.
  // 15초 주기로 refresh: 헤더 칩은 실시간성 크리티컬하지 않고, API 쿼터를 아끼는 편이 낫다.
  const q = trpc.market.getPrice.useQuery({ code: pdno }, { refetchInterval: 15_000 });
  const data = q.data;
  const changeClass =
    !data || data.dayChange === 0 ? 'num' : data.dayChange > 0 ? 'num-up' : 'num-down';
  const rateLabel = data
    ? `${data.dayChangeRate > 0 ? '+' : ''}${data.dayChangeRate.toFixed(2)}%`
    : '—';
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.8rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: '1rem',
      }}
    >
      <span>
        <span className="muted">현재가</span>{' '}
        <span className={`num ${changeClass}`}>{data ? formatKrw(data.price) : '—'}</span>
      </span>
      <span>
        <span className="muted">전일대비</span>{' '}
        <span className={`num ${changeClass}`}>
          {data ? `${formatSigned(data.dayChange)} (${rateLabel})` : '—'}
        </span>
      </span>
      <span>
        <span className="muted">고</span>{' '}
        <span className="num num-up">{data ? formatKrw(data.high) : '—'}</span>
      </span>
      <span>
        <span className="muted">저</span>{' '}
        <span className="num num-down">{data ? formatKrw(data.low) : '—'}</span>
      </span>
      <span>
        <span className="muted">상한</span>{' '}
        <span className="num num-up">{data ? formatKrw(data.upperLimit) : '—'}</span>
      </span>
      <span>
        <span className="muted">하한</span>{' '}
        <span className="num num-down">{data ? formatKrw(data.lowerLimit) : '—'}</span>
      </span>
    </div>
  );
};

export const PositionChart = ({ pdno, name, lines }: PositionChartProps): ReactElement => {
  const chart = usePositionChart(pdno);
  const { settings: displaySettings } = useGetDisplaySettings();

  return (
    <div
      className="panel"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div
        className="panel__title"
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
        <PriceChips pdno={pdno} />
        {chart.isLoading ? (
          <span className="muted" style={{ fontSize: '1rem' }}>
            로드 중…
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
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
      </div>
      <div
        className="panel__body"
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
        <CandlestickChart
          key={`${pdno}:${chart.period}`}
          candles={chart.candles}
          liveCandle={chart.liveCandle}
          lines={lines}
          onFetchMore={chart.fetchMore}
          pdno={pdno}
          reachedEnd={chart.reachedEnd}
          displaySettings={displaySettings}
        />
      </div>
    </div>
  );
};
