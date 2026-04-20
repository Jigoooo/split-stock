import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import type { LotSnapshotEntry } from './lots-repo';
import { LotsRepo } from './lots-repo';
import { StockMasterRepo } from './stock-master-repo';

function setupRepo() {
  const db = createTestDb();
  bootstrapSchema(db);
  return new LotsRepo(db);
}

function setupRepoWithMaster() {
  const db = createTestDb();
  bootstrapSchema(db);
  const master = new StockMasterRepo(db);
  master.upsertMany([
    { pdno: '005930', name: '삼성전자' },
    { pdno: '000660', name: 'SK하이닉스' },
  ]);
  return { repo: new LotsRepo(db, master), master };
}

describe('LotsRepo', () => {
  it('insertLot → snapshot 라운드트립', () => {
    const repo = setupRepo();
    const id = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    expect(id.isOk()).toBe(true);

    const snap = repo.snapshot(1, '005930');
    expect(snap.isOk()).toBe(true);
    if (snap.isOk()) {
      expect(snap.value.lots).toHaveLength(1);
      expect(snap.value.lots[0]).toMatchObject({
        nth: 1,
        buyPrice: 70000,
        qty: 14,
        status: 'OPEN',
      });
    }
  });

  it('중복 (account, pdno, nth) 차수는 rollback — 두 번째 insert 실패', () => {
    const repo = setupRepo();
    const now = new Date();
    const first = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: now,
    });
    expect(first.isOk()).toBe(true);

    const dup = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 67800,
      qty: 14,
      amountKrw: 949_200,
      status: 'OPEN',
      boughtAt: now,
    });
    expect(dup.isErr()).toBe(true);
    if (dup.isErr()) expect(dup.error.kind).toBe('DB_ERROR');

    // rollback 확인: 여전히 1행만 존재 + buyPrice=70000
    const snap = repo.snapshot(1, '005930');
    expect(snap.isOk()).toBe(true);
    if (snap.isOk()) {
      expect(snap.value.lots).toHaveLength(1);
      expect(snap.value.lots[0]?.buyPrice).toBe(70000);
    }
  });

  it('updateLotStatus: OPEN → SELLING → SOLD 전이', () => {
    const repo = setupRepo();
    const inserted = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    if (inserted.isErr()) throw new Error('seed failed');
    const lotId = inserted.value;

    const step1 = repo.updateLotStatus({ lotId, status: 'SELLING' });
    expect(step1.isOk()).toBe(true);

    const step2 = repo.updateLotStatus({
      lotId,
      status: 'SOLD',
      sellPrice: 73500,
      soldAt: new Date(),
    });
    expect(step2.isOk()).toBe(true);

    const snap = repo.snapshot(1, '005930');
    if (snap.isErr()) throw new Error('snap failed');
    expect(snap.value.lots[0]?.status).toBe('SOLD');
  });

  it('updateLotStatus 실패 (없는 lotId) → DB_ERROR, 기존 레코드 변경 없음', () => {
    const repo = setupRepo();
    const inserted = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    if (inserted.isErr()) throw new Error('seed failed');

    const missing = repo.updateLotStatus({ lotId: 9999, status: 'SOLD' });
    expect(missing.isErr()).toBe(true);

    const snap = repo.snapshot(1, '005930');
    if (snap.isErr()) throw new Error('snap');
    expect(snap.value.lots[0]?.status).toBe('OPEN');
  });

  describe('saveSnapshot / snapshotByDate / listSnapshotDates', () => {
    const makeLots = (): LotSnapshotEntry[] => [
      {
        nth: 1,
        buyPrice: 70000,
        qty: 14,
        amountKrw: 980_000,
        status: 'OPEN',
        boughtAt: Date.now(),
      },
      {
        nth: 2,
        buyPrice: 67000,
        qty: 15,
        amountKrw: 1_005_000,
        status: 'OPEN',
        boughtAt: Date.now(),
      },
    ];

    it('saveSnapshot → snapshotByDate 라운드트립', () => {
      const repo = setupRepo();
      const lots = makeLots();
      const r = repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-01',
        pdno: '005930',
        name: '삼성전자',
        currentPrice: 72000,
        lots,
      });
      expect(r.isOk()).toBe(true);

      const snap = repo.snapshotByDate(1, '2025-04-01');
      expect(snap.isOk()).toBe(true);
      if (snap.isOk()) {
        expect(snap.value).toHaveLength(1);
        expect(snap.value[0]?.pdno).toBe('005930');
        expect(snap.value[0]?.name).toBe('삼성전자');
        expect(snap.value[0]?.currentPrice).toBe(72000);
        expect(snap.value[0]?.lots).toHaveLength(2);
        expect(snap.value[0]?.lots[0]?.nth).toBe(1);
      }
    });

    it('pdno 필터 동작', () => {
      const repo = setupRepo();
      const lots = makeLots();
      repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-01',
        pdno: '005930',
        name: '삼성전자',
        currentPrice: 72000,
        lots,
      });
      repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-01',
        pdno: '000660',
        name: 'SK하이닉스',
        currentPrice: 185000,
        lots,
      });

      const snap = repo.snapshotByDate(1, '2025-04-01', '000660');
      expect(snap.isOk()).toBe(true);
      if (snap.isOk()) {
        expect(snap.value).toHaveLength(1);
        expect(snap.value[0]?.pdno).toBe('000660');
      }
    });

    it('upsert — 같은 날짜/종목 재저장하면 덮어씀', () => {
      const repo = setupRepo();
      const lots = makeLots();
      repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-01',
        pdno: '005930',
        name: '삼성전자',
        currentPrice: 72000,
        lots,
      });
      repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-01',
        pdno: '005930',
        name: '삼성전자',
        currentPrice: 75000,
        lots: lots.slice(0, 1),
      });

      const snap = repo.snapshotByDate(1, '2025-04-01');
      expect(snap.isOk()).toBe(true);
      if (snap.isOk()) {
        expect(snap.value).toHaveLength(1);
        expect(snap.value[0]?.currentPrice).toBe(75000);
        expect(snap.value[0]?.lots).toHaveLength(1);
      }
    });

    it('listSnapshotDates — 최신순 반환', () => {
      const repo = setupRepo();
      const lots = makeLots();
      repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-01',
        pdno: '005930',
        name: '삼성전자',
        currentPrice: 72000,
        lots,
      });
      repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-03',
        pdno: '005930',
        name: '삼성전자',
        currentPrice: 73000,
        lots,
      });
      repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-02',
        pdno: '000660',
        name: 'SK하이닉스',
        currentPrice: 185000,
        lots,
      });

      const dates = repo.listSnapshotDates(1);
      expect(dates.isOk()).toBe(true);
      if (dates.isOk()) {
        expect(dates.value).toEqual(['2025-04-03', '2025-04-02', '2025-04-01']);
      }
    });

    it('per-account 격리 — 계좌 A 스냅샷이 계좌 B에 안 나옴', () => {
      const repo = setupRepo();
      const lots = makeLots();
      repo.saveSnapshot({
        accountId: 1,
        snapshotDate: '2025-04-01',
        pdno: '005930',
        name: '삼성전자',
        currentPrice: 72000,
        lots,
      });
      repo.saveSnapshot({
        accountId: 2,
        snapshotDate: '2025-04-01',
        pdno: '005930',
        name: '삼성전자',
        currentPrice: 60000,
        lots,
      });

      const snapA = repo.snapshotByDate(1, '2025-04-01');
      const snapB = repo.snapshotByDate(2, '2025-04-01');
      expect(snapA.isOk() && snapB.isOk()).toBe(true);
      if (snapA.isOk() && snapB.isOk()) {
        expect(snapA.value[0]?.currentPrice).toBe(72000);
        expect(snapB.value[0]?.currentPrice).toBe(60000);
      }
    });

    it('스냅샷 없는 날짜 → 빈 배열', () => {
      const repo = setupRepo();
      const snap = repo.snapshotByDate(1, '2099-12-31');
      expect(snap.isOk()).toBe(true);
      if (snap.isOk()) {
        expect(snap.value).toHaveLength(0);
      }
    });
  });

  describe('수동편집(A7) — manualInsert/Update/Delete/Move/applyStockSplitRatio + Undo', () => {
    function seed(repo: LotsRepo, accountId: number): { id1: number; id2: number } {
      const r1 = repo.insertLot({
        accountId,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date('2026-04-01T00:00:00Z'),
      });
      const r2 = repo.insertLot({
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
      return { id1: r1.value, id2: r2.value };
    }

    it('manualInsert: 새 차수 삽입 + before/after 반환', () => {
      const repo = setupRepo();
      seed(repo, 1);
      const r = repo.manualInsert({
        accountId: 1,
        pdno: '005930',
        nth: 3,
        buyPrice: 60000,
        qty: 14,
        amountKrw: 840_000,
        status: 'OPEN',
        boughtAt: new Date('2026-04-03T00:00:00Z'),
      });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.before).toBeNull();
        expect(r.value.after?.nth).toBe(3);
        expect(r.value.fullSnapshot).toHaveLength(2); // baseline (insert 전)
      }
      const snap = repo.snapshot(1, '005930');
      if (snap.isOk()) expect(snap.value.lots).toHaveLength(3);
    });

    it('manualInsert: 동일 nth 충돌 → CONFLICT', () => {
      const repo = setupRepo();
      seed(repo, 1);
      const r = repo.manualInsert({
        accountId: 1,
        pdno: '005930',
        nth: 1, // 이미 존재
        buyPrice: 50000,
        qty: 5,
        amountKrw: 250_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.kind).toBe('CONFLICT');
    });

    it('manualUpdate: 단가/수량 수정 + before/after 캡처', () => {
      const repo = setupRepo();
      const { id1 } = seed(repo, 1);
      const r = repo.manualUpdate(1, id1, { buyPrice: 80000, qty: 8, amountKrw: 640_000 });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.before?.buyPrice).toBe(70000);
        expect(r.value.after?.buyPrice).toBe(80000);
        expect(r.value.after?.qty).toBe(8);
      }
    });

    it('manualUpdate: 다른 계좌의 lotId → NOT_FOUND (per-account 격리)', () => {
      const repo = setupRepo();
      const { id1 } = seed(repo, 1);
      const r = repo.manualUpdate(2, id1, { buyPrice: 1 });
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.kind).toBe('NOT_FOUND');
      // 원본은 그대로
      const snap = repo.snapshot(1, '005930');
      if (snap.isOk()) expect(snap.value.lots[0]?.buyPrice).toBe(70000);
    });

    it('manualDelete: 삭제 + before 캡처', () => {
      const repo = setupRepo();
      const { id2 } = seed(repo, 1);
      const r = repo.manualDelete(1, id2);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.before?.nth).toBe(2);
        expect(r.value.after).toBeNull();
      }
      const snap = repo.snapshot(1, '005930');
      if (snap.isOk()) expect(snap.value.lots).toHaveLength(1);
    });

    it('manualDelete: 다른 계좌 lotId → NOT_FOUND (per-account 격리)', () => {
      const repo = setupRepo();
      const { id2 } = seed(repo, 1);
      const r = repo.manualDelete(2, id2);
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.kind).toBe('NOT_FOUND');
      // 원본은 그대로
      const snap = repo.snapshot(1, '005930');
      if (snap.isOk()) expect(snap.value.lots).toHaveLength(2);
    });

    it('manualMove: nth 변경 + 충돌 검사', () => {
      const repo = setupRepo();
      const { id1 } = seed(repo, 1);
      const moveOk = repo.manualMove(1, id1, 5);
      expect(moveOk.isOk()).toBe(true);
      // 충돌
      const moveDup = repo.manualMove(1, id1, 2); // 이미 nth=2 존재
      expect(moveDup.isErr()).toBe(true);
      if (moveDup.isErr()) expect(moveDup.error.kind).toBe('CONFLICT');
    });

    it('applyStockSplitRatio: 모든 차수 단가 정확히 변경 + amountKrw 재계산', () => {
      const repo = setupRepo();
      seed(repo, 1);
      // 1:2 액면분할 — 단가는 절반(-50%) → multiplier 0.5
      const r = repo.applyStockSplitRatio(1, '005930', -50);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.before).toHaveLength(2);
        expect(r.value.after).toHaveLength(2);
        // 70000 → 35000, amountKrw = 35000*10 = 350_000
        const after1 = r.value.after.find((x) => x.nth === 1);
        const after2 = r.value.after.find((x) => x.nth === 2);
        expect(after1?.buyPrice).toBe(35000);
        expect(after1?.amountKrw).toBe(350_000);
        expect(after2?.buyPrice).toBe(32500);
        expect(after2?.amountKrw).toBe(390_000);
      }
    });

    it('applyStockSplitRatio: 0% / -100% 거부', () => {
      const repo = setupRepo();
      seed(repo, 1);
      const z = repo.applyStockSplitRatio(1, '005930', 0);
      expect(z.isErr()).toBe(true);
      const neg = repo.applyStockSplitRatio(1, '005930', -100);
      expect(neg.isErr()).toBe(true);
    });

    it('applyStockSplitRatio: 다른 계좌 종목은 영향 없음 (per-account 격리)', () => {
      const repo = setupRepo();
      seed(repo, 1);
      seed(repo, 2);
      const r = repo.applyStockSplitRatio(1, '005930', 100); // +100%
      expect(r.isOk()).toBe(true);
      const snap2 = repo.snapshot(2, '005930');
      if (snap2.isOk()) {
        // 계좌 2 는 손대지 않음
        expect(snap2.value.lots.find((l) => l.nth === 1)?.buyPrice).toBe(70000);
      }
    });

    it('restoreFromSnapshot (Undo): 직전 상태 완전 복원', () => {
      const repo = setupRepo();
      const { id1 } = seed(repo, 1);
      // baseline 캡처
      const baseline = repo.listRows(1, '005930');
      if (baseline.isErr()) throw new Error('baseline fetch failed');
      const baselineRows = baseline.value;

      // 변경 적용
      repo.manualUpdate(1, id1, { buyPrice: 99999, qty: 1, amountKrw: 99999 });
      const after = repo.snapshot(1, '005930');
      if (after.isOk()) expect(after.value.lots[0]?.buyPrice).toBe(99999);

      // Undo
      const restored = repo.restoreFromSnapshot(1, '005930', baselineRows);
      expect(restored.isOk()).toBe(true);
      if (restored.isOk()) expect(restored.value.restored).toBe(2);
      const final = repo.snapshot(1, '005930');
      if (final.isOk()) {
        expect(final.value.lots).toHaveLength(2);
        // 원본 buyPrice 복원
        const lot1 = final.value.lots.find((l) => l.nth === 1);
        expect(lot1?.buyPrice).toBe(70000);
      }
    });

    it('restoreFromSnapshot: 다른 계좌 snapshot 거부 (per-account 격리)', () => {
      const repo = setupRepo();
      seed(repo, 1);
      seed(repo, 2);
      const snap1 = repo.listRows(1, '005930');
      if (snap1.isErr()) throw new Error('snap1');
      // 계좌 2 에 계좌 1 snapshot 으로 복원 시도 → CONFLICT
      const r = repo.restoreFromSnapshot(2, '005930', snap1.value);
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.kind).toBe('CONFLICT');
    });

    it('listRows: 정렬 + per-account 격리', () => {
      const repo = setupRepo();
      seed(repo, 1);
      seed(repo, 2);
      const r1 = repo.listRows(1, '005930');
      const r2 = repo.listRows(2, '005930');
      if (r1.isErr() || r2.isErr()) throw new Error('listRows');
      expect(r1.value).toHaveLength(2);
      expect(r2.value).toHaveLength(2);
      // 다른 종목 포함 안 됨 + nth asc
      expect(r1.value[0]?.nth).toBe(1);
      expect(r1.value[1]?.nth).toBe(2);
    });
  });

  describe('per-account 격리 회귀 방지', () => {
    it('계좌 A에 등록한 lot 이 계좌 B snapshot 에 안 나옴', () => {
      const repo = setupRepo();
      const a = repo.insertLot({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      const b = repo.insertLot({
        accountId: 2,
        pdno: '005930',
        nth: 1,
        buyPrice: 60000,
        qty: 5,
        amountKrw: 300_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      expect(a.isOk() && b.isOk()).toBe(true);

      const snapA = repo.snapshot(1, '005930');
      const snapB = repo.snapshot(2, '005930');
      if (snapA.isErr() || snapB.isErr()) throw new Error('snap');

      expect(snapA.value.lots).toHaveLength(1);
      expect(snapA.value.lots[0]?.buyPrice).toBe(70000);
      expect(snapB.value.lots).toHaveLength(1);
      expect(snapB.value.lots[0]?.buyPrice).toBe(60000);
    });

    it('동일 (pdno, nth) 라도 account_id 다르면 중복 거부 안 됨', () => {
      const repo = setupRepo();
      const a = repo.insertLot({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      const b = repo.insertLot({
        accountId: 2,
        pdno: '005930',
        nth: 1,
        buyPrice: 60000,
        qty: 5,
        amountKrw: 300_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      expect(a.isOk()).toBe(true);
      expect(b.isOk()).toBe(true); // 다른 계좌면 OK
    });

    it('계좌 A의 replan 이 계좌 B의 lot 을 건드리지 않음', () => {
      const repo = setupRepo();
      repo.insertLot({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      repo.insertLot({
        accountId: 2,
        pdno: '005930',
        nth: 1,
        buyPrice: 60000,
        qty: 5,
        amountKrw: 300_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });

      const r = repo.replan(1, {
        pdno: '005930',
        entries: [{ nth: 1, buyPrice: 80000, qty: 12, amountKrw: 960_000, boughtAt: new Date() }],
      });
      expect(r.isOk()).toBe(true);

      const snapB = repo.snapshot(2, '005930');
      if (snapB.isErr()) throw new Error('snap');
      // 계좌 B 의 1차는 버틸어야 한다.
      expect(snapB.value.lots).toHaveLength(1);
      expect(snapB.value.lots[0]?.buyPrice).toBe(60000);
    });
  });

  describe('cyclesByPdno — 매매 사이클 조회', () => {
    function seedMixed(repo: LotsRepo, accountId: number): void {
      // 005930: 1차 OPEN, 2차 SOLD(익절), 3차 BUYING, 4차 SELLING
      repo.insertLot({
        accountId,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date('2026-04-01T00:00:00Z'),
      });
      const sold = repo.insertLot({
        accountId,
        pdno: '005930',
        nth: 2,
        buyPrice: 65000,
        qty: 12,
        amountKrw: 780_000,
        status: 'OPEN',
        boughtAt: new Date('2026-04-02T00:00:00Z'),
      });
      if (sold.isOk()) {
        repo.updateLotStatus({
          lotId: sold.value,
          status: 'SOLD',
          sellPrice: 70000,
          soldAt: new Date('2026-04-05T00:00:00Z'),
        });
      }
      repo.insertLot({
        accountId,
        pdno: '005930',
        nth: 3,
        buyPrice: 60000,
        qty: 14,
        amountKrw: 840_000,
        status: 'BUYING',
        boughtAt: new Date('2026-04-03T00:00:00Z'),
      });
      repo.insertLot({
        accountId,
        pdno: '005930',
        nth: 4,
        buyPrice: 55000,
        qty: 16,
        amountKrw: 880_000,
        status: 'SELLING',
        boughtAt: new Date('2026-04-04T00:00:00Z'),
      });
      // 다른 종목 — 000660 1차 OPEN
      repo.insertLot({
        accountId,
        pdno: '000660',
        nth: 1,
        buyPrice: 180_000,
        qty: 5,
        amountKrw: 900_000,
        status: 'OPEN',
        boughtAt: new Date('2026-04-01T00:00:00Z'),
      });
    }

    it("status='all' — 모든 차수 반환 (SELLING 포함)", () => {
      const { repo } = setupRepoWithMaster();
      seedMixed(repo, 1);
      const r = repo.cyclesByPdno({ accountId: 1, pdno: '005930', status: 'all' });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value).toHaveLength(4);
        const statuses = r.value.map((c) => c.status).sort();
        expect(statuses).toEqual(['BUYING', 'OPEN', 'SELLING', 'SOLD']);
      }
    });

    it("status='open' — OPEN/BUYING만 (SOLD/SELLING 제외)", () => {
      const { repo } = setupRepoWithMaster();
      seedMixed(repo, 1);
      const r = repo.cyclesByPdno({ accountId: 1, pdno: '005930', status: 'open' });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value).toHaveLength(2);
        const statuses = new Set(r.value.map((c) => c.status));
        expect(statuses.has('OPEN')).toBe(true);
        expect(statuses.has('BUYING')).toBe(true);
        expect(statuses.has('SOLD')).toBe(false);
        expect(statuses.has('SELLING')).toBe(false);
      }
    });

    it("status='closed' — SOLD만 (pnl/pnlRate 계산)", () => {
      const { repo } = setupRepoWithMaster();
      seedMixed(repo, 1);
      const r = repo.cyclesByPdno({ accountId: 1, pdno: '005930', status: 'closed' });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value).toHaveLength(1);
        const sold = r.value[0];
        expect(sold?.status).toBe('SOLD');
        // sellPrice 70000 * qty 12 = 840_000 - amountKrw 780_000 = 60_000 (≈7.69%)
        expect(sold?.pnl).toBe(60_000);
        expect(sold?.pnlRate).toBeCloseTo(7.6923, 3);
        expect(sold?.sellPrice).toBe(70000);
        expect(sold?.soldAt).toBe(Date.parse('2026-04-05T00:00:00Z'));
      }
    });

    it('pdno 옵셔널 — 미지정 시 모든 종목 반환', () => {
      const { repo } = setupRepoWithMaster();
      seedMixed(repo, 1);
      const r = repo.cyclesByPdno({ accountId: 1, status: 'all' });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        const pdnos = new Set(r.value.map((c) => c.pdno));
        expect(pdnos.has('005930')).toBe(true);
        expect(pdnos.has('000660')).toBe(true);
        expect(r.value).toHaveLength(5);
      }
    });

    it('per-account 격리 — 다른 계좌 lot 안 보임', () => {
      const { repo } = setupRepoWithMaster();
      seedMixed(repo, 1);
      seedMixed(repo, 2);
      const r1 = repo.cyclesByPdno({ accountId: 1, pdno: '005930', status: 'all' });
      const r2 = repo.cyclesByPdno({ accountId: 2, pdno: '005930', status: 'all' });
      expect(r1.isOk() && r2.isOk()).toBe(true);
      if (r1.isOk() && r2.isOk()) {
        expect(r1.value).toHaveLength(4);
        expect(r2.value).toHaveLength(4);
        // 두 계좌의 차수 ID는 겹치지 않아야 한다.
        const ids1 = new Set(r1.value.map((c) => c.id));
        for (const c of r2.value) expect(ids1.has(c.id)).toBe(false);
      }
    });

    it('종목명 lookup — stockMasterRepo 주입 시 name 채워짐', () => {
      const { repo } = setupRepoWithMaster();
      seedMixed(repo, 1);
      const r = repo.cyclesByPdno({ accountId: 1, pdno: '005930', status: 'open' });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.every((c) => c.name === '삼성전자')).toBe(true);
      }
    });

    it('stockMasterRepo 미주입 시 name=빈 문자열 (BC)', () => {
      const repo = setupRepo(); // master 없이 생성
      repo.insertLot({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      const r = repo.cyclesByPdno({ accountId: 1, pdno: '005930', status: 'all' });
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value[0]?.name).toBe('');
      }
    });

    it('OPEN 차수는 pnl/pnlRate undefined', () => {
      const { repo } = setupRepoWithMaster();
      seedMixed(repo, 1);
      const r = repo.cyclesByPdno({ accountId: 1, pdno: '005930', status: 'open' });
      if (r.isOk()) {
        for (const c of r.value) {
          expect(c.pnl).toBeUndefined();
          expect(c.pnlRate).toBeUndefined();
          expect(c.sellPrice).toBeUndefined();
          expect(c.soldAt).toBeUndefined();
        }
      }
    });
  });
});
