// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CryptoChartPanel } from './crypto-chart-panel';

vi.mock('@renderer/entities/display-settings', () => ({
  useGetDisplaySettings: () => ({ settings: {} }),
}));

vi.mock('@renderer/pages/main/model/use-crypto-candles', () => ({
  useCryptoCandles: () => ({
    candles: [
      {
        date: '2026-05-02T00:00:00.000Z',
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      },
    ],
    error: null,
    fetchMore: vi.fn(),
    isLoading: false,
    reachedEnd: false,
    retry: vi.fn(),
  }),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    crypto: {
      onCandle: { useSubscription: () => ({ data: null }) },
    },
  },
}));

vi.mock('@renderer/widgets/position-chart', () => ({
  CandlestickChart: ({ enableDrawingTools }: { enableDrawingTools: boolean }) => (
    <div data-testid="crypto-candlestick-chart" data-drawing={String(enableDrawingTools)} />
  ),
}));

describe('CryptoChartPanel', () => {
  it('uses the stock chart header pattern with segmented crypto candle units', () => {
    const onUnitChange = vi.fn();
    render(
      <CryptoChartPanel market="KRW-BTC" name="비트코인" unit="1m" onUnitChange={onUnitChange} />,
    );

    expect(screen.getByRole('radiogroup', { name: '코인 봉 단위' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '코인 봉 단위' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1분' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '4시간' })).toBeInTheDocument();
    expect(screen.getByTestId('crypto-candlestick-chart')).toHaveAttribute('data-drawing', 'false');

    fireEvent.click(screen.getByRole('radio', { name: '일' }));

    expect(onUnitChange).toHaveBeenCalledWith('D');
  });
});
