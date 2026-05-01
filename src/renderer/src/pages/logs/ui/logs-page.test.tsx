// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type UseLogTailResult, useLogTail } from '../model/use-log-tail';
import { LogsPage } from './logs-page';

vi.mock('@renderer/shared/lib/popout-window', () => ({
  usePopoutVisibility: () => true,
}));

vi.mock('../model/use-log-tail', async () => {
  const actual =
    await vi.importActual<typeof import('../model/use-log-tail')>('../model/use-log-tail');
  return {
    ...actual,
    useLogTail: vi.fn(),
  };
});

const virtualizerMock = vi.hoisted(() => ({
  measureElement: vi.fn(),
  useVirtualizer: vi.fn(
    ({
      count,
      estimateSize,
      getItemKey,
    }: {
      count: number;
      estimateSize: () => number;
      getItemKey?: (index: number) => string | number;
    }) => ({
      getTotalSize: () => count * estimateSize(),
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          end: (index + 1) * estimateSize(),
          index,
          key: getItemKey?.(index) ?? index,
          lane: 0,
          size: estimateSize(),
          start: index * estimateSize(),
        })),
      measureElement: virtualizerMock.measureElement,
    }),
  ),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualizerMock.useVirtualizer,
}));

function hookResult(overrides: Partial<UseLogTailResult> = {}): UseLogTailResult {
  return {
    actions: {
      applyPendingEntries: vi.fn(),
      clearPendingEntries: vi.fn(),
      exportLogs: vi.fn(),
      setCategories: vi.fn(),
      setDateRange: vi.fn(),
      setLevel: vi.fn(),
      setSearch: vi.fn(),
      setStream: vi.fn(),
    },
    data: {
      entries: [
        {
          id: 1,
          ts: '2026-04-10T09:00:00Z',
          level: 'INFO',
          category: 'ORDER',
          message: 'order.accepted',
          payloadJson: null,
        },
      ],
      pendingEntries: [],
    },
    filters: {
      categories: new Set(),
      dateRange: '',
      level: '',
      search: '',
      stream: '',
    },
    status: {
      error: null,
      exportPending: false,
      isFetching: false,
      isFilterSettling: false,
      isPending: false,
      isPlaceholderData: false,
    },
    ...overrides,
  };
}

describe('LogsPage', () => {
  it('목록 모드에서 새 로그 배너를 보여주고 반영 액션을 호출한다', () => {
    const applyPendingEntries = vi.fn();
    vi.mocked(useLogTail).mockReturnValue(
      hookResult({
        actions: {
          ...hookResult().actions,
          applyPendingEntries,
        },
        data: {
          ...hookResult().data,
          pendingEntries: [
            {
              id: 2,
              ts: '2026-04-10T09:01:00Z',
              level: 'INFO',
              category: 'ORDER',
              message: 'order.accepted',
              payloadJson: null,
            },
          ],
        },
      }),
    );

    render(<LogsPage />);

    expect(screen.getByText('새 로그 1건')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '목록에 반영' }));

    expect(applyPendingEntries).toHaveBeenCalledTimes(1);
  });
});
