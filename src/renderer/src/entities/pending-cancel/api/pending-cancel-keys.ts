/**
 * tRPC query key 상수 — invalidation에 사용.
 */
export const PENDING_CANCEL_ENTITY = {
  settings: ['pendingCancel', 'getSettings'] as const,
  listActive: ['pendingCancel', 'listActive'] as const,
} as const;
