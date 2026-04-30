import { trpc } from '@renderer/shared/api/trpc';
import { useDeferredValue, useMemo, useState } from 'react';

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
] as const;
export const LOG_EXPORT_FORMATS = ['csv', 'json'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogStream = (typeof LOG_STREAMS)[number];
export type LogCategory = (typeof LOG_CATEGORIES)[number];
export type LogDateRange = 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' | '';
export type LogExportFormat = (typeof LOG_EXPORT_FORMATS)[number];
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

export interface UseLogTailResult {
  actions: {
    exportLogs: (format: LogExportFormat) => Promise<LogExportResult>;
    setCategories: (categories: Set<LogCategory>) => void;
    setDateRange: (dateRange: LogDateRange) => void;
    setLevel: (level: LogLevel) => void;
    setSearch: (search: string) => void;
    setStream: (stream: LogStream) => void;
  };
  data: {
    entries: LogEntry[];
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

export function useLogTail(): UseLogTailResult {
  const [level, setLevel] = useState<LogLevel>('');
  const [stream, setStream] = useState<LogStream>('');
  const [categories, setCategories] = useState<Set<LogCategory>>(new Set());
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<LogDateRange>('');
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

  const tail = trpc.logs.tail.useQuery(tailInput, {
    placeholderData: (previousData) => previousData,
    refetchInterval: 2000,
  });

  const exportLogs = async (format: LogExportFormat): Promise<LogExportResult> =>
    exportMutation.mutateAsync({
      format,
      ...exportInput,
    });

  return {
    actions: {
      exportLogs,
      setCategories,
      setDateRange,
      setLevel,
      setSearch,
      setStream,
    },
    data: {
      entries: tail.data?.entries ?? [],
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
