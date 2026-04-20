// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchChartMock, addSeriesMock, createChartMock, trpcUtilsMock } = vi.hoisted(() => {
  const fetchChartMock = vi.fn();
  const setDataMock = vi.fn();
  const updateMock = vi.fn();
  const createPriceLineMock = vi.fn();
  const removePriceLineMock = vi.fn();
  const priceScaleApplyOptionsMock = vi.fn();
  const priceScaleMock = vi.fn(() => ({
    applyOptions: priceScaleApplyOptionsMock,
  }));
  const addSeriesMock = vi.fn(
    (
      _seriesType: unknown,
      _options: { priceFormat: { formatter: (price: number) => string } },
    ) => ({
      setData: setDataMock,
      update: updateMock,
      createPriceLine: createPriceLineMock,
      removePriceLine: removePriceLineMock,
      // candlestick-chart.tsx 의 series.priceScale().applyOptions() 호출 대응 stub.
      priceScale: priceScaleMock,
    }),
  );
  const createChartMock = vi.fn(
    (
      _container: unknown,
      _options: { localization: { priceFormatter: (price: number) => string } },
    ) => ({
      applyOptions: vi.fn(),
      remove: vi.fn(),
      addSeries: addSeriesMock,
      removeSeries: vi.fn(),
      timeScale: () => ({
        subscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        getVisibleLogicalRange: () => null,
        setVisibleLogicalRange: vi.fn(),
      }),
    }),
  );
  const trpcUtilsMock = {
    market: {
      getDailyChart: {
        fetch: fetchChartMock,
      },
    },
  };

  return {
    fetchChartMock,
    addSeriesMock,
    createChartMock,
    trpcUtilsMock,
  };
});

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => trpcUtilsMock,
    display: {
      getSettings: {
        useQuery: () => ({ isPending: false, error: null, data: null }),
      },
    },
    realtime: {
      watch: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
      unwatch: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
      getLatestTick: {
        useQuery: () => ({ data: null }),
      },
    },
  },
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: Symbol('CandlestickSeries'),
  HistogramSeries: Symbol('HistogramSeries'),
  LineSeries: Symbol('LineSeries'),
  LineStyle: {
    Solid: 0,
    Dashed: 1,
  },
  createChart: createChartMock,
}));

import { PositionChart } from './ui/position-chart';

beforeAll(() => {
  class ResizeObserverMock {
    observe(): void {}
    disconnect(): void {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

beforeEach(() => {
  fetchChartMock.mockReset();
  createChartMock.mockClear();
  addSeriesMock.mockClear();
});

describe('PositionChart', () => {
  it('초기 요청 실패 후 로딩 문구를 내리고 재시도 버튼을 노출한다', async () => {
    fetchChartMock.mockRejectedValueOnce(new Error('봉 조회 실패: NETWORK - HTTP 500'));

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);

    expect(await screen.findByText('봉 조회 실패: NETWORK - HTTP 500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '봉 다시 시도' })).toBeInTheDocument();
    expect(screen.queryByText('로드 중…')).not.toBeInTheDocument();
  });

  it('같은 종목과 같은 봉 탭에서도 다시 시도로 재요청한다', async () => {
    fetchChartMock
      .mockRejectedValueOnce(new Error('봉 조회 실패: NETWORK - HTTP 500'))
      .mockResolvedValueOnce({ candles: [], toMs: Date.UTC(2026, 3, 19) });

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);

    const retryButton = await screen.findByRole('button', { name: '봉 다시 시도' });
    fireEvent.click(retryButton);

    await waitFor(() => expect(fetchChartMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('봉 조회 실패: NETWORK - HTTP 500')).not.toBeInTheDocument(),
    );
  });

  it('차트 가격 축과 시리즈 포맷에 세 자리 구분자를 적용한다', async () => {
    fetchChartMock.mockResolvedValueOnce({
      candles: [
        {
          date: '2026-04-18',
          open: 10000,
          high: 12345,
          low: 9800,
          close: 12000,
          volume: 123456,
        },
      ],
      toMs: Date.UTC(2026, 3, 19),
    });

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);

    await waitFor(() => expect(createChartMock).toHaveBeenCalled());
    await waitFor(() => expect(addSeriesMock).toHaveBeenCalled());

    const chartCall = createChartMock.mock.calls[0];
    const seriesCall = addSeriesMock.mock.calls[0];

    expect(chartCall).toBeDefined();
    expect(seriesCall).toBeDefined();
    if (!chartCall || !seriesCall) {
      throw new Error('chart mocks were not called');
    }

    const [, chartOptions] = chartCall;
    const [, seriesOptions] = seriesCall;

    expect(chartOptions.localization.priceFormatter(12345)).toBe('12,345');
    expect(seriesOptions.priceFormat.formatter(12345)).toBe('12,345');
  });
});
