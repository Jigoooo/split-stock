/**
 * symbol-memo 쿼리 키 팩토리.
 * trpc-react 가 내부적으로 키를 관리하므로 invalidation 헬퍼용.
 */
export const symbolMemoKeys = {
  all: ['symbol-memo'] as const,
  detail: (pdno: string) => [...symbolMemoKeys.all, 'detail', pdno] as const,
} as const;
