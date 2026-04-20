// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllTradeHistoryPanel } from './ui/all-trade-history-panel';

const mockTradeHistoryUseQuery = vi.fn();
const mockUseBalanceWithLots = vi.fn();

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    lots: {
      tradeHistory: {
        useQuery: (input: unknown) => mockTradeHistoryUseQuery(input),
      },
    },
  },
}));

vi.mock('@renderer/entities/account', () => ({
  useBalanceWithLots: () => mockUseBalanceWithLots(),
}));

describe('AllTradeHistoryPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T09:00:00Z'));
    mockTradeHistoryUseQuery.mockReset();
    mockUseBalanceWithLots.mockReset();
    mockUseBalanceWithLots.mockReturnValue({
      positions: [],
      deposit: 0,
      totalEval: 0,
      lotsByPdno: {},
      strategiesByPdno: {},
      isPending: false,
      error: null,
    });
    mockTradeHistoryUseQuery.mockReturnValue({
      data: { lots: [] },
      isPending: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('검색 draft 는 조회 버튼 클릭 전까지 query input에 반영되지 않는다', () => {
    render(<AllTradeHistoryPanel accountId={1} />);

    expect(mockTradeHistoryUseQuery).toHaveBeenLastCalledWith({
      accountId: 1,
      year: 2026,
      month: 4,
    });

    fireEvent.change(screen.getByLabelText('모든 매매 내역 검색어'), {
      target: { value: '삼성' },
    });

    expect(mockTradeHistoryUseQuery).toHaveBeenLastCalledWith({
      accountId: 1,
      year: 2026,
      month: 4,
    });

    fireEvent.click(screen.getByRole('button', { name: '조회' }));

    expect(mockTradeHistoryUseQuery).toHaveBeenLastCalledWith({
      accountId: 1,
      year: 2026,
      month: 4,
      search: '삼성',
    });
  });

  it('lot을 매수/매도 행으로 펼치고 KPI를 집계한다', () => {
    mockTradeHistoryUseQuery.mockReturnValue({
      data: {
        lots: [
          {
            id: 11,
            pdno: '005930',
            name: '삼성전자',
            nth: 2,
            qty: 12,
            amountKrw: 780_000,
            status: 'SOLD',
            buyPrice: 65_000,
            boughtAt: Date.parse('2026-03-28T00:00:00Z'),
            soldAt: Date.parse('2026-04-05T00:00:00Z'),
            sellPrice: 70_000,
          },
          {
            id: 12,
            pdno: '000660',
            name: 'SK하이닉스',
            nth: 1,
            qty: 10,
            amountKrw: 700_000,
            status: 'OPEN',
            buyPrice: 70_000,
            boughtAt: Date.parse('2026-04-01T00:00:00Z'),
          },
        ],
      },
      isPending: false,
      error: null,
    });
    mockUseBalanceWithLots.mockReturnValue({
      positions: [
        {
          code: '000660',
          name: 'SK하이닉스',
          qty: 10,
          avgPrice: 70_000,
          currentPrice: 72_000,
          evalAmount: 720_000,
          pnlAmount: 20_000,
          pnlRate: 0.0286,
        },
      ],
      deposit: 0,
      totalEval: 0,
      lotsByPdno: {},
      strategiesByPdno: {},
      isPending: false,
      error: null,
    });

    render(<AllTradeHistoryPanel accountId={1} />);

    expect(screen.getByText('2건')).toBeInTheDocument();
    expect(screen.getByText('1,480,000')).toBeInTheDocument();
    expect(screen.getByText('1,560,000')).toBeInTheDocument();
    expect(screen.getByText('+80,000')).toBeInTheDocument();
    expect(screen.getByText('5.41%')).toBeInTheDocument();
    expect(screen.getByText('2026.03.28')).toBeInTheDocument();
    expect(screen.getByText('2026.04.05')).toBeInTheDocument();
    expect(screen.getByText('+60,000')).toBeInTheDocument();
    expect(screen.getByText('7.69%')).toBeInTheDocument();

    const rows = document.querySelectorAll('[data-grid-role="row"]');
    expect(rows).toHaveLength(3);
  });

  it('현재가가 없으면 OPEN lot은 평가금액=매입금액, 손익=0으로 fallback 한다', () => {
    mockTradeHistoryUseQuery.mockReturnValue({
      data: {
        lots: [
          {
            id: 1,
            pdno: '005930',
            name: '삼성전자',
            nth: 1,
            qty: 10,
            amountKrw: 700_000,
            status: 'OPEN',
            buyPrice: 70_000,
            boughtAt: Date.parse('2026-04-01T00:00:00Z'),
          },
        ],
      },
      isPending: false,
      error: null,
    });

    render(<AllTradeHistoryPanel accountId={1} />);

    expect(screen.getAllByText('700,000')).toHaveLength(2);
    expect(screen.getByText('0.00%')).toBeInTheDocument();
  });

  it('결과가 비면 empty state를 표시한다', () => {
    render(<AllTradeHistoryPanel accountId={1} />);

    expect(screen.getByText('매매 내역 없음')).toBeInTheDocument();
  });
});
