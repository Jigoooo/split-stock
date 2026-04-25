// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WatchGlobalToggle } from './watch-global-toggle';

const { mutateMock, invalidateMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => ({ accountId: 1, isPending: false }),
}));

vi.mock('@renderer/entities/watch-order', () => ({
  useWatchControlState: () => ({
    state: {
      globalEnabled: true,
      watchingCount: 2,
      pausedCount: 1,
      totalTrackedCount: 3,
    },
    isPending: false,
    error: null,
  }),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      watch: {
        getControlState: { invalidate: invalidateMock },
        list: { invalidate: invalidateMock },
        history: { invalidate: invalidateMock },
      },
    }),
    watch: {
      setGlobalEnabled: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
    },
  },
}));

describe('WatchGlobalToggle', () => {
  it('전역 상태와 전체 건수를 switch 상태로 표시', () => {
    render(<WatchGlobalToggle />);
    expect(screen.getByRole('switch', { name: '자동감시 ON (3)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText('ON (3)')).toBeInTheDocument();
  });

  it('클릭 시 전역 OFF mutation 호출', () => {
    render(<WatchGlobalToggle />);
    fireEvent.click(screen.getByRole('switch', { name: '자동감시 ON (3)' }));
    expect(mutateMock).toHaveBeenCalledWith({ enabled: false });
  });
});
