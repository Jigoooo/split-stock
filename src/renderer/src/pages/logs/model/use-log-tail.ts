import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export const LOG_LEVELS = ['', 'INFO', 'WARN', 'ERROR'] as const;
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
export type LogCategory = (typeof LOG_CATEGORIES)[number];
export type LogDateRange = 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' | '';
export type LogExportFormat = (typeof LOG_EXPORT_FORMATS)[number];
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
  };
  data: {
    entries: LogEntry[];
  };
  filters: {
    categories: Set<LogCategory>;
    dateRange: LogDateRange;
    level: LogLevel;
    search: string;
  };
  status: {
    error: { message: string } | null;
    exportPending: boolean;
    isPending: boolean;
  };
}

export function useLogTail(): UseLogTailResult {
  const [level, setLevel] = useState<LogLevel>('');
  const [categories, setCategories] = useState<Set<LogCategory>>(new Set());
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<LogDateRange>('');
  const exportMutation = trpc.logs.export.useMutation();

  const selectedCategories =
    categories.size > 0
      ? (Array.from(categories).filter((c) => c !== '') as (
          | 'AUTH'
          | 'ORDER'
          | 'FSM'
          | 'WS'
          | 'SYS'
          | 'BALANCE'
          | 'CANCEL'
        )[])
      : undefined;

  const tail = trpc.logs.tail.useQuery(
    {
      limit: LOG_TAIL_LIMIT,
      ...(level ? { level: level as 'INFO' | 'WARN' | 'ERROR' } : {}),
      ...(selectedCategories ? { categories: selectedCategories } : {}),
      ...(search ? { search } : {}),
      ...(dateRange
        ? { dateRange: dateRange as 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' }
        : {}),
    },
    {
      refetchInterval: 2000,
    },
  );

  const exportLogs = async (format: LogExportFormat): Promise<LogExportResult> =>
    exportMutation.mutateAsync({
      format,
      ...(level ? { level: level as 'INFO' | 'WARN' | 'ERROR' } : {}),
      ...(selectedCategories ? { categories: selectedCategories } : {}),
      ...(search ? { search } : {}),
      ...(dateRange
        ? { dateRange: dateRange as 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' }
        : {}),
    });

  return {
    actions: {
      exportLogs,
      setCategories,
      setDateRange,
      setLevel,
      setSearch,
    },
    data: {
      entries: tail.data?.entries ?? [],
    },
    filters: {
      categories,
      dateRange,
      level,
      search,
    },
    status: {
      error: tail.error ? { message: tail.error.message } : null,
      exportPending: exportMutation.isPending,
      isPending: tail.isPending,
    },
  };
}
