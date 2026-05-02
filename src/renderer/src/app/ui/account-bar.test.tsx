// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountBar } from './account-bar';

const mockUseActiveAccountId = vi.fn();

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => mockUseActiveAccountId(),
}));

vi.mock('@renderer/features/switch-account', () => ({
  AccountSelector: () => <button type="button">계좌 선택</button>,
}));

vi.mock('@renderer/features/safety-switch', () => ({
  SafetySwitchHeader: () => <button type="button">주문 허용</button>,
}));

vi.mock('@renderer/features/watch-global-toggle', () => ({
  WatchGlobalToggle: () => <button type="button">자동감시</button>,
}));

vi.mock('@renderer/features/trading-day-status', () => ({
  TradingDayStatusBadge: () => <span>거래일</span>,
}));

vi.mock('@renderer/features/ai-symbol-recommend', () => ({
  RecommendStatusButton: () => <button type="button">종목 추천</button>,
}));

vi.mock('@renderer/features/ai-strategy-recommend', () => ({
  StrategyRecommendStatusButton: () => <button type="button">전략 추천</button>,
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    monitoring: {
      getRealtimeStats: {
        useQuery: () => ({ data: { restFallbackCount: 0, wsCount: 0, capacity: 0 } }),
      },
    },
  },
}));

describe('AccountBar', () => {
  beforeEach(() => {
    mockUseActiveAccountId.mockReset();
  });

  it('keeps stock-only status controls for domestic stock accounts', () => {
    mockUseActiveAccountId.mockReturnValue({
      accountId: 1,
      account: { broker: 'KIS' },
      isPending: false,
    });

    render(<AccountBar env="PROD" />);

    expect(screen.getByRole('button', { name: '주문 허용' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '자동감시' })).toBeInTheDocument();
    expect(screen.getByText('거래일')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '종목 추천' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전략 추천' })).toBeInTheDocument();
  });

  it('hides stock-only status controls for UPBIT accounts', () => {
    mockUseActiveAccountId.mockReturnValue({
      accountId: 2,
      account: { broker: 'UPBIT' },
      isPending: false,
    });

    render(<AccountBar env="PROD" />);

    expect(screen.getByText('UPBIT')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '주문 허용' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '자동감시' })).not.toBeInTheDocument();
    expect(screen.queryByText('거래일')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '종목 추천' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '전략 추천' })).not.toBeInTheDocument();
  });
});
