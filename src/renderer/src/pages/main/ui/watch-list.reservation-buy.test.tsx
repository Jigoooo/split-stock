// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WatchList } from './watch-list';

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      watch: {
        list: { invalidate: vi.fn() },
        getControlState: { invalidate: vi.fn() },
        history: { invalidate: vi.fn() },
      },
    }),
    watch: {
      pause: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      resume: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      cancel: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

describe('WatchList reservation buy contraction', () => {
  it('방향/비교 컬럼을 숨기고 예약매수 라벨을 사용', () => {
    render(
      <WatchList
        orders={[
          {
            id: 1,
            accountId: 1,
            pdno: '005930',
            source: 'CUSTOM',
            side: 'BUY',
            targetPrice: 60_000,
            comparator: 'LTE',
            orderType: 'LIMIT',
            qtyOrAmountMode: 'QTY',
            qty: 10,
            amountKrw: null,
            nth: null,
            sourceRefId: null,
            expiresAt: null,
            status: 'WATCHING',
            lastFailureReason: null,
            metadata: null,
            createdAt: new Date('2026-04-01T00:00:00Z'),
            updatedAt: new Date('2026-04-01T00:00:00Z'),
            executedAt: null,
          },
        ]}
        isPending={false}
        error={null}
        allowMutations={false}
      />,
    );

    expect(screen.queryByText('방향')).not.toBeInTheDocument();
    expect(screen.queryByText('비교')).not.toBeInTheDocument();
    expect(screen.getByText('예약매수')).toBeInTheDocument();
  });
});
