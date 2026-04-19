// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchChartMock = vi.fn();
const trpcUtilsMock = {
  market: {
    getDailyChart: {
      fetch: fetchChartMock,
    },
  },
};

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => trpcUtilsMock,
  },
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: Symbol('CandlestickSeries'),
  LineStyle: {
    Solid: 0,
    Dashed: 1,
  },
  createChart: () => ({
    applyOptions: vi.fn(),
    remove: vi.fn(),
    addSeries: () => ({
      setData: vi.fn(),
      createPriceLine: vi.fn(),
      removePriceLine: vi.fn(),
    }),
    removeSeries: vi.fn(),
    timeScale: () => ({
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      getVisibleLogicalRange: () => null,
      setVisibleLogicalRange: vi.fn(),
    }),
  }),
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
});
