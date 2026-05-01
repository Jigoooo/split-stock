import { trpc } from '@renderer/shared/api/trpc';
import type { EventLogPush } from '@shared/contracts';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

export const LOG_LEVELS = ['', 'INFO', 'WARN', 'ERROR'] as const;
export const LOG_STREAMS = ['', 'normal', 'error'] as const;
export const LOG_TAIL_LIMIT = 200;
export const LOG_CATEGORIES = [
  '',
  'AUTH',
  'ORDER',
  'FSM',
  'WS',
  'SYS',
  'BALANCE',
  'CANCEL',
  'AI',
] as const;
export const LOG_EXPORT_FORMATS = ['csv', 'json'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogStream = (typeof LOG_STREAMS)[number];
export type LogCategory = (typeof LOG_CATEGORIES)[number];
export type LogDateRange = 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' | '';
export type LogExportFormat = (typeof LOG_EXPORT_FORMATS)[number];
export type LogViewMode = 'list' | 'live';
type ActiveLogLevel = Exclude<LogLevel, ''>;
type ActiveLogStream = Exclude<LogStream, ''>;
type ActiveLogCategory = Exclude<LogCategory, ''>;

export interface LogQueryFilters {
  categories: ReadonlySet<LogCategory>;
  dateRange: LogDateRange;
  level: LogLevel;
  search: string;
  stream: LogStream;
}

export interface LogQueryInput {
  categories?: ActiveLogCategory[];
  dateRange?: Exclude<LogDateRange, ''>;
  level?: ActiveLogLevel;
  limit?: number;
  search?: string;
  stream?: ActiveLogStream;
}

export interface LogExportResult {
  canceled: boolean;
  count?: number;
  filename?: string;
  format?: LogExportFormat;
  path?: string;
}

export interface LogEntry {
  id: number | string;
  ts: Date | number | string;
  level: string;
  category: string;
  message: string;
  payloadJson: string | null;
}

function logTsKey(ts: LogEntry['ts']): number | string {
  if (ts instanceof Date) {
    return ts.getTime();
  }

  const time = new Date(ts).getTime();
  return Number.isNaN(time) ? String(ts) : time;
}

function toLogTime(ts: LogEntry['ts']): number {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime();
}

export function areLogEntriesEqual(prev: readonly LogEntry[], next: readonly LogEntry[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;

  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (!a || !b) return false;
    if (
      a.id !== b.id ||
      logTsKey(a.ts) !== logTsKey(b.ts) ||
      a.level !== b.level ||
      a.category !== b.category ||
      a.message !== b.message ||
      a.payloadJson !== b.payloadJson
    ) {
      return false;
    }
  }

  return true;
}

export interface UseLogTailResult {
  actions: {
    applyPendingEntries: () => void;
    clearPendingEntries: () => void;
    exportLogs: (format: LogExportFormat) => Promise<LogExportResult>;
    setCategories: (categories: Set<LogCategory>) => void;
    setDateRange: (dateRange: LogDateRange) => void;
    setLevel: (level: LogLevel) => void;
    setSearch: (search: string) => void;
    setStream: (stream: LogStream) => void;
  };
  data: {
    entries: LogEntry[];
    pendingEntries: LogEntry[];
  };
  filters: {
    categories: Set<LogCategory>;
    dateRange: LogDateRange;
    level: LogLevel;
    search: string;
    stream: LogStream;
  };
  status: {
    error: { message: string } | null;
    exportPending: boolean;
    isFetching: boolean;
    isFilterSettling: boolean;
    isPlaceholderData: boolean;
    isPending: boolean;
  };
}

export interface UseLogTailOptions {
  liveUpdatesEnabled?: boolean;
  popoutVisible?: boolean;
  viewMode?: LogViewMode;
}

export function buildLogQueryInput(filters: LogQueryFilters, limit?: number): LogQueryInput {
  const input: LogQueryInput = {};
  const categories = Array.from(filters.categories).filter(
    (category): category is ActiveLogCategory => category !== '',
  );
  const search = filters.search.trim();

  if (limit !== undefined) input.limit = limit;
  if (filters.level) input.level = filters.level as ActiveLogLevel;
  if (filters.stream) input.stream = filters.stream as ActiveLogStream;
  if (categories.length > 0) input.categories = categories;
  if (search) input.search = search;
  if (filters.dateRange) input.dateRange = filters.dateRange as Exclude<LogDateRange, ''>;

  return input;
}

function resolveLogStartDate(dateRange: LogDateRange, now: Date = new Date()): Date | null {
  if (!dateRange) return null;

  switch (dateRange) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'lastMonth':
      return new Date(now.getFullYear(), now.getMonth() - 1, 1);
    case 'last3Months':
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
  }
}

