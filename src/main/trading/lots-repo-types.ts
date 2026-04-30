import type { LotStatus } from './fsm';

/** lots_snapshots 테이블에 저장되는 차수 항목 */
export interface LotSnapshotEntry {
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: number; // ms timestamp
  soldAt?: number;
  sellPrice?: number;
}

/** snapshotByDate() 반환 타입 */
export interface LotsSnapshot {
  pdno: string;
  name: string;
  currentPrice: number;
  snapshotDate: string;
  lots: LotSnapshotEntry[];
}

/** saveSnapshot() 입력 */
export interface SaveSnapshotInput {
  accountId: number;
  snapshotDate: string; // YYYY-MM-DD
  pdno: string;
  name: string;
  currentPrice: number;
  lots: LotSnapshotEntry[];
}

/** 수동편집 트랜잭션의 before/after 스냅샷 — undo 및 audit 용. */
export interface LotRow {
  id: number;
  accountId: number;
  pdno: string;
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: number; // ms timestamp
  soldAt: number | null;
  sellPrice: number | null;
}

/** manual* 메서드 결과 — audit_payload 에 기록할 before/after diff */
export interface ManualEditResult {
  before: LotRow | null;
  after: LotRow | null;
  /** 적용 이전 (계좌, 종목)의 모든 OPEN 차수 — undo 시 복원 기준 스냅샷 */
  fullSnapshot: LotRow[];
}

export interface ManualInsertInput {
  accountId: number;
  pdno: string;
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: Date;
}

export interface ManualUpdateChanges {
  buyPrice?: number;
  qty?: number;
  amountKrw?: number;
  status?: LotStatus;
  boughtAt?: Date;
  soldAt?: Date | null;
  sellPrice?: number | null;
  nth?: number;
}

export interface InsertLotInput {
  accountId: number;
  pdno: string;
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: Date;
}

export interface UpdateLotStatusInput {
  lotId: number;
  status: LotStatus;
  sellPrice?: number;
  soldAt?: Date;
}

/**
 * cyclesByPdno() 반환 항목 — 한 차수의 매매 사이클(매수→매도) 요약.
 *
 * status 매핑:
 *   - 'all'    : 모든 lots (OPEN/BUYING/SELLING/SOLD)
 *   - 'open'   : OPEN | BUYING (보유 중 — 미매도)
 *   - 'closed' : SOLD (매도 완료)
 *   주의: SELLING(매도 진행 중)은 'open'/'closed' 어디에도 안 들어간다 — 'all'로만 노출.
 *
 * 단위:
 *   - pnl: 원(KRW)
 *   - pnlRate: 백분율 표현 (예: 5.25 == 5.25%) — KIS Position.pnlRate 관례와 일치.
 */
export interface TradeCycle {
  id: number;
  nth: number;
  pdno: string;
  name: string;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: number; // ms epoch
  soldAt?: number;
  sellPrice?: number;
  pnl?: number; // 원 (sellPrice * qty - amountKrw)
  pnlRate?: number; // 백분율 — (pnl / amountKrw) * 100
}

export type CycleStatusFilter = 'all' | 'open' | 'closed';

export interface CyclesByPdnoInput {
  accountId: number;
  pdno?: string;
  status: CycleStatusFilter;
}

export interface TradeHistoryFilters {
  accountId: number;
  year: number;
  month: number;
  day?: number;
  search?: string;
}

/**
 * 모든 매매 내역 전용 lot 조회 항목.
 *
 * 정렬/필터 기준:
 * - relevantAt = soldAt ?? boughtAt
 * - month/day/search 는 relevantAt 및 종목명/코드 기준으로 필터링
 * - 반환 순서는 relevantAt 내림차순, 같은 시각이면 pdno 오름차순, nth 오름차순
 */
export interface TradeHistoryLot {
  id: number;
  pdno: string;
  name: string;
  nth: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  buyPrice: number;
  boughtAt: number;
  soldAt?: number;
  sellPrice?: number;
}
