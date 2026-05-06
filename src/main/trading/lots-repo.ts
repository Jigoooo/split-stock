import { err, type Result } from 'neverthrow';
import { getDomesticBrokerForAccount } from '../db/account-broker';
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
 * Phase 7: broker default 'KIS' 제거. 각 메서드는 accountId 로부터 accounts.broker 를
 * 자동 resolve (`getDomesticBrokerForAccount`) — caller 가 broker 인자 명시할 필요 없음.
 * caller 가 explicit override 가 필요하면 broker 인자 전달 가능 (lots-router 등).
 * account 미존재 / non-domestic broker 면 INVALID_ACCOUNT 에러 (silent KIS fallback 금지).
 */
export class LotsRepo {
  constructor(
    private readonly db: Db,
    private readonly stockMasterRepo?: StockMasterRepo,
  ) {}

  /** broker 가 명시되지 않으면 accountId 로부터 자동 resolve. account 미존재 시 null. */
  private resolveBroker(accountId: number, broker?: string): string | null {
    if (broker !== undefined) return broker;
    return getDomesticBrokerForAccount(this.db, accountId);
  }

  snapshot(
    accountId: number,
    pdno: string,
    broker?: string,
  ): Result<PositionSnapshot, LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return snapshot(this.db, accountId, pdno, resolved);
  }

  insertLot(input: InsertLotInput, broker?: string): Result<number, LotsRepoError> {
    const resolved = this.resolveBroker(input.accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId: input.accountId });
    return insertLot(this.db, input, resolved);
  }

  replan(
    accountId: number,
    plan: RespiitPlan,
    broker?: string,
  ): Result<{ insertedIds: number[] }, LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return replan(this.db, accountId, plan, resolved);
  }

  snapshotByDate(
    accountId: number,
    snapshotDate: string,
    pdno?: string,
    broker?: string,
  ): Result<LotsSnapshot[], LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return snapshotByDate(this.db, accountId, snapshotDate, pdno, resolved);
  }

  listOpenLots(accountId: number, pdno: string, broker?: string): Result<LotRow[], LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return listOpenLots(this.db, accountId, pdno, resolved);
  }

  listSnapshotDates(accountId: number, broker?: string): Result<string[], LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return listSnapshotDates(this.db, accountId, resolved);
  }

  saveSnapshot(input: SaveSnapshotInput, broker?: string): Result<void, LotsRepoError> {
    const resolved = this.resolveBroker(input.accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId: input.accountId });
    return saveSnapshot(this.db, input, resolved);
  }

  updateLotStatus(input: UpdateLotStatusInput): Result<void, LotsRepoError> {
    return updateLotStatus(this.db, input);
  }

  manualInsert(input: ManualInsertInput, broker?: string): Result<ManualEditResult, LotsRepoError> {
    const resolved = this.resolveBroker(input.accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId: input.accountId });
    return manualInsert(this.db, input, resolved);
  }

  manualUpdate(
    accountId: number,
    lotId: number,
    changes: ManualUpdateChanges,
    broker?: string,
  ): Result<ManualEditResult, LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return manualUpdate(this.db, accountId, lotId, changes, resolved);
  }

  /** 차수 번호만 변경 — manualUpdate(nth) 의 명시적 별칭. */
  manualMove(
    accountId: number,
    lotId: number,
    newNth: number,
    broker?: string,
  ): Result<ManualEditResult, LotsRepoError> {
    return this.manualUpdate(accountId, lotId, { nth: newNth }, broker);
  }

  manualDelete(
    accountId: number,
    lotId: number,
    broker?: string,
  ): Result<ManualEditResult, LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return manualDelete(this.db, accountId, lotId, resolved);
  }

  applyStockSplitRatio(
    accountId: number,
    pdno: string,
    ratioPct: number,
    broker?: string,
  ): Result<{ before: LotRow[]; after: LotRow[] }, LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return applyStockSplitRatio(this.db, accountId, pdno, ratioPct, resolved);
  }

  restoreFromSnapshot(
    accountId: number,
    pdno: string,
    snapshot: LotRow[],
    broker?: string,
  ): Result<{ restored: number }, LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return restoreFromSnapshot(this.db, accountId, pdno, snapshot, resolved);
  }

  cyclesByPdno(input: CyclesByPdnoInput, broker?: string): Result<TradeCycle[], LotsRepoError> {
    const resolved = this.resolveBroker(input.accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId: input.accountId });
    return cyclesByPdno(this.db, this.stockMasterRepo, input, resolved);
  }

  listTradeHistoryLots(
    input: TradeHistoryFilters,
    broker?: string,
  ): Result<TradeHistoryLot[], LotsRepoError> {
    const resolved = this.resolveBroker(input.accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId: input.accountId });
    return listTradeHistoryLots(this.db, this.stockMasterRepo, input, resolved);
  }

  /** lots 의 raw 행 조회 — manual 라우터가 평가/미리보기에 사용. */
  listRows(accountId: number, pdno?: string, broker?: string): Result<LotRow[], LotsRepoError> {
    const resolved = this.resolveBroker(accountId, broker);
    if (!resolved) return err({ kind: 'INVALID_ACCOUNT', accountId });
    return listRows(this.db, accountId, pdno, resolved);
  }
}
