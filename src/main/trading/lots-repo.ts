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
 */
export class LotsRepo {
  constructor(
    private readonly db: Db,
    private readonly stockMasterRepo?: StockMasterRepo,
  ) {}

  snapshot(accountId: number, pdno: string): Result<PositionSnapshot, LotsRepoError> {
    return snapshot(this.db, accountId, pdno);
  }

  insertLot(input: InsertLotInput): Result<number, LotsRepoError> {
    return insertLot(this.db, input);
  }

  replan(accountId: number, plan: RespiitPlan): Result<{ insertedIds: number[] }, LotsRepoError> {
    return replan(this.db, accountId, plan);
  }

  snapshotByDate(
    accountId: number,
    snapshotDate: string,
    pdno?: string,
  ): Result<LotsSnapshot[], LotsRepoError> {
    return snapshotByDate(this.db, accountId, snapshotDate, pdno);
  }

  listOpenLots(accountId: number, pdno: string): Result<LotRow[], LotsRepoError> {
    return listOpenLots(this.db, accountId, pdno);
  }

  listSnapshotDates(accountId: number): Result<string[], LotsRepoError> {
    return listSnapshotDates(this.db, accountId);
  }

  saveSnapshot(input: SaveSnapshotInput): Result<void, LotsRepoError> {
    return saveSnapshot(this.db, input);
  }

  updateLotStatus(input: UpdateLotStatusInput): Result<void, LotsRepoError> {
    return updateLotStatus(this.db, input);
  }

  manualInsert(input: ManualInsertInput): Result<ManualEditResult, LotsRepoError> {
    return manualInsert(this.db, input);
  }

  manualUpdate(
    accountId: number,
    lotId: number,
    changes: ManualUpdateChanges,
  ): Result<ManualEditResult, LotsRepoError> {
    return manualUpdate(this.db, accountId, lotId, changes);
  }

  /** 차수 번호만 변경 — manualUpdate(nth) 의 명시적 별칭. */
  manualMove(
    accountId: number,
    lotId: number,
    newNth: number,
  ): Result<ManualEditResult, LotsRepoError> {
    return this.manualUpdate(accountId, lotId, { nth: newNth });
  }

  manualDelete(accountId: number, lotId: number): Result<ManualEditResult, LotsRepoError> {
    return manualDelete(this.db, accountId, lotId);
  }

  applyStockSplitRatio(
    accountId: number,
    pdno: string,
    ratioPct: number,
  ): Result<{ before: LotRow[]; after: LotRow[] }, LotsRepoError> {
    return applyStockSplitRatio(this.db, accountId, pdno, ratioPct);
  }

  restoreFromSnapshot(
    accountId: number,
    pdno: string,
    snapshot: LotRow[],
  ): Result<{ restored: number }, LotsRepoError> {
    return restoreFromSnapshot(this.db, accountId, pdno, snapshot);
  }

  cyclesByPdno(input: CyclesByPdnoInput): Result<TradeCycle[], LotsRepoError> {
    return cyclesByPdno(this.db, this.stockMasterRepo, input);
  }

  listTradeHistoryLots(input: TradeHistoryFilters): Result<TradeHistoryLot[], LotsRepoError> {
    return listTradeHistoryLots(this.db, this.stockMasterRepo, input);
  }

  /** lots 의 raw 행 조회 — manual 라우터가 평가/미리보기에 사용. */
  listRows(accountId: number, pdno?: string): Result<LotRow[], LotsRepoError> {
    return listRows(this.db, accountId, pdno);
  }
}
