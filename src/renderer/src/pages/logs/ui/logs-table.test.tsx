// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../model/use-log-tail';
import { LogsTable } from './logs-table';

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

const entries: LogEntry[] = [
  {
    id: 1,
    ts: '2026-04-10T09:00:00Z',
    level: 'INFO',
    category: 'ORDER',
    message: 'order.accepted',
    payloadJson: '{"pdno":"005930","reason":"manual","attempt":1}',
  },
  {
    id: 2,
    ts: '2026-04-10T09:01:00Z',
    level: 'ERROR',
    category: 'SYS',
    message: 'sys.failed',
    payloadJson: '{"code":"E001"}',
  },
];

describe('LogsTable', () => {
  it('TanStack virtualizer에 안정적인 row key와 비동기 flush 옵션을 전달한다', () => {
    render(
      <LogsTable
        entries={entries}
        error={null}
        isFilterSettling={false}
        isPending={false}
        selectedId={2}
        onSelect={vi.fn()}
      />,
    );

    expect(virtualizerMock.useVirtualizer).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 2,
        getItemKey: expect.any(Function),
        useFlushSync: false,
      }),
    );
    const options = virtualizerMock.useVirtualizer.mock.calls.at(-1)?.[0] as {
      getItemKey: (index: number) => string | number;
    };
    expect(options.getItemKey(1)).toBe(2);
  });

  it('message와 payload preview를 행 안에 함께 표시하고 선택 상태를 유지한다', () => {
    render(
      <LogsTable
        entries={entries}
        error={null}
        isFilterSettling={false}
        isPending={false}
        selectedId={2}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('order.accepted')).toBeInTheDocument();
    expect(screen.getByText('pdno')).toBeInTheDocument();
    expect(screen.getByText('005930')).toBeInTheDocument();
    const selectedRow = screen.getByText('sys.failed').closest('[data-grid-role="row"]');
    expect(selectedRow).toHaveAttribute('data-selected', 'true');
  });

  it('초기 로딩은 고정 geometry skeleton rows로 표시한다', () => {
    render(
      <LogsTable
        entries={[]}
        error={null}
        isFilterSettling={false}
        isPending
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(document.querySelectorAll('.logs-table__skeleton-row')).toHaveLength(8);
  });

  it('필터 반영 중에는 기존 rows를 유지하면서 얇은 상태 표시를 보여준다', () => {
    render(
      <LogsTable
        entries={entries}
        error={null}
        isFilterSettling
        isPending={false}
        selectedId={1}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('필터 반영 중...')).toBeInTheDocument();
    expect(screen.getByText('order.accepted')).toBeInTheDocument();
  });
});
