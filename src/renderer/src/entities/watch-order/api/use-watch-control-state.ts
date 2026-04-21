import { trpc } from '@renderer/shared/api/trpc';
import type { WatchControlState } from '../model/types';

export interface UseWatchControlStateResult {
  isPending: boolean;
  error: { message: string } | null;
  state: WatchControlState | null;
}

export function useWatchControlState(): UseWatchControlStateResult {
  const query = trpc.watch.getControlState.useQuery();
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    state: (query.data ?? null) as WatchControlState | null,
  };
}
