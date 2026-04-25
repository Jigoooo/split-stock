// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TradeHistoryList } from './ui/trade-history-list';

const useTradeCyclesMock = vi.fn();

vi.mock('@renderer/entities/trade-cycle', () => ({
  useTradeCycles: (...args: unknown[]) => useTradeCyclesMock(...args),
}));

const baseCycle = {
  id: 1,
  pdno: '005930',
  name: '삼성전자',
  nth: 1,
  buyPrice: 70_000,
  qty: 3,
  sellPrice: undefined,
  pnl: undefined,
  pnlRate: undefined,
  status: 'OPEN',
  boughtAt: new Date('2026-04-01').toISOString(),
  soldAt: undefined,
};

describe('TradeHistoryList', () => {
  it('개별 종목 매매내역에서는 종목 컬럼을 숨긴다', () => {
    useTradeCyclesMock.mockReturnValue({
      cycles: [baseCycle],
      error: null,
      isPending: false,
    });

    render(<TradeHistoryList accountId={1} pdno="005930" status="all" />);

    expect(screen.queryByText('종목')).not.toBeInTheDocument();
    expect(screen.queryByText('삼성전자')).not.toBeInTheDocument();
    expect(screen.getByText('1차')).toBeInTheDocument();
  });

  it('전체 매매내역에서는 종목 컬럼을 표시한다', () => {
    useTradeCyclesMock.mockReturnValue({
      cycles: [baseCycle],
      error: null,
      isPending: false,
    });

    render(<TradeHistoryList accountId={1} pdno={null} status="all" />);

    expect(screen.getByText('종목')).toBeInTheDocument();
    expect(screen.getByText('삼성전자')).toBeInTheDocument();
  });
});
