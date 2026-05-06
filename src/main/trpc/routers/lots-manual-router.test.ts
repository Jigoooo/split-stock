import type { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb, type Db } from '../../db/client';
import type { EventLogEntry, EventLogger } from '../../logging/event-logger';
import { SafetyStateRegistry } from '../../safety/safety-state';
import { seedDomesticAccounts } from '../../testing/seed-accounts';
import { LotsRepo } from '../../trading/lots-repo';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { clearManualUndoStore, lotsManualRouter } from './lots-manual-router';

const createCaller = t.createCallerFactory(lotsManualRouter);

interface SetupResult {
  db: Db;
  lotsRepo: LotsRepo;
  safetyRegistry: SafetyStateRegistry;
  logged: EventLogEntry[];
  backupTriggers: string[];
  baseCtx: Omit<Context, 'currentEnv' | 'activeAccountId' | 'safety'>;
}

function setup(): SetupResult {
  const db = createTestDb();
  bootstrapSchema(db);
  seedDomesticAccounts(db);
  const lotsRepo = new LotsRepo(db);
  const logged: EventLogEntry[] = [];
  const logger: EventLogger = { log: (e) => logged.push(e) };
  const safetyRegistry = new SafetyStateRegistry({ logger });
  const backupTriggers: string[] = [];
  const backupScheduler = {
    triggerNow: (reason: string) => backupTriggers.push(reason),
  };
  const baseCtx = {
    db,
    lotsRepo,
    safetyRegistry,
    logger,
    backupScheduler,
  } as unknown as Omit<Context, 'currentEnv' | 'activeAccountId' | 'safety'>;
  return { db, lotsRepo, safetyRegistry, logged, backupTriggers, baseCtx };
}

function ctxFor(s: SetupResult, accountId: number | null): Context {
  return {
    ...s.baseCtx,
    currentEnv: 'MOCK',
    activeAccountId: accountId,
    safety: s.safetyRegistry.get(accountId ?? 0),
    setCurrentEnv: () => {},
    setActiveAccountId: () => {},
  } as unknown as Context;
}

function seedLots(s: SetupResult, accountId: number): void {
  const r1 = s.lotsRepo.insertLot({
    accountId,
    pdno: '005930',
    nth: 1,
    buyPrice: 70000,
    qty: 10,
    amountKrw: 700_000,
    status: 'OPEN',
    boughtAt: new Date('2026-04-01T00:00:00Z'),
  });
  const r2 = s.lotsRepo.insertLot({
    accountId,
    pdno: '005930',
    nth: 2,
    buyPrice: 65000,
    qty: 12,
    amountKrw: 780_000,
    status: 'OPEN',
    boughtAt: new Date('2026-04-02T00:00:00Z'),
  });
  if (r1.isErr() || r2.isErr()) throw new Error('seed failed');
}

