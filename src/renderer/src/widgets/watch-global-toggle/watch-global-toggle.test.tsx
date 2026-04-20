// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WatchGlobalToggle } from './ui/watch-global-toggle';

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => ({ accountId: 1, isPending: false }),
}));

vi.mock('@renderer/entities/watch-order', () => ({
  useWatchOrders: (filter: { status?: string }) => {
    if (filter.status === 'WATCHING') {
      return { orders: [{ id: 1 }, { id: 2 }, { id: 3 }], isPending: false, error: null };
    }
    return { orders: [], isPending: false, error: null };
  },
}));

describe('WatchGlobalToggle', () => {
  it('WATCHING 건수를 "자동감시 (N)" 형식으로 표시', () => {
    render(<WatchGlobalToggle />);
    expect(screen.getByText('자동감시 (3)')).toBeInTheDocument();
  });
});
