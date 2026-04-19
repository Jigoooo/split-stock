import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export const LOG_LEVELS = ['', 'INFO', 'WARN', 'ERROR'] as const;
export const LOG_CATEGORIES = ['', 'AUTH', 'ORDER', 'FSM', 'WS', 'SYS'] as const;

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
  category: (typeof LOG_CATEGORIES)[number];
  setCategory: (category: (typeof LOG_CATEGORIES)[number]) => void;
  isPending: boolean;
  error: { message: string } | null;
  entries: LogEntry[];
}

export function useLogTail(): UseLogTailResult {
  const [level, setLevel] = useState<(typeof LOG_LEVELS)[number]>('');
  const [category, setCategory] = useState<(typeof LOG_CATEGORIES)[number]>('');
  const tail = trpc.logs.tail.useQuery(
    {
      limit: 200,
      ...(level ? { level } : {}),
      ...(category ? { category } : {}),
    },
    {
      refetchInterval: 2000,
    },
  );

  return {
    level,
    setLevel,
    category,
    setCategory,
    isPending: tail.isPending,
    error: tail.error ? { message: tail.error.message } : null,
    entries: tail.data?.entries ?? [],
  };
}
