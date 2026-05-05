import type { Result } from 'neverthrow';
import type { Db } from '../db/client';
import type { PositionSnapshot } from './fsm';
import { insertLot, replan, snapshot, updateLotStatus } from './lots-repo-core';
import type { LotsRepoError } from './lots-repo-errors';
import {
  applyStockSplitRatio,
  manualDelete,
  manualInsert,
  manualUpdate,
  restoreFromSnapshot,
} from './lots-repo-manual';
import {
  cyclesByPdno,
  listOpenLots,
  listRows,
  listTradeHistoryLots,
} from './lots-repo-read-models';
import { listSnapshotDates, saveSnapshot, snapshotByDate } from './lots-repo-snapshots';
import type {
  CyclesByPdnoInput,
  InsertLotInput,
  LotRow,
  LotsSnapshot,
  ManualEditResult,
  ManualInsertInput,
  ManualUpdateChanges,
  SaveSnapshotInput,
  TradeCycle,
  TradeHistoryFilters,
  TradeHistoryLot,
  UpdateLotStatusInput,
} from './lots-repo-types';
import type { RespiitPlan } from './respiit-planner';
import type { StockMasterRepo } from './stock-master-repo';

export { type LotsRepoError, lotsRepoErrorMessage } from './lots-repo-errors';
export type {
  CycleStatusFilter,
  CyclesByPdnoInput,
  InsertLotInput,
  LotRow,
  LotSnapshotEntry,
  LotsSnapshot,
  ManualEditResult,
  ManualInsertInput,
  ManualUpdateChanges,
  SaveSnapshotInput,
  TradeCycle,
  TradeHistoryFilters,
  TradeHistoryLot,
  UpdateLotStatusInput,
} from './lots-repo-types';

/**
 * 차수 장부 레포지토리.
 * 중요: better-sqlite3 transaction으로 insert/update가 원자적으로 실행됨.
 * 콜백이 throw하면 자동 rollback.
 *
 * Phase R0: broker-agnostic — 모든 메서드가 `broker?: string` 인자를 받으며 default 'KIS'.
 * 기존 호출처는 broker 인자 미전달 → 'KIS' 자동 적용 (BC 보장).
 */
export class LotsRepo {
  constructor(
    private readonly db: Db,
    private readonly stockMasterRepo?: StockMasterRepo,
  ) {}

  snapshot(
    accountId: number,
    pdno: string,
    broker: string = 'KIS',
  ): Result<PositionSnapshot, LotsRepoError> {
    return snapshot(this.db, accountId, pdno, broker);
  }

  insertLot(input: InsertLotInput, broker: string = 'KIS'): Result<number, LotsRepoError> {
    return insertLot(this.db, input, broker);
  }

  replan(
    accountId: number,
    plan: RespiitPlan,
    broker: string = 'KIS',
  ): Result<{ insertedIds: number[] }, LotsRepoError> {
    return replan(this.db, accountId, plan, broker);
  }

  snapshotByDate(
    accountId: number,
    snapshotDate: string,
    pdno?: string,
    broker: string = 'KIS',
  ): Result<LotsSnapshot[], LotsRepoError> {
    return snapshotByDate(this.db, accountId, snapshotDate, pdno, broker);
  }

  listOpenLots(
    accountId: number,
    pdno: string,
    broker: string = 'KIS',
  ): Result<LotRow[], LotsRepoError> {
    return listOpenLots(this.db, accountId, pdno, broker);
  }

  listSnapshotDates(accountId: number, broker: string = 'KIS'): Result<string[], LotsRepoError> {
    return listSnapshotDates(this.db, accountId, broker);
  }

  saveSnapshot(input: SaveSnapshotInput, broker: string = 'KIS'): Result<void, LotsRepoError> {
    return saveSnapshot(this.db, input, broker);
  }

  updateLotStatus(input: UpdateLotStatusInput): Result<void, LotsRepoError> {
    return updateLotStatus(this.db, input);
  }

  manualInsert(
    input: ManualInsertInput,
    broker: string = 'KIS',
  ): Result<ManualEditResult, LotsRepoError> {
    return manualInsert(this.db, input, broker);
  }

  manualUpdate(
    accountId: number,
    lotId: number,
    changes: ManualUpdateChanges,
    broker: string = 'KIS',
  ): Result<ManualEditResult, LotsRepoError> {
    return manualUpdate(this.db, accountId, lotId, changes, broker);
  }

  /** 차수 번호만 변경 — manualUpdate(nth) 의 명시적 별칭. */
  manualMove(
    accountId: number,
    lotId: number,
    newNth: number,
    broker: string = 'KIS',
  ): Result<ManualEditResult, LotsRepoError> {
    return this.manualUpdate(accountId, lotId, { nth: newNth }, broker);
  }

  manualDelete(
    accountId: number,
    lotId: number,
    broker: string = 'KIS',
  ): Result<ManualEditResult, LotsRepoError> {
    return manualDelete(this.db, accountId, lotId, broker);
  }

  applyStockSplitRatio(
    accountId: number,
    pdno: string,
    ratioPct: number,
    broker: string = 'KIS',
  ): Result<{ before: LotRow[]; after: LotRow[] }, LotsRepoError> {
    return applyStockSplitRatio(this.db, accountId, pdno, ratioPct, broker);
  }

  restoreFromSnapshot(
    accountId: number,
    pdno: string,
    snapshot: LotRow[],
    broker: string = 'KIS',
  ): Result<{ restored: number }, LotsRepoError> {
    return restoreFromSnapshot(this.db, accountId, pdno, snapshot, broker);
  }

  cyclesByPdno(
    input: CyclesByPdnoInput,
    broker: string = 'KIS',
  ): Result<TradeCycle[], LotsRepoError> {
    return cyclesByPdno(this.db, this.stockMasterRepo, input, broker);
  }

  listTradeHistoryLots(
    input: TradeHistoryFilters,
    broker: string = 'KIS',
  ): Result<TradeHistoryLot[], LotsRepoError> {
    return listTradeHistoryLots(this.db, this.stockMasterRepo, input, broker);
  }

  /** lots 의 raw 행 조회 — manual 라우터가 평가/미리보기에 사용. */
  listRows(
    accountId: number,
    pdno?: string,
    broker: string = 'KIS',
  ): Result<LotRow[], LotsRepoError> {
    return listRows(this.db, accountId, pdno, broker);
  }
}
