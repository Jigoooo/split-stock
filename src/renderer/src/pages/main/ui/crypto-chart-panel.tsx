import { useGetDisplaySettings } from '@renderer/entities/display-settings';
import { formatCryptoPrice, formatCryptoVolume } from '@renderer/pages/main/model/crypto-format';
import { useCryptoCandles } from '@renderer/pages/main/model/use-crypto-candles';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, SegmentedToggle } from '@renderer/shared/ui';
import { CandlestickChart } from '@renderer/widgets/position-chart';
import { CRYPTO_CANDLE_UNITS, type CryptoCandleUnit } from '@shared/contracts';
import { Settings } from 'lucide-react';
import type { ReactElement } from 'react';

const UNIT_LABEL: Record<CryptoCandleUnit, string> = {
  '1m': '1분',
  '3m': '3분',
  '5m': '5분',
  '10m': '10분',
  '15m': '15분',
  '30m': '30분',
  '60m': '60분',
  '240m': '4시간',
  D: '일',
  W: '주',
  M: '월',
};

function openChartSettings(): void {
  try {
    window.localStorage.setItem('popout:settings:initialTab', 'display');
  } catch {
    // localStorage 차단 환경에서는 사용자가 직접 표시 탭을 열면 된다.
  }
  void window.appShell?.openPopout('settings');
}

export interface CryptoChartPanelProps {
  market: string;
  name: string;
  unit: CryptoCandleUnit;
  onUnitChange: (unit: CryptoCandleUnit) => void;
}

export const CryptoChartPanel = ({
  market,
  name,
  onUnitChange,
  unit,
}: CryptoChartPanelProps): ReactElement => {
  const chart = useCryptoCandles(market, unit);
  const { settings: displaySettings } = useGetDisplaySettings();
  const candleSubscription = trpc.crypto.onCandle.useSubscription(
    { market },
    { enabled: market.length > 0 },
  );
  const liveCandle =
    candleSubscription.data?.unit === unit
      ? {
          date: new Date(candleSubscription.data.candleAt).toISOString(),
          open: Number(candleSubscription.data.open),
          high: Number(candleSubscription.data.high),
          low: Number(candleSubscription.data.low),
          close: Number(candleSubscription.data.close),
          volume: Number(candleSubscription.data.volume),
        }
      : null;
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
          {name && name !== market ? (
            <>
              {name} ({market})
            </>
          ) : (
            market
          )}
        </span>
        {chart.isLoading ? (
          <span className="muted" style={{ fontSize: '1rem' }}>
            로드 중…
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <SegmentedToggle
          ariaLabel="코인 봉 단위"
          value={unit}
          onChange={onUnitChange}
          dense
          items={CRYPTO_CANDLE_UNITS.map((value) => ({ value, label: UNIT_LABEL[value] }))}
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
            <span>체결이 없는 구간은 빈 구간으로 남습니다. 다른 봉 단위를 선택해 보세요.</span>
          </div>
        ) : (
          <CandlestickChart
            candles={chart.candles}
            chartKey={`crypto:UPBIT:${market}:${unit}`}
            enableDrawingTools={false}
            liveCandle={liveCandle}
            lines={[]}
            markers={[]}
            onFetchMore={chart.fetchMore}
            reachedEnd={chart.reachedEnd}
            displaySettings={displaySettings}
            priceFormatter={(price) => formatCryptoPrice(price, market)}
            volumeFormatter={(volume) => formatCryptoVolume(volume)}
          />
        )}
      </div>
    </div>
  );
};
