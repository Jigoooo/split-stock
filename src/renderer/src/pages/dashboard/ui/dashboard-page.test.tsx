// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAccountBalanceMock = vi.fn();
const usePositionOverlayMock = vi.fn();
const useDashboardRealtimeMock = vi.fn();

vi.mock('@renderer/entities/account', () => ({
  useAccountBalance: () => useAccountBalanceMock(),
  usePositionOverlay: () => usePositionOverlayMock(),
}));

vi.mock('@renderer/widgets/position-chart', () => ({
  PositionChart: ({ pdno, name }: { pdno: string; name: string }) => (
    <div>{`chart:${pdno}:${name}`}</div>
  ),
}));

vi.mock('@renderer/widgets/trading-panel', () => ({
  TradingPanel: ({ pdno, name }: { pdno: string; name: string }) => (
    <div>{`trading:${pdno}:${name}`}</div>
  ),
}));

vi.mock('../model/use-dashboard-realtime', () => ({
  useDashboardRealtime: () => useDashboardRealtimeMock(),
}));

import { DashboardPage } from './dashboard-page';

describe('DashboardPage', () => {
  beforeEach(() => {
    usePositionOverlayMock.mockReturnValue({ isPending: false, error: null, lines: [] });
  });

  it('로딩 중에는 상태 패널을 보여준다', () => {
    useAccountBalanceMock.mockReturnValue({
      isPending: true,
      error: null,
      data: null,
    });
    useDashboardRealtimeMock.mockReturnValue({
      isProd: false,
      isStarted: false,
      start: vi.fn(),
      startPending: false,
      startError: null,
    });

    render(<DashboardPage />);

    expect(screen.getByText('잔고 조회 중')).toBeInTheDocument();
  });

  it('에러가 있으면 실패 패널을 보여준다', () => {
    useAccountBalanceMock.mockReturnValue({
      isPending: false,
      error: { message: '잔고 조회 실패' },
      data: null,
    });
    useDashboardRealtimeMock.mockReturnValue({
      isProd: false,
      isStarted: false,
      start: vi.fn(),
      startPending: false,
      startError: null,
    });

    render(<DashboardPage />);

    expect(screen.getAllByText('잔고 조회 실패')).toHaveLength(2);
  });

  it('선택 전에는 상세 placeholder를 보여준다', () => {
    useAccountBalanceMock.mockReturnValue({
      isPending: false,
      error: null,
      data: {
        deposit: 1000000,
        totalEval: 1200000,
        positions: [
          {
            code: '005930',
            name: '삼성전자',
            qty: 10,
            avgPrice: 70000,
            currentPrice: 71000,
            evalAmount: 710000,
            pnlAmount: 10000,
            pnlRate: 1.43,
          },
        ],
      },
    });
    useDashboardRealtimeMock.mockReturnValue({
      isProd: false,
      isStarted: false,
      start: vi.fn(),
      startPending: false,
      startError: null,
    });

    render(<DashboardPage />);

    expect(
      screen.getByText('보유 종목을 선택하면 차트와 주문 패널이 이 영역에 표시됩니다.'),
    ).toBeInTheDocument();
  });

  it('행 클릭 후 실시간 시작 전에는 시작 패널을 보여주고 버튼이 start를 호출한다', () => {
    const startMock = vi.fn();
    useAccountBalanceMock.mockReturnValue({
      isPending: false,
      error: null,
      data: {
        deposit: 1000000,
        totalEval: 1200000,
        positions: [
          {
            code: '005930',
            name: '삼성전자',
            qty: 10,
            avgPrice: 70000,
            currentPrice: 71000,
            evalAmount: 710000,
            pnlAmount: 10000,
            pnlRate: 1.43,
          },
        ],
      },
    });
    useDashboardRealtimeMock.mockReturnValue({
      isProd: false,
      isStarted: false,
      start: startMock,
      startPending: false,
      startError: null,
    });

    render(<DashboardPage />);

    fireEvent.click(screen.getByText('삼성전자'));

    expect(screen.getByText('chart:005930:삼성전자')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실시간 시작' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '실시간 시작' }));
    expect(startMock).toHaveBeenCalled();
  });

  it('실시간이 시작된 상태에서 행 클릭 후 trading panel을 보여준다', () => {
    useAccountBalanceMock.mockReturnValue({
      isPending: false,
      error: null,
      data: {
        deposit: 1000000,
        totalEval: 1200000,
        positions: [
          {
            code: '005930',
            name: '삼성전자',
            qty: 10,
            avgPrice: 70000,
            currentPrice: 71000,
            evalAmount: 710000,
            pnlAmount: 10000,
            pnlRate: 1.43,
          },
        ],
      },
    });
    useDashboardRealtimeMock.mockReturnValue({
      isProd: true,
      isStarted: true,
      start: vi.fn(),
      startPending: false,
      startError: null,
    });

    render(<DashboardPage />);

    fireEvent.click(screen.getByText('삼성전자'));

    expect(screen.getByText('chart:005930:삼성전자')).toBeInTheDocument();
    expect(screen.getByText('trading:005930:삼성전자')).toBeInTheDocument();
  });
});