export function matchesLogFilters(
  entry: LogEntry,
  filters: LogQueryFilters,
  now: Date = new Date(),
): boolean {
  if (filters.level && entry.level !== filters.level) return false;
  if (filters.stream === 'error' && entry.level !== 'ERROR') return false;
  if (filters.stream === 'normal' && entry.level === 'ERROR') return false;

  const activeCategories = Array.from(filters.categories).filter(
    (category): category is ActiveLogCategory => category !== '',
  );
  if (
    activeCategories.length > 0 &&
    !activeCategories.includes(entry.category as ActiveLogCategory)
  ) {
    return false;
  }

  const search = filters.search.trim().toLowerCase();
  if (search) {
    const payload = entry.payloadJson ?? '';
    if (!entry.message.toLowerCase().includes(search) && !payload.toLowerCase().includes(search)) {
      return false;
    }
  }

  const startDate = resolveLogStartDate(filters.dateRange, now);
  if (startDate) {
    const time = toLogTime(entry.ts);
    if (Number.isNaN(time) || time < startDate.getTime()) return false;
  }

  return true;
}

function toLogEntry(entry: EventLogPush): LogEntry {
  return {
    id: entry.id,
    ts: entry.ts,
    level: entry.level,
    category: entry.category,
    message: entry.message,
    payloadJson: entry.payloadJson,
  };
}

function prependUniqueEntries(
  nextEntries: readonly LogEntry[],
  currentEntries: readonly LogEntry[],
  limit: number,
): LogEntry[] {
  const seen = new Set<LogEntry['id']>();
  const merged: LogEntry[] = [];

  for (const entry of [...nextEntries, ...currentEntries]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
    if (merged.length >= limit) break;
  }

  return merged;
}

function useStableLogEntries(entries: readonly LogEntry[]): LogEntry[] {
  const entriesRef = useRef<LogEntry[]>([]);

  return useMemo(() => {
    if (areLogEntriesEqual(entriesRef.current, entries)) {
      return entriesRef.current;
    }

    entriesRef.current = [...entries];
    return entriesRef.current;
  }, [entries]);
}

