// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PastTradesPane } from './ui/past-trades-pane';

const mockUseBalanceWithLots = vi.fn();
const mockUseTradeCycles = vi.fn();

vi.mock('@renderer/entities/account', () => ({
  useBalanceWithLots: () => mockUseBalanceWithLots(),
}));

vi.mock('@renderer/entities/trade-cycle', () => ({
  useTradeCycles: (input: unknown) => mockUseTradeCycles(input),
}));

const makeCycle = (overrides: Record<string, unknown>) => ({
  id: 1,
  nth: 1,
  pdno: '000660',
  name: 'SK하이닉스',
  buyPrice: 70_000,
  qty: 10,
  amountKrw: 700_000,
  status: 'SOLD',
  boughtAt: Date.parse('2026-04-01T00:00:00Z'),
  soldAt: Date.parse('2026-04-10T00:00:00Z'),
  sellPrice: 77_000,
  pnl: 70_000,
  pnlRate: 10,
  ...overrides,
});

const mockBalance = (positions: ReadonlyArray<{ code: string; name: string }> = []) => ({
  positions: positions.map((position) => ({
    ...position,
    qty: 10,
    avgPrice: 50_000,
    currentPrice: 52_000,
    evalAmount: 520_000,
    pnlAmount: 20_000,
    pnlRate: 4,
  })),
  isPending: false,
  error: null,
});

describe('PastTradesPane', () => {
  beforeEach(() => {
    mockUseBalanceWithLots.mockReset();
    mockUseTradeCycles.mockReset();
    mockUseBalanceWithLots.mockReturnValue(mockBalance());
    mockUseTradeCycles.mockReturnValue({
      cycles: [],
      isPending: false,
      error: null,
    });
  });

  it('SOLD 이력이 있어도 현재 보유 중인 종목은 과거 거래 종목 목록에서 제외한다', () => {
    mockUseBalanceWithLots.mockReturnValue(mockBalance([{ code: '005930', name: '삼성전자' }]));
    mockUseTradeCycles.mockReturnValue({
      cycles: [
        makeCycle({
          id: 1,
          pdno: '005930',
          name: '삼성전자',
          amountKrw: 650_000,
          buyPrice: 65_000,
          sellPrice: 70_000,
        }),
        makeCycle({ id: 2 }),
      ],
      isPending: false,
      error: null,
    });

    render(<PastTradesPane accountId={1} />);

    expect(screen.getByText('과거 거래 종목 (현재 미보유 1종목)')).toBeInTheDocument();
    expect(screen.queryByText('삼성전자')).toBeNull();
    expect(screen.getByText('SK하이닉스')).toBeInTheDocument();
  });

  it('미보유 과거 종목은 키보드로 상세 진입하고 목록으로 돌아올 수 있다', () => {
    mockUseTradeCycles.mockReturnValue({
      cycles: [makeCycle({ id: 2 })],
      isPending: false,
      error: null,
    });

    render(<PastTradesPane accountId={1} />);

    const row = screen.getByRole('button', { name: /SK하이닉스/ });
    expect(row).toHaveStyle({ cursor: 'pointer' });

    fireEvent.keyDown(row, { key: 'Enter' });

    expect(screen.getByRole('button', { name: '목록으로' })).toBeInTheDocument();
    expect(screen.getByLabelText('SK하이닉스 과거 거래 요약')).toBeInTheDocument();
    expect(screen.getByText('총 매수 700,000')).toBeInTheDocument();
    expect(screen.getByText('총 매도 770,000')).toBeInTheDocument();
    expect(screen.getAllByText('수익률')).toHaveLength(1);
    expect(screen.getAllByText('10.00%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1차')).toBeInTheDocument();
    expect(screen.getByText('+70,000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '목록으로' }));

    expect(screen.getByText('과거 거래 종목 (현재 미보유 1종목)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '목록으로' })).toBeNull();
  });

  it('미보유 과거 거래 종목이 없으면 전용 empty state를 표시한다', () => {
    render(<PastTradesPane accountId={1} />);

    expect(screen.getByText('현재 미보유 과거 거래 종목이 없습니다.')).toBeInTheDocument();
  });
});
