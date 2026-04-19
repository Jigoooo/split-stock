import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export const LOG_LEVELS = ['', 'INFO', 'WARN', 'ERROR'] as const;
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

export interface LogEntry {
  id: number | string;
  ts: Date | number | string;
  level: string;
  category: string;
  message: string;
  payloadJson: string | null;
}

export interface UseLogTailResult {
  level: (typeof LOG_LEVELS)[number];
  setLevel: (level: (typeof LOG_LEVELS)[number]) => void;
  categories: Set<(typeof LOG_CATEGORIES)[number]>;
  setCategories: (categories: Set<(typeof LOG_CATEGORIES)[number]>) => void;
  search: string;
  setSearch: (search: string) => void;
  dateRange: 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' | '';
  setDateRange: (dateRange: 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' | '') => void;
  isPending: boolean;
  error: { message: string } | null;
  entries: LogEntry[];
}

export function useLogTail(): UseLogTailResult {
  const [level, setLevel] = useState<(typeof LOG_LEVELS)[number]>('');
  const [categories, setCategories] = useState<Set<(typeof LOG_CATEGORIES)[number]>>(new Set());
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<
    'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' | ''
  >('');

  const tail = trpc.logs.tail.useQuery(
    {
      limit: 200,
      ...(level ? { level: level as 'INFO' | 'WARN' | 'ERROR' } : {}),
      ...(categories.size > 0 ? { categories: Array.from(categories) as string[] } : {}),
      ...(search ? { search } : {}),
      ...(dateRange
        ? { dateRange: dateRange as 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' | '' }
        : {}),
    },
    {
      refetchInterval: 2000,
    },
  );

  return {
    level,
    setLevel,
    categories,
    setCategories,
    search,
    setSearch,
    dateRange,
    setDateRange,
    isPending: tail.isPending,
    error: tail.error ? { message: tail.error.message } : null,
    entries: tail.data?.entries ?? [],
  };
}