export function useLogTail(options: UseLogTailOptions = {}): UseLogTailResult {
  const [level, setLevel] = useState<LogLevel>('');
  const [stream, setStream] = useState<LogStream>('');
  const [categories, setCategories] = useState<Set<LogCategory>>(new Set());
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<LogDateRange>('');
  const [committedEntries, setCommittedEntries] = useState<LogEntry[]>([]);
  const [pendingEntries, setPendingEntries] = useState<LogEntry[]>([]);
  const pendingEntriesRef = useRef<LogEntry[]>([]);
  const wasVisibleRef = useRef(options.popoutVisible ?? true);
  const viewMode = options.viewMode ?? 'list';
  const exportMutation = trpc.logs.export.useMutation();

  const deferredLevel = useDeferredValue(level);
  const deferredStream = useDeferredValue(stream);
  const deferredCategories = useDeferredValue(categories);
  const deferredSearch = useDeferredValue(search);
  const deferredDateRange = useDeferredValue(dateRange);
  const isFilterSettling =
    level !== deferredLevel ||
    stream !== deferredStream ||
    categories !== deferredCategories ||
    search !== deferredSearch ||
    dateRange !== deferredDateRange;

  const deferredFilters = useMemo<LogQueryFilters>(
    () => ({
      categories: deferredCategories,
      dateRange: deferredDateRange,
      level: deferredLevel,
      search: deferredSearch,
      stream: deferredStream,
    }),
    [deferredCategories, deferredDateRange, deferredLevel, deferredSearch, deferredStream],
  );

  const tailInput = useMemo(
    () => buildLogQueryInput(deferredFilters, LOG_TAIL_LIMIT),
    [deferredFilters],
  );
  const exportInput = useMemo(() => buildLogQueryInput(deferredFilters), [deferredFilters]);
  const deferredFilterSignature = useMemo(() => JSON.stringify(tailInput), [tailInput]);

  const tail = trpc.logs.tail.useQuery(tailInput, {
    placeholderData: (previousData) => previousData,
    refetchInterval: false,
  });

  const queryEntries = useStableLogEntries(tail.data?.entries ?? []);

  useEffect(() => {
    setCommittedEntries(queryEntries);
  }, [queryEntries]);

  useEffect(() => {
    setPendingEntries((current) => (deferredFilterSignature && current.length > 0 ? [] : current));
  }, [deferredFilterSignature]);

  useEffect(() => {
    pendingEntriesRef.current = pendingEntries;
  }, [pendingEntries]);

  useEffect(() => {
    const visible = options.popoutVisible ?? true;
    if (visible && !wasVisibleRef.current) {
      void tail.refetch();
    }
    wasVisibleRef.current = visible;
  }, [options.popoutVisible, tail.refetch]);

  useEffect(() => {
    if (!options.liveUpdatesEnabled) return;

    return window.appShell?.onEventLogAppended?.((pushedEntry) => {
      const entry = toLogEntry(pushedEntry);
      if (!matchesLogFilters(entry, deferredFilters)) return;

      if (viewMode === 'live') {
        setCommittedEntries((current) => prependUniqueEntries([entry], current, LOG_TAIL_LIMIT));
        return;
      }

      setPendingEntries((current) => prependUniqueEntries([entry], current, LOG_TAIL_LIMIT));
    });
  }, [deferredFilters, options.liveUpdatesEnabled, viewMode]);

  const entries = useStableLogEntries(committedEntries);
  const stablePendingEntries = useStableLogEntries(pendingEntries);

  const applyPendingEntries = useCallback(() => {
    const currentPendingEntries = pendingEntriesRef.current;
    if (currentPendingEntries.length === 0) return;

    setCommittedEntries((current) =>
      prependUniqueEntries(currentPendingEntries, current, LOG_TAIL_LIMIT),
    );
    setPendingEntries([]);
  }, []);

  const clearPendingEntries = useCallback(() => {
    setPendingEntries([]);
  }, []);

  const exportLogs = useCallback(
    async (format: LogExportFormat): Promise<LogExportResult> =>
      exportMutation.mutateAsync({
        format,
        ...exportInput,
      }),
    [exportInput, exportMutation],
  );

  const actions = useMemo(
    () => ({
      applyPendingEntries,
      clearPendingEntries,
      exportLogs,
      setCategories,
      setDateRange,
      setLevel,
      setSearch,
      setStream,
    }),
    [applyPendingEntries, clearPendingEntries, exportLogs],
  );

  return {
    actions,
    data: {
      entries,
      pendingEntries: stablePendingEntries,
    },
    filters: {
      categories,
      dateRange,
      level,
      search,
      stream,
    },
    status: {
      error: tail.error ? { message: tail.error.message } : null,
      exportPending: exportMutation.isPending,
      isFetching: tail.isFetching,
      isFilterSettling,
      isPlaceholderData: tail.isPlaceholderData,
      isPending: tail.isPending,
    },
  };
}
