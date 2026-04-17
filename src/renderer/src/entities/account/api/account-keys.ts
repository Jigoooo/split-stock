/**
 * Account entity의 쿼리 키는 trpc-react가 자동 생성하는 키를 그대로 사용한다.
 * (trpc.account.getBalance.useQuery()가 내부적으로 query key를 관리)
 *
 * 이 파일은 향후 커스텀 invalidation 헬퍼, query-key-factory 적용 시 확장 예정.
 * 현재는 플레이스홀더.
 */
export const ACCOUNT_ENTITY = 'account' as const;
