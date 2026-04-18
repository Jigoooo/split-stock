import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { eventLogs, lots, orders, trades } from '../db/schema';
import {
  computeDailyReport,
  computeDailyReportFromLots,
  exportEventsCsv,
  exportLotsCsv,
  exportTradesCsv,
} from './daily-report';

function setupDb() {
  const db = createTestDb();
  bootstrapSchema(db);
  return db;
}

const range = {
  from: new Date('2026-04-01'),
  to: new Date('2026-04-30'),
};

describe('computeDailyReportFromLots', () => {
  it('SOLD 차수 기반 실현손익 + 승률', () => {
    const summary = computeDailyReportFromLots(
      [
        {
          nth: 1,
          buyPrice: 70_000,
          sellPrice: 73_500,
          qty: 10,
          boughtAt: new Date('2026-04-01'),
          soldAt: new Date('2026-04-03'),
        },
        {
          nth: 2,
          buyPrice: 67_800,
          sellPrice: 65_000,
          qty: 10,
          boughtAt: new Date('2026-04-05'),
          soldAt: new Date('2026-04-10'),
        },
      ],
      5,
      range,
    );
    expect(summary.totalTrades).toBe(5);
    expect(summary.soldLots).toBe(2);
    // (73500-70000)*10 + (65000-67800)*10 = 35000 - 28000 = 7000
    expect(summary.realizedPnlKrw).toBe(7_000);
    expect(summary.winRate).toBe(0.5);
    // 보유일: 2일, 5일 → 평균 3.5일
    expect(summary.avgHoldingDays).toBeCloseTo(3.5, 3);
  });

  it('빈 입력 → 0 KPI', () => {
    const summary = computeDailyReportFromLots([], 0, range);
    expect(summary.realizedPnlKrw).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.avgHoldingDays).toBe(0);
    expect(summary.maxDrawdownKrw).toBe(0);
  });

  it('최대 drawdown: peak 이후 하락폭', () => {
    const summary = computeDailyReportFromLots(
      [
        // 누적: +10000 → peak=10k
        {
          nth: 1,
          buyPrice: 100,
          sellPrice: 200,
          qty: 100,
          boughtAt: new Date('2026-04-01'),
          soldAt: new Date('2026-04-02'),
        },
        // 누적: 10000 - 7000 = 3000, peak=10000 → drawdown=7000
        {
          nth: 2,
          buyPrice: 100,
          sellPrice: 30,
          qty: 100,
          boughtAt: new Date('2026-04-02'),
          soldAt: new Date('2026-04-03'),
        },
        // 누적: 3000 + 2000 = 5000, peak 유지
        {
          nth: 3,
          buyPrice: 100,
          sellPrice: 120,
          qty: 100,
          boughtAt: new Date('2026-04-03'),
          soldAt: new Date('2026-04-04'),
        },
      ],
      3,
      range,
    );
    expect(summary.maxDrawdownKrw).toBe(7_000);
  });

  it('sellPrice=null 차수는 손익에서 제외', () => {
    const summary = computeDailyReportFromLots(
      [
        {
          nth: 1,
          buyPrice: 70_000,
          sellPrice: null,
          qty: 10,
          boughtAt: new Date('2026-04-01'),
          soldAt: null,
        },
      ],
      0,
      range,
    );
    expect(summary.realizedPnlKrw).toBe(0);
  });
});

describe('computeDailyReport (DB integration)', () => {
  it('SOLD lots를 읽어 집계', () => {
    const db = setupDb();
    db.insert(lots)
      .values([
        {
          accountId: 1,
          pdno: '005930',
          nth: 1,
          buyPrice: 70_000,
          qty: 10,
          amountKrw: 700_000,
          status: 'SOLD',
          boughtAt: new Date('2026-04-05'),
          soldAt: new Date('2026-04-10'),
          sellPrice: 73_500,
        },
      ])
      .run();
    db.insert(trades)
      .values([{ orderId: 1, qty: 10, price: 73_500, executedAt: new Date('2026-04-10') }])
      .run();

    const summary = computeDailyReport(db, range);
    expect(summary.soldLots).toBe(1);
    expect(summary.realizedPnlKrw).toBe(35_000);
    expect(summary.totalTrades).toBe(1);
  });
});

describe('exportTradesCsv / exportLotsCsv', () => {
  it('trades 정렬 + 헤더 출력', () => {
    const db = setupDb();
    db.insert(orders)
      .values([
        {
          accountId: 1,
          lotId: null,
          odno: 'ODN1',
          pdno: '005930',
          side: 'BUY',
          division: 'LIMIT',
          qty: 10,
          price: 70_000,
          status: 'FILLED',
          placedAt: new Date('2026-04-10'),
          filledAt: new Date('2026-04-10'),
        },
      ])
      .run();
    db.insert(trades)
      .values([{ orderId: 1, qty: 10, price: 70_000, executedAt: new Date('2026-04-10') }])
      .run();

    const csv = exportTradesCsv(db, range);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain('체결시각,종목코드,매매구분');
    expect(csv).toContain('005930');
  });

  it('exportLotsCsv 헤더 + BOM', () => {
    const db = setupDb();
    db.insert(lots)
      .values([
        {
          accountId: 1,
          pdno: '005930',
          nth: 1,
          buyPrice: 70_000,
          qty: 10,
          amountKrw: 700_000,
          status: 'OPEN',
          boughtAt: new Date('2026-04-05'),
        },
      ])
      .run();
    const csv = exportLotsCsv(db, range);
    expect(csv).toContain('계좌ID,종목코드,차수');
    expect(csv).toContain('005930');
  });
});

describe('exportEventsCsv', () => {
  it('기간 + level 필터 + 정렬', () => {
    const db = setupDb();
    db.insert(eventLogs)
      .values([
        {
          ts: new Date('2026-04-10'),
          level: 'WARN',
          category: 'ORDER',
          message: 'order.cash.business_error',
          payloadJson: '{"x":1}',
        },
        {
          ts: new Date('2026-04-11'),
          level: 'INFO',
          category: 'AUTH',
          message: 'auth.env.restored',
          payloadJson: null,
        },
        {
          ts: new Date('2026-05-01'), // 범위 밖
          level: 'WARN',
          category: 'ORDER',
          message: 'outside',
          payloadJson: null,
        },
      ])
      .run();

    const csv = exportEventsCsv(db, { ...range, level: 'WARN' });
    expect(csv).toContain('order.cash.business_error');
    expect(csv).not.toContain('auth.env.restored'); // INFO 필터됨
    expect(csv).not.toContain('outside'); // 범위 밖
  });
});
