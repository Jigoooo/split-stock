/**
 * Watch order entity의 쿼리 키.
 * trpc-react가 자동 생성하는 query key를 그대로 사용한다.
 * (trpc.watch.list.useQuery()가 내부적으로 query key를 관리)
 *
 * 향후 커스텀 invalidation 헬퍼, query-key-factory 적용 시 확장 예정.
 */
export const WATCH_ORDER_ENTITY = 'watch-order' as const;
