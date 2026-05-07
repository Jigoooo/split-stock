// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchChartMock,
  addSeriesMock,
  createChartMock,
  createPriceLineMock,
  removePriceLineMock,
  detachPrimitiveMock,
  createSeriesMarkersMock,
  setMarkersMock,
  detachMarkersMock,
  useActiveAccountIdMock,
  useTradeCyclesMock,
  crosshairHandlerHolder,
  chartInstancesMock,
  resizeObserverCallbackHolder,
  trpcUtilsMock,
} = vi.hoisted(() => {
  const fetchChartMock = vi.fn();
  const setDataMock = vi.fn();
  const updateMock = vi.fn();
  const applyOptionsMock = vi.fn();
  const createPriceLineMock = vi.fn((opts: { price: number }) => ({ __priceLine: opts.price }));
  const removePriceLineMock = vi.fn();
  const attachPrimitiveMock = vi.fn();
  const detachPrimitiveMock = vi.fn();
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
      applyOptions: applyOptionsMock,
      createPriceLine: createPriceLineMock,
      removePriceLine: removePriceLineMock,
      attachPrimitive: attachPrimitiveMock,
      detachPrimitive: detachPrimitiveMock,
      coordinateToPrice: (y: number) => 10_000 - y,
      priceToCoordinate: (price: number) => 10_000 - price,
      // candlestick-chart.tsx 의 series.priceScale().applyOptions() 호출 대응 stub.
      priceScale: priceScaleMock,
    }),
  );
  const crosshairHandlerHolder: { current: ((p: unknown) => void) | null } = { current: null };
  const resizeObserverCallbackHolder: {
    current: ResizeObserverCallback | null;
  } = { current: null };
  const chartInstancesMock: Array<{
    applyOptions: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }> = [];
  const subscribeCrosshairMoveMock = vi.fn((handler: (p: unknown) => void) => {
    crosshairHandlerHolder.current = handler;
  });
  const unsubscribeCrosshairMoveMock = vi.fn(() => {
    crosshairHandlerHolder.current = null;
  });
  const createChartMock = vi.fn(
    (
      _container: unknown,
      _options: { localization: { priceFormatter: (price: number) => string } },
    ) => {
      const chart = {
        applyOptions: vi.fn(),
        remove: vi.fn(),
        addSeries: addSeriesMock,
        removeSeries: vi.fn(),
        subscribeClick: vi.fn(),
        unsubscribeClick: vi.fn(),
        subscribeCrosshairMove: subscribeCrosshairMoveMock,
        unsubscribeCrosshairMove: unsubscribeCrosshairMoveMock,
        timeScale: () => ({
          subscribeVisibleLogicalRangeChange: vi.fn(),
          unsubscribeVisibleLogicalRangeChange: vi.fn(),
          getVisibleLogicalRange: () => null,
          setVisibleLogicalRange: vi.fn(),
          timeToCoordinate: () => 0,
        }),
      };
      chartInstancesMock.push(chart);
      return chart;
    },
  );
  const setMarkersMock = vi.fn();
  const detachMarkersMock = vi.fn();
  type MarkerInput = Array<Record<string, unknown>>;
  const createSeriesMarkersImpl = (
    _series: unknown,
    _markers: MarkerInput,
  ): { setMarkers: typeof setMarkersMock; detach: typeof detachMarkersMock } => ({
    setMarkers: setMarkersMock,
    detach: detachMarkersMock,
  });
  const createSeriesMarkersMock = vi.fn<typeof createSeriesMarkersImpl>(createSeriesMarkersImpl);
  const useActiveAccountIdImpl = (): { accountId: number | null; isPending: boolean } => ({
    accountId: 1,
    isPending: false,
  });
  const useActiveAccountIdMock = vi.fn<typeof useActiveAccountIdImpl>(useActiveAccountIdImpl);
  const useTradeCyclesImpl = (
    _options: Record<string, unknown>,
  ): { cycles: Array<Record<string, unknown>>; isPending: boolean; error: null } => ({
    cycles: [],
    isPending: false,
    error: null,
  });
  const useTradeCyclesMock = vi.fn<typeof useTradeCyclesImpl>(useTradeCyclesImpl);
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
    createPriceLineMock,
    removePriceLineMock,
    detachPrimitiveMock,
    createSeriesMarkersMock,
    setMarkersMock,
    detachMarkersMock,
    useActiveAccountIdMock,
    useTradeCyclesMock,
    crosshairHandlerHolder,
    chartInstancesMock,
    resizeObserverCallbackHolder,
    trpcUtilsMock,
  };
});

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => trpcUtilsMock,
    auth: {
      getEnv: {
        useQuery: () => ({ data: { env: 'MOCK', accountId: 1 } }),
      },
    },
    display: {
      getSettings: {
        useQuery: () => ({ isPending: false, error: null, data: null }),
      },
    },
    market: {
      getPrice: {
        useQuery: () => ({ data: undefined, isPending: false, error: null }),
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
      onTick: {
        useSubscription: () => ({ data: null, status: 'success' }),
      },
    },
  },
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: Symbol('CandlestickSeries'),
  CrosshairMode: {
    Magnet: 0,
    Normal: 1,
  },
  HistogramSeries: Symbol('HistogramSeries'),
  LineSeries: Symbol('LineSeries'),
  LineStyle: {
    Solid: 0,
    Dashed: 1,
    Dotted: 2,
  },
  createChart: createChartMock,
  createSeriesMarkers: createSeriesMarkersMock,
}));

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: useActiveAccountIdMock,
}));

