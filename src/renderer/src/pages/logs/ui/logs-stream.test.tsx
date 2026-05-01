// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../model/use-log-tail';
import { LogsStream } from './logs-stream';

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
    id: 2,
    ts: '2026-04-10T09:01:00Z',
    level: 'INFO',
    category: 'ORDER',
    message: 'order.accepted',
    payloadJson: '{"pdno":"005930"}',
  },
  {
    id: 1,
    ts: '2026-04-10T09:00:00Z',
    level: 'WARN',
    category: 'SYS',
    message: 'sys.warn',
    payloadJson: null,
  },
];

describe('LogsStream', () => {
  it('실시간 로그 영역을 aria live log role로 렌더링한다', () => {
    render(
      <LogsStream
        entries={entries}
        error={null}
        isFilterSettling={false}
        isPending={false}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    const log = screen.getByRole('log', { name: '실시간 이벤트 로그' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('sys.warn')).toBeInTheDocument();
    expect(screen.getByText('order.accepted')).toBeInTheDocument();
  });

  it('사용자가 하단에서 벗어나면 최신 로그 이동 버튼을 표시한다', () => {
    render(
      <LogsStream
        entries={entries}
        error={null}
        isFilterSettling={false}
        isPending={false}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    const log = screen.getByRole('log', { name: '실시간 이벤트 로그' });
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(log, 'scrollTop', { configurable: true, value: 100, writable: true });

    fireEvent.scroll(log);

    expect(screen.getByRole('button', { name: '최신 로그로 이동' })).toBeInTheDocument();
  });
});
