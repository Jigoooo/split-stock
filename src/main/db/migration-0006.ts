import type { Db } from './client';

/**
 * Migration 0006: watch_orders 테이블에 metadata 컬럼 추가.
 *
 * booster-watcher에서 1차 매도 시점의 strategy snapshot을 저장하고,
 * 부스터 트리거 후 복원하기 위해 메타데이터 컬럼 추가.
 *
 * - metadata: TEXT(JSON), NULL 허용
 *   - source='BOOSTER'일 때 { strategySnapshot: StrategyProfile } 형태 저장
 *   - 다른 source는 NULL 또는 비워둠
 */
export function migrate_0006(db: Db): void {
  // SQLite ALTER TABLE은 제약이 많으므로, 임시 테이블 생성 → 데이터 마이그레이션 → 원본 삭제 → 이름 변경.
  // 또는 간단히 (만약 기존 데이터가 없으면) 컬럼 추가.
  //
  // 여기서는 간단 방식: 컬럼이 없으면 추가. 이미 있으면 pass.
  // SQLite는 'IF NOT EXISTS' 미지원하므로, try-catch로 처리.

  const checkSql = 'PRAGMA table_info(watch_orders)';
  const columns = db.all(checkSql) as Array<{ name: string }>;
  const hasMetadata = columns.some((c) => c.name === 'metadata');

  if (!hasMetadata) {
    db.run('ALTER TABLE watch_orders ADD COLUMN metadata TEXT');
  }
}