vi.mock('@renderer/entities/trade-cycle', () => ({
  useTradeCycles: useTradeCyclesMock,
}));

import { PositionChart } from './ui/position-chart';

beforeAll(() => {
  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallbackHolder.current = callback;
    }
    observe(): void {}
    disconnect(): void {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

beforeEach(() => {
  fetchChartMock.mockReset();
  createChartMock.mockClear();
  addSeriesMock.mockClear();
  createSeriesMarkersMock.mockClear();
  setMarkersMock.mockClear();
  detachMarkersMock.mockClear();
  useTradeCyclesMock.mockReset();
  useTradeCyclesMock.mockReturnValue({ cycles: [], isPending: false, error: null });
  useActiveAccountIdMock.mockReset();
  useActiveAccountIdMock.mockReturnValue({ accountId: 1, isPending: false });
  crosshairHandlerHolder.current = null;
  resizeObserverCallbackHolder.current = null;
  chartInstancesMock.length = 0;
  window.localStorage.clear();
});

describe('PositionChart', () => {
  it('초기 요청 실패 후 로딩 문구를 내리고 재시도 버튼을 노출한다', async () => {
    fetchChartMock.mockRejectedValueOnce(new Error('봉 조회 실패: NETWORK - HTTP 500'));

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} enableDrawingTools />);

    expect(await screen.findByText('봉 조회 실패: NETWORK - HTTP 500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '봉 다시 시도' })).toBeInTheDocument();
    expect(screen.queryByText('로드 중…')).not.toBeInTheDocument();
  });

  it('같은 종목과 같은 봉 탭에서도 다시 시도로 재요청한다', async () => {
    fetchChartMock
      .mockRejectedValueOnce(new Error('봉 조회 실패: NETWORK - HTTP 500'))
      .mockResolvedValueOnce({ candles: [], toMs: Date.UTC(2026, 3, 19) });

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} enableDrawingTools />);

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

  it('봉 단위 전환 시 차트 인스턴스를 재생성하지 않는다', async () => {
    fetchChartMock.mockResolvedValue({
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

    await waitFor(() => expect(createChartMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('radio', { name: '주' }));

    await waitFor(() =>
      expect(fetchChartMock).toHaveBeenCalledWith({ code: '005930', period: 'W' }),
    );
    expect(createChartMock).toHaveBeenCalledTimes(1);
  });

  it('unmount 이후 늦게 들어온 ResizeObserver 콜백은 disposed 차트를 건드리지 않는다', async () => {
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

    const { unmount } = render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);

    await waitFor(() => expect(createChartMock).toHaveBeenCalledTimes(1));
    const chart = chartInstancesMock[0];
    expect(chart).toBeDefined();
    if (!chart) throw new Error('chart instance missing');

    chart.applyOptions.mockClear();
    unmount();

    act(() => {
      resizeObserverCallbackHolder.current?.([], {} as ResizeObserver);
    });

    expect(chart.remove).toHaveBeenCalledTimes(1);
    expect(chart.applyOptions).not.toHaveBeenCalled();
  });

  it('봉 조회가 성공했지만 데이터가 없으면 빈 상태를 차트와 구분해 보여준다', async () => {
    fetchChartMock.mockResolvedValueOnce({ candles: [], toMs: Date.UTC(2026, 3, 19) });

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);

    expect(await screen.findByText('표시할 봉 데이터가 없습니다')).toBeInTheDocument();
    expect(
      screen.getByText('다른 봉 단위를 선택하거나 잠시 후 다시 시도하세요.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '봉 다시 시도' })).not.toBeInTheDocument();
  });

  it('거래량 시리즈의 마지막 값 라벨과 가격선을 숨긴다', async () => {
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

    await waitFor(() => expect(addSeriesMock).toHaveBeenCalledTimes(5));

    const volumeCall = addSeriesMock.mock.calls[1];
    expect(volumeCall?.[1]).toMatchObject({
      priceScaleId: 'volume',
      priceLineVisible: false,
      lastValueVisible: false,
    });
  });

  it('오버레이 라인은 캐시된 소수점 값이 와도 차트에서 반올림해 렌더한다', async () => {
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

    render(
      <PositionChart
        pdno="005930"
        name="삼성전자"
        lines={[{ kind: 'buy', nth: 1, price: 6746.666, label: '1차 매수 6,746.666' }]}
      />,
    );

    await waitFor(() => expect(createPriceLineMock).toHaveBeenCalled());
    expect(createPriceLineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 6747,
        title: '1차 매수 6,747',
      }),
    );
  });

  it('호버 전에는 OHLC 툴팁이 DOM 에 없다', async () => {
    fetchChartMock.mockResolvedValueOnce({
      candles: [
        { date: '2026-04-18', open: 9100, high: 9500, low: 9050, close: 9300, volume: 2000 },
      ],
      toMs: Date.UTC(2026, 3, 19),
    });
    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);
    await waitFor(() => expect(addSeriesMock).toHaveBeenCalled());
    expect(screen.queryByTestId('ohlc-tooltip')).toBeNull();
  });

  it('crosshair 호버 시 OHLC + 등락률 + 거래량을 툴팁에 표시한다', async () => {
    fetchChartMock.mockResolvedValueOnce({
      candles: [
        { date: '2026-04-17', open: 9000, high: 9200, low: 8900, close: 9100, volume: 1000 },
        { date: '2026-04-18', open: 9100, high: 9500, low: 9050, close: 9300, volume: 2000 },
      ],
      toMs: Date.UTC(2026, 3, 19),
    });
    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);
    await waitFor(() => expect(addSeriesMock).toHaveBeenCalled());
    await waitFor(() => expect(crosshairHandlerHolder.current).not.toBeNull());

    const candleSeries = addSeriesMock.mock.results[0]?.value as object;
    const volumeSeries = addSeriesMock.mock.results[1]?.value as object;
    const seriesData = new Map<object, unknown>();
    seriesData.set(candleSeries, { open: 9100, high: 9500, low: 9050, close: 9300 });
    seriesData.set(volumeSeries, { value: 2000 });

    act(() => {
      crosshairHandlerHolder.current?.({
        time: '2026-04-18',
        point: { x: 400, y: 200 },
        seriesData,
      });
    });

    expect(await screen.findByTestId('ohlc-tooltip')).toBeInTheDocument();
    expect(screen.getByText('2026-04-18')).toBeInTheDocument();
    expect(screen.getByText('9,100')).toBeInTheDocument(); // open
    expect(screen.getByText('9,500')).toBeInTheDocument(); // high
    expect(screen.getByText('9,050')).toBeInTheDocument(); // low
    expect(screen.getByText('9,300')).toBeInTheDocument(); // close
    // 등락: close 9300 - prevClose 9100 = +200, +2.20%
    expect(screen.getByText(/\+200.*\+2\.20%/)).toBeInTheDocument();
    expect(screen.getByText('2,000')).toBeInTheDocument(); // volume

    // 차트 영역 밖으로 빠지면 툴팁이 사라진다.
    act(() => {
      crosshairHandlerHolder.current?.({
        time: undefined,
        point: undefined,
        seriesData: new Map(),
      });
    });
    expect(screen.queryByTestId('ohlc-tooltip')).toBeNull();
  });

  it('TradeCycle 이 있으면 createSeriesMarkers 에 B/S 마커가 시간순으로 전달된다', async () => {
    fetchChartMock.mockResolvedValueOnce({
      candles: [
        { date: '2026-04-08', open: 100, high: 110, low: 90, close: 105, volume: 1 },
        { date: '2026-04-10', open: 100, high: 110, low: 90, close: 105, volume: 1 },
        { date: '2026-04-11', open: 100, high: 110, low: 90, close: 105, volume: 1 },
      ],
      toMs: Date.UTC(2026, 3, 12),
    });
    const localDay = (ymd: string): number => {
      const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
      return new Date(y, m - 1, d, 12, 0, 0).getTime();
    };
    useTradeCyclesMock.mockReturnValue({
      cycles: [
        {
          id: 1,
          nth: 1,
          pdno: '005930',
          name: '삼성전자',
          buyPrice: 100,
          qty: 10,
          amountKrw: 1000,
          status: 'SOLD',
          boughtAt: localDay('2026-04-08'),
          soldAt: localDay('2026-04-11'),
          sellPrice: 110,
        },
        {
          id: 2,
          nth: 2,
          pdno: '005930',
          name: '삼성전자',
          buyPrice: 95,
          qty: 10,
          amountKrw: 950,
          status: 'OPEN',
          boughtAt: localDay('2026-04-10'),
        },
      ],
      isPending: false,
      error: null,
    });

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);

    await waitFor(() => expect(createSeriesMarkersMock).toHaveBeenCalled());
    const lastCall = createSeriesMarkersMock.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const passedMarkers = lastCall?.[1] as Array<{ time: string; text: string; position: string }>;
    expect(passedMarkers.map((m) => `${m.text}@${m.time}`)).toEqual([
      'B1@2026-04-08',
      'B2@2026-04-10',
      'S1@2026-04-11',
    ]);
    expect(passedMarkers.find((m) => m.text === 'B1')?.position).toBe('belowBar');
    expect(passedMarkers.find((m) => m.text === 'S1')?.position).toBe('aboveBar');
  });

  it('accountId 가 없으면 useTradeCycles 가 enabled=false 로 호출되고 마커는 비어있다', async () => {
    useActiveAccountIdMock.mockReturnValue({ accountId: null, isPending: false });
    fetchChartMock.mockResolvedValueOnce({
      candles: [{ date: '2026-04-10', open: 100, high: 110, low: 90, close: 105, volume: 1 }],
      toMs: Date.UTC(2026, 3, 12),
    });

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);

    await waitFor(() => expect(createChartMock).toHaveBeenCalled());
    const lastCycleCall = useTradeCyclesMock.mock.calls.at(-1);
    expect(lastCycleCall?.[0]).toMatchObject({ enabled: false });
  });

  it('전체 삭제 버튼은 차트 remount 없이 플러그인 removeAllLineTools 를 호출하고 저장본을 비운다', async () => {
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

    window.localStorage.setItem(
      'split-stock.chart.drawings.005930',
      JSON.stringify([
        { id: 'h-1', tool: 'HorizontalLine', price: 70000 },
        { id: 'v-1', tool: 'VerticalLine', time: '2026-04-05' },
      ]),
    );

    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} enableDrawingTools />);

    await waitFor(() => expect(createChartMock.mock.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(addSeriesMock.mock.calls.length).toBeGreaterThan(0));
    const initialChartCallCount = createChartMock.mock.calls.length;
    removePriceLineMock.mockClear();
    detachPrimitiveMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '전체 삭제' }));

    // HorizontalLine 은 removePriceLine 으로, 그 외는 detachPrimitive 로 해제되어야 한다.
    await waitFor(() => expect(removePriceLineMock).toHaveBeenCalledTimes(1));
    expect(detachPrimitiveMock).toHaveBeenCalledTimes(1);
    // 차트 인스턴스는 재생성되지 않아야 한다 — Electron 이 IOSurface 를 반복 할당하다
    // 1x1 크기로 실패해 GPU state invalid 로 멈추는 회귀를 방지한다.
    expect(createChartMock.mock.calls.length).toBe(initialChartCallCount);
    expect(window.localStorage.getItem('split-stock.chart.drawings.005930')).toBeNull();
  });

  // ─── Sub-AC 1.3: 자동 복구 중 안내 ────────────────────────────────────────

  it('fetch가 완료되지 않고 캐시도 비어있으면 자동 복구 중 안내를 표시한다', async () => {
    // never resolves — adapter 내부 retry 중 isLoading=true, candles=0 상태를 재현
    fetchChartMock.mockImplementation(() => new Promise(() => {}));
    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);
    expect(await screen.findByText(/자동 복구 중/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '봉 다시 시도' })).not.toBeInTheDocument();
  });

  it('캐시에 데이터가 있으면 자동 복구 중 안내를 숨기고 차트를 표시한다', async () => {
    window.localStorage.setItem(
      'split-stock.position-chart.005930.D',
      JSON.stringify([
        { date: '2026-04-18', open: 10000, high: 12345, low: 9800, close: 12000, volume: 123456 },
      ]),
    );
    fetchChartMock.mockImplementation(() => new Promise(() => {}));
    render(<PositionChart pdno="005930" name="삼성전자" lines={[]} />);
    await waitFor(() => expect(createChartMock).toHaveBeenCalled());
    expect(screen.queryByText(/자동 복구 중/)).not.toBeInTheDocument();
  });
});
