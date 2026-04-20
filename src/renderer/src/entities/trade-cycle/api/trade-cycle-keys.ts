import type { CycleStatusFilter } from '../model/types';

/**
 * trade-cycle 쿼리 키 팩토리.
 * trpc-react 가 내부적으로 키를 관리하므로 invalidation 헬퍼용.
 */
export const tradeCycleKeys = {
  all: ['trade-cycle'] as const,
  lists: () => [...tradeCycleKeys.all, 'list'] as const,
  list: (params: { accountId: number; pdno?: string; status: CycleStatusFilter }) =>
    [...tradeCycleKeys.lists(), params] as const,
} as const;