describe('lots-manual-router 안전장치/권한 검증', () => {
  let s: SetupResult;
  beforeEach(() => {
    s = setup();
    clearManualUndoStore();
  });

  describe('enterMode', () => {
    it('자동매매 OFF + confirm=EDIT → ok', async () => {
      const caller = createCaller(ctxFor(s, 1));
      // master 는 default false
      const res = await caller.enterMode({ accountId: 1, confirm: 'EDIT' });
      expect(res.ok).toBe(true);
      expect(s.logged.some((e) => e.message === 'lots.manual.mode.enter')).toBe(true);
    });

    it('자동매매 ON 상태 → PRECONDITION_FAILED (AUTO_TRADING_MUST_BE_OFF)', async () => {
      s.safetyRegistry.get(1).setMaster(true);
      const caller = createCaller(ctxFor(s, 1));
      try {
        await caller.enterMode({ accountId: 1, confirm: 'EDIT' });
        throw new Error('should throw');
      } catch (e) {
        const err = e as TRPCError;
        expect(err.code).toBe('PRECONDITION_FAILED');
        expect(err.message).toContain('AUTO_TRADING_MUST_BE_OFF');
      }
    });

    it('confirm 미입력 → BAD_REQUEST (zod validation)', async () => {
      const caller = createCaller(ctxFor(s, 1));
      try {
        // @ts-expect-error — confirm 누락
        await caller.enterMode({ accountId: 1 });
        throw new Error('should throw');
      } catch (e) {
        const err = e as TRPCError;
        expect(err.code).toBe('BAD_REQUEST');
      }
    });
  });

  describe('insert/update/delete (mutation 안전장치)', () => {
    it('insert: 자동매매 ON 차단', async () => {
      s.safetyRegistry.get(1).setMaster(true);
      const caller = createCaller(ctxFor(s, 1));
      try {
        await caller.insert({
          accountId: 1,
          pdno: '005930',
          nth: 1,
          buyPrice: 70000,
          qty: 10,
          boughtAtMs: Date.now(),
        });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('PRECONDITION_FAILED');
      }
    });

    it('insert: OFF 시 audit + backup 트리거 + undo 가능', async () => {
      const caller = createCaller(ctxFor(s, 1));
      const res = await caller.insert({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        boughtAtMs: Date.parse('2026-04-01T00:00:00Z'),
      });
      expect(res.ok).toBe(true);
      const auditEntry = s.logged.find((l) => l.message === 'lots.manual.insert');
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.audit).toBeDefined();
      expect(s.backupTriggers).toContain('lots.manual.insert');
      // undo 가능
      const canUndo = await caller.canUndo({ accountId: 1, pdno: '005930' });
      expect(canUndo.available).toBe(true);
    });

    it('update: 다른 계좌의 lot 편집 차단 (per-account 격리)', async () => {
      seedLots(s, 1);
      const lots1 = s.lotsRepo.listRows(1, '005930');
      if (lots1.isErr()) throw new Error('listRows');
      const lotId1 = lots1.value[0]?.id;
      if (!lotId1) throw new Error('no lot');
      // accountId=2 컨텍스트에서 1 의 lot 수정 시도
      const caller = createCaller(ctxFor(s, 2));
      try {
        await caller.update({
          accountId: 2,
          pdno: '005930',
          lotId: lotId1,
          changes: { buyPrice: 1 },
        });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('applyStockSplitRatio', () => {
    it('OFF 상태에서 모든 차수 단가 변경 + audit', async () => {
      seedLots(s, 1);
      const caller = createCaller(ctxFor(s, 1));
      const res = await caller.applyStockSplitRatio({
        accountId: 1,
        pdno: '005930',
        ratioPct: -50,
      });
      expect(res.ok).toBe(true);
      expect(res.after[0]?.buyPrice).toBe(35000);
      const audit = s.logged.find((l) => l.message === 'lots.manual.applyStockSplitRatio');
      expect(audit?.audit?.ratioPct).toBe(-50);
    });

    it('자동매매 ON 시 차단', async () => {
      seedLots(s, 1);
      s.safetyRegistry.get(1).setMaster(true);
      const caller = createCaller(ctxFor(s, 1));
      try {
        await caller.applyStockSplitRatio({ accountId: 1, pdno: '005930', ratioPct: 50 });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('PRECONDITION_FAILED');
      }
    });
  });

  describe('undo', () => {
    it('변경 → undo → 원복', async () => {
      seedLots(s, 1);
      const caller = createCaller(ctxFor(s, 1));
      const lots = s.lotsRepo.listRows(1, '005930');
      if (lots.isErr()) throw new Error('listRows');
      const lotId = lots.value[0]?.id;
      if (!lotId) throw new Error('no lot');
      await caller.update({
        accountId: 1,
        pdno: '005930',
        lotId,
        changes: { buyPrice: 99999 },
      });
      const after = s.lotsRepo.listRows(1, '005930');
      if (after.isOk()) {
        expect(after.value[0]?.buyPrice).toBe(99999);
      }
      // Undo
      const undo = await caller.undo({ accountId: 1, pdno: '005930' });
      expect(undo.ok).toBe(true);
      const restored = s.lotsRepo.listRows(1, '005930');
      if (restored.isOk()) {
        expect(restored.value[0]?.buyPrice).toBe(70000);
      }
      // 두 번째 undo 시도 → NO_HISTORY
      try {
        await caller.undo({ accountId: 1, pdno: '005930' });
        throw new Error('should throw');
      } catch (e) {
        expect((e as TRPCError).code).toBe('PRECONDITION_FAILED');
      }
    });
  });

  describe('CSV', () => {
    it('importCsvPreview → validCount 보고', async () => {
      const caller = createCaller(ctxFor(s, 1));
      const csv = `nth,buyPrice,qty,amountKrw,status,boughtAt,soldAt,sellPrice
1,70000,10,,OPEN,2026-04-01,,
2,65000,12,,OPEN,2026-04-02,,
`;
      const res = await caller.importCsvPreview({ accountId: 1, pdno: '005930', csvText: csv });
      expect(res.validCount).toBe(2);
      expect(res.errorCount).toBe(0);
    });

    it('importCsvApply → 일괄 insert + 자동매매 OFF 강제', async () => {
      const caller = createCaller(ctxFor(s, 1));
      const csv = `nth,buyPrice,qty,amountKrw,status,boughtAt,soldAt,sellPrice
1,70000,10,,OPEN,2026-04-01,,
`;
      const res = await caller.importCsvApply({ accountId: 1, pdno: '005930', csvText: csv });
      expect(res.insertedCount).toBe(1);
    });

    it('exportCsv → 헤더 포함 텍스트', async () => {
      seedLots(s, 1);
      const caller = createCaller(ctxFor(s, 1));
      const res = await caller.exportCsv({ accountId: 1, pdno: '005930' });
      expect(res.csv).toContain('nth,buyPrice');
      expect(res.rowCount).toBe(2);
    });
  });
});
