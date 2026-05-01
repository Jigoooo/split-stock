// @vitest-environment jsdom

import type { EventLogPush } from '@shared/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trpcMock = vi.hoisted(() => ({
  exportMutateAsync: vi.fn(),
  refetch: vi.fn(),
  tailData: { entries: [] as unknown[] },
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    logs: {
      export: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: trpcMock.exportMutateAsync,
        }),
      },
      tail: {
        useQuery: vi.fn(() => ({
          data: trpcMock.tailData,
          error: null,
          isFetching: false,
          isPending: false,
          isPlaceholderData: false,
          refetch: trpcMock.refetch,
        })),
      },
    },
  },
}));

import {
  areLogEntriesEqual,
  buildLogQueryInput,
  LOG_TAIL_LIMIT,
  type LogEntry,
  type LogQueryFilters,
  matchesLogFilters,
  useLogTail,
} from './use-log-tail';

let pushedListener: ((entry: EventLogPush) => void) | null = null;

const baseEntry: LogEntry = {
  id: 1,
  ts: '2026-04-10T09:00:00Z',
  level: 'INFO',
  category: 'ORDER',
  message: 'order.accepted',
  payloadJson: '{"pdno":"005930"}',
};

function pushedEntry(overrides: Partial<EventLogPush> = {}): EventLogPush {
  return {
    id: 2,
    ts: new Date('2026-04-10T09:01:00Z').getTime(),
    level: 'INFO',
    category: 'ORDER',
    message: 'order.accepted',
    payloadJson: '{"pdno":"005930"}',
    ...overrides,
  };
}

function filters(overrides: Partial<LogQueryFilters> = {}): LogQueryFilters {
  return {
    categories: new Set(),
    dateRange: '',
    level: '',
    search: '',
    stream: '',
    ...overrides,
  };
}

beforeEach(() => {
  pushedListener = null;
  trpcMock.exportMutateAsync.mockReset();
  trpcMock.refetch.mockReset();
  trpcMock.tailData = { entries: [baseEntry] };
  window.appShell = {
    onEventLogAppended: vi.fn((listener) => {
      pushedListener = listener;
      return vi.fn();
    }),
  } as unknown as NonNullable<typeof window.appShell>;
});

describe('buildLogQueryInput', () => {
  it('tail/export 공통 필터를 동일한 query input 형태로 직렬화한다', () => {
    expect(
      buildLogQueryInput(
        filters({
          categories: new Set(['ORDER', '']),
          dateRange: 'today',
          level: 'WARN',
          search: '  005930  ',
          stream: 'normal',
        }),
        200,
      ),
    ).toEqual({
      categories: ['ORDER'],
      dateRange: 'today',
      level: 'WARN',
      limit: 200,
      search: '005930',
      stream: 'normal',
    });
  });

  it('빈 필터는 query input에서 생략한다', () => {
    expect(buildLogQueryInput(filters(), 200)).toEqual({ limit: 200 });
    expect(buildLogQueryInput(filters({ search: '   ' }))).toEqual({});
  });
});

describe('areLogEntriesEqual', () => {
  const base: LogEntry[] = [baseEntry];

  it('동일 로그 목록은 timestamp 표현이 달라도 같은 목록으로 판단한다', () => {
    expect(
      areLogEntriesEqual(base, [
        {
          ...baseEntry,
          ts: '2026-04-10T09:00:00.000Z',
        },
      ]),
    ).toBe(true);
  });

  it('payload가 바뀌면 다른 목록으로 판단한다', () => {
    expect(
      areLogEntriesEqual(base, [
        {
          ...baseEntry,
          payloadJson: '{"pdno":"000660"}',
        },
      ]),
    ).toBe(false);
  });
});

describe('matchesLogFilters', () => {
  it('level/category/search/dateRange가 맞는 로그를 통과시킨다', () => {
    expect(
      matchesLogFilters(
        baseEntry,
        filters({
          categories: new Set(['ORDER']),
          dateRange: 'today',
          level: 'INFO',
          search: '005930',
          stream: 'normal',
        }),
        new Date('2026-04-10T12:00:00Z'),
      ),
    ).toBe(true);
  });

  it('필터에 맞지 않는 로그를 거절한다', () => {
    expect(matchesLogFilters(baseEntry, filters({ level: 'ERROR' }))).toBe(false);
    expect(matchesLogFilters(baseEntry, filters({ categories: new Set(['SYS']) }))).toBe(false);
    expect(matchesLogFilters(baseEntry, filters({ search: '000660' }))).toBe(false);
    expect(
      matchesLogFilters(
        { ...baseEntry, ts: '2026-04-09T14:59:59Z' },
        filters({ dateRange: 'today' }),
        new Date('2026-04-10T12:00:00Z'),
      ),
    ).toBe(false);
  });
});

describe('useLogTail push updates', () => {
  it('목록 모드에서는 push 로그를 pendingEntries에 보류하고 표시 목록은 유지한다', async () => {
    const { result } = renderHook(() => useLogTail({ liveUpdatesEnabled: true, viewMode: 'list' }));

    await waitFor(() => expect(pushedListener).not.toBeNull());
    await waitFor(() => expect(result.current.data.entries).toHaveLength(1));

    act(() => pushedListener?.(pushedEntry()));

    expect(result.current.data.pendingEntries).toHaveLength(1);
    expect(result.current.data.entries.map((entry) => entry.id)).toEqual([1]);
  });

  it('applyPendingEntries는 pending을 prepend하고 id를 dedupe하며 limit로 자른다', async () => {
    const { result } = renderHook(() => useLogTail({ liveUpdatesEnabled: true, viewMode: 'list' }));

    await waitFor(() => expect(pushedListener).not.toBeNull());
    await waitFor(() => expect(result.current.data.entries).toHaveLength(1));

    act(() => {
      for (let id = 2; id <= LOG_TAIL_LIMIT + 6; id += 1) {
        pushedListener?.(pushedEntry({ id, ts: new Date('2026-04-10T09:01:00Z').getTime() + id }));
      }
      pushedListener?.(pushedEntry({ id: LOG_TAIL_LIMIT + 6 }));
    });
    act(() => result.current.actions.applyPendingEntries());

    const ids = result.current.data.entries.map((entry) => entry.id);
    expect(result.current.data.pendingEntries).toHaveLength(0);
    expect(ids).toHaveLength(LOG_TAIL_LIMIT);
    expect(new Set(ids).size).toBe(LOG_TAIL_LIMIT);
    expect(ids[0]).toBe(LOG_TAIL_LIMIT + 6);
  });

  it('실시간 모드에서는 push 로그가 즉시 표시 목록에 반영된다', async () => {
    const { result } = renderHook(() => useLogTail({ liveUpdatesEnabled: true, viewMode: 'live' }));

    await waitFor(() => expect(pushedListener).not.toBeNull());
    await waitFor(() => expect(result.current.data.entries).toHaveLength(1));

    act(() => pushedListener?.(pushedEntry({ id: 3 })));

    expect(result.current.data.pendingEntries).toHaveLength(0);
    expect(result.current.data.entries.map((entry) => entry.id)).toEqual([3, 1]);
  });
});
