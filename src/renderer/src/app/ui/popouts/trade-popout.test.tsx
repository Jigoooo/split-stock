// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TradePopout } from './trade-popout';

const mockUseActiveAccountId = vi.fn();

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => mockUseActiveAccountId(),
}));

vi.mock('@renderer/pages/trade', () => ({
  TradePage: () => <div data-testid="stock-trade-page">국내주식 트레이드</div>,
}));

vi.mock('@renderer/pages/main/ui/crypto-main-page', () => ({
  CryptoMainPage: ({ accountId, variant }: { accountId: number; variant?: string }) => (
    <div data-testid="crypto-trade-page" data-account-id={accountId} data-variant={variant} />
  ),
}));

describe('TradePopout', () => {
  beforeEach(() => {
    mockUseActiveAccountId.mockReset();
  });

  it('renders the stock trade page for domestic stock accounts', () => {
    mockUseActiveAccountId.mockReturnValue({
      accountId: 1,
      account: { broker: 'KIS' },
      isPending: false,
    });

    render(<TradePopout popout={{ isOpen: vi.fn(), popout: vi.fn() }} />);

    expect(screen.getByTestId('stock-trade-page')).toBeInTheDocument();
    expect(screen.queryByTestId('crypto-trade-page')).not.toBeInTheDocument();
  });

  it('renders the crypto trade surface instead of stock TradePage for UPBIT accounts', () => {
    mockUseActiveAccountId.mockReturnValue({
      accountId: 2,
      account: { broker: 'UPBIT' },
      isPending: false,
    });

    render(<TradePopout popout={{ isOpen: vi.fn(), popout: vi.fn() }} />);

    expect(screen.getByTestId('crypto-trade-page')).toHaveAttribute('data-account-id', '2');
    expect(screen.getByTestId('crypto-trade-page')).toHaveAttribute('data-variant', 'trade-popout');
    expect(screen.queryByTestId('stock-trade-page')).not.toBeInTheDocument();
  });
});
