import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb, type Db } from '../db/client';
import { watchOrders } from '../db/schema';
import { FakeTimer } from '../testing/fake-timer';
import {
  type ExecutionResult,
  WatchEngine,
  type WatchHandler,
  type WatchOrderInput,
} from './watch-engine';

function setup(): { db: Db; timer: FakeTimer } {
  const db = createTestDb();
  bootstrapSchema(db);
  return { db, timer: new FakeTimer() };
}

const buyInput = (overrides: Partial<WatchOrderInput> = {}): WatchOrderInput => ({
  accountId: 1,
  pdno: '005930',
  source: 'CUSTOM',
  side: 'BUY',
  targetPrice: 60_000,
  comparator: 'LTE',
  orderType: 'LIMIT',
  qtyOrAmountMode: 'QTY',
  qty: 10,
  ...overrides,
});

const okHandler: WatchHandler = async () => ({ ok: true });

async function flush(): Promise<void> {
  // microtask flush — 핸들러 await 후 후속 DB 갱신 완료 대기
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('WatchEngine', () => {
  it('register: WATCHING 상태로 DB insert + 큐 추가', () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: okHandler } });

    const r = engine.register(buyInput());
    expect(r.isOk()).toBe(true);
    if (r.isErr()) throw new Error('register failed');
    expect(r.value.status).toBe('WATCHING');
    expect(r.value.targetPrice).toBe(60_000);
    expect(engine.size()).toBe(1);

    const rows = db.select().from(watchOrders).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('WATCHING');
  });

  it('register: 잘못된 입력은 VALIDATION 에러', () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: {} });
    const r = engine.register(
      buyInput({ qtyOrAmountMode: 'AMOUNT', qty: 10, amountKrw: undefined }),
    );
    expect(r.isErr()).toBe(true);
    if (r.isOk()) throw new Error('expected error');
    expect(r.error.kind).toBe('VALIDATION');
  });

  it('onPrice (BUY/LTE): targetPrice 이하 도달 시 트리거 → EXECUTED', async () => {
    const { db, timer } = setup();
    const triggered: number[] = [];
    const engine = new WatchEngine({
      db,
      timer,
      handlers: { CUSTOM: okHandler },
      onTriggered: (o) => triggered.push(o.id),
    });

    const r = engine.register(buyInput({ targetPrice: 60_000, comparator: 'LTE' }));
    if (r.isErr()) throw new Error('register failed');

    engine.onPrice('005930', 61_000); // 미도달
    await flush();
    expect(triggered).toEqual([]);

    engine.onPrice('005930', 60_000); // 경계 = 트리거
    await flush();
    expect(triggered).toEqual([r.value.id]);
    expect(engine.size()).toBe(0);

    const row = db.select().from(watchOrders).where(eq(watchOrders.id, r.value.id)).get();
    expect(row?.status).toBe('EXECUTED');
    expect(row?.executedAt).not.toBeNull();
  });

  it('onPrice (SELL/GTE): targetPrice 이상 도달 시 트리거', async () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: okHandler } });
    const r = engine.register(buyInput({ side: 'SELL', comparator: 'GTE', targetPrice: 70_000 }));
    if (r.isErr()) throw new Error('register failed');

    engine.onPrice('005930', 69_999);
    await flush();
    let row = db.select().from(watchOrders).where(eq(watchOrders.id, r.value.id)).get();
    expect(row?.status).toBe('WATCHING');

    engine.onPrice('005930', 70_000);
    await flush();
    row = db.select().from(watchOrders).where(eq(watchOrders.id, r.value.id)).get();
    expect(row?.status).toBe('EXECUTED');
  });

  it('handler 실패: status=FAILED + lastFailureReason 기록', async () => {
    const { db, timer } = setup();
    const failedHandler: WatchHandler = async () => ({ ok: false, reason: 'API 거부' });
    const failed: Array<{ id: number; reason: string }> = [];
    const engine = new WatchEngine({
      db,
      timer,
      handlers: { CUSTOM: failedHandler },
      onFailed: (o, reason) => failed.push({ id: o.id, reason }),
    });

    const r = engine.register(buyInput());
    if (r.isErr()) throw new Error('register failed');

    engine.onPrice('005930', 59_000);
    await flush();
    expect(failed).toEqual([{ id: r.value.id, reason: 'API 거부' }]);

    const row = db.select().from(watchOrders).where(eq(watchOrders.id, r.value.id)).get();
    expect(row?.status).toBe('FAILED');
    expect(row?.lastFailureReason).toBe('API 거부');
    expect(engine.size()).toBe(0);
  });

  it('handler 미등록 source: FAILED + 사유 기록', async () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: {} });
    const r = engine.register(buyInput({ source: 'BOOSTER' }));
    if (r.isErr()) throw new Error('register failed');

    engine.onPrice('005930', 50_000);
    await flush();

    const row = db.select().from(watchOrders).where(eq(watchOrders.id, r.value.id)).get();
    expect(row?.status).toBe('FAILED');
    expect(row?.lastFailureReason).toContain('handler 미등록');
  });

  it('cancel: WATCHING → CANCELLED, 큐에서 제거', () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: okHandler } });
    const r = engine.register(buyInput());
    if (r.isErr()) throw new Error('register failed');

    const c = engine.cancel(r.value.id);
    expect(c.isOk()).toBe(true);
    expect(engine.size()).toBe(0);

    // 취소 후 가격 도달해도 트리거 X
    engine.onPrice('005930', 50_000);
    const row = db.select().from(watchOrders).where(eq(watchOrders.id, r.value.id)).get();
    expect(row?.status).toBe('CANCELLED');
  });

  it('cancel: 존재하지 않는 id는 NOT_FOUND', () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: {} });
    const c = engine.cancel(999);
    expect(c.isErr()).toBe(true);
    if (c.isOk()) throw new Error('expected error');
    expect(c.error.kind).toBe('NOT_FOUND');
  });

  it('startCycle: expires_at 경과 시 EXPIRED + 큐 제거', () => {
    const { db, timer } = setup();
    const expired: number[] = [];
    const engine = new WatchEngine({
      db,
      timer,
      expiryCheckMs: 10_000,
      handlers: { CUSTOM: okHandler },
      onExpired: (o) => expired.push(o.id),
    });
    const r = engine.register(buyInput({ expiresAt: 50_000 }));
    if (r.isErr()) throw new Error('register failed');

    engine.startCycle();
    timer.advance(60_000); // 50_000 만료점 통과
    expect(expired).toEqual([r.value.id]);
    expect(engine.size()).toBe(0);

    const row = db.select().from(watchOrders).where(eq(watchOrders.id, r.value.id)).get();
    expect(row?.status).toBe('EXPIRED');
  });

  it('list: 필터링 (status / source / accountId)', () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: okHandler } });
    engine.register(buyInput({ source: 'BOOSTER' }));
    engine.register(buyInput({ source: 'PREBUY', pdno: '000660' }));
    engine.register(buyInput({ source: 'CUSTOM', accountId: 2 }));

    expect(engine.list().length).toBe(3);
    expect(engine.list({ source: 'BOOSTER' }).length).toBe(1);
    expect(engine.list({ accountId: 2 }).length).toBe(1);
    expect(engine.list({ status: 'WATCHING' }).length).toBe(3);
    expect(engine.list({ status: 'EXECUTED' }).length).toBe(0);
  });

  it('reload: WATCHING 항목만 큐에 적재', () => {
    const { db, timer } = setup();
    const now = new Date();
    db.insert(watchOrders)
      .values([
        {
          accountId: 1,
          pdno: '005930',
          source: 'CUSTOM',
          side: 'BUY',
          targetPrice: 60_000,
          comparator: 'LTE',
          orderType: 'LIMIT',
          qtyOrAmountMode: 'QTY',
          qty: 10,
          amountKrw: null,
          nth: null,
          expiresAt: null,
          status: 'WATCHING',
          lastFailureReason: null,
          createdAt: now,
          updatedAt: now,
          executedAt: null,
        },
        {
          accountId: 1,
          pdno: '000660',
          source: 'CUSTOM',
          side: 'BUY',
          targetPrice: 30_000,
          comparator: 'LTE',
          orderType: 'LIMIT',
          qtyOrAmountMode: 'QTY',
          qty: 5,
          amountKrw: null,
          nth: null,
          expiresAt: null,
          status: 'EXECUTED',
          lastFailureReason: null,
          createdAt: now,
          updatedAt: now,
          executedAt: now,
        },
      ])
      .run();

    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: okHandler } });
    expect(engine.size()).toBe(1); // EXECUTED는 제외
  });

  it('handler 비동기 throw도 FAILED로 처리', async () => {
    const { db, timer } = setup();
    const throwingHandler: WatchHandler = async () => {
      throw new Error('네트워크 에러');
    };
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: throwingHandler } });
    const r = engine.register(buyInput());
    if (r.isErr()) throw new Error('register failed');

    engine.onPrice('005930', 50_000);
    await flush();

    const row = db.select().from(watchOrders).where(eq(watchOrders.id, r.value.id)).get();
    expect(row?.status).toBe('FAILED');
    expect(row?.lastFailureReason).toBe('네트워크 에러');
  });

  it('중복 트리거 방지: inFlight 동안 추가 onPrice 무시', async () => {
    const { db, timer } = setup();
    let calls = 0;
    let resolveHandler: ((r: ExecutionResult) => void) | null = null;
    const slowHandler: WatchHandler = () => {
      calls++;
      return new Promise<ExecutionResult>((resolve) => {
        resolveHandler = resolve;
      });
    };
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: slowHandler } });
    engine.register(buyInput());

    engine.onPrice('005930', 50_000);
    engine.onPrice('005930', 49_000);
    engine.onPrice('005930', 48_000);

    expect(calls).toBe(1);
    if (resolveHandler !== null) {
      (resolveHandler as (r: ExecutionResult) => void)({ ok: true });
    }
    await flush();
  });

  it('stop: 이후 onPrice는 무시', async () => {
    const { db, timer } = setup();
    let called = 0;
    const handler: WatchHandler = async () => {
      called++;
      return { ok: true };
    };
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: handler } });
    engine.register(buyInput());
    engine.stop();
    engine.onPrice('005930', 50_000);
    await flush();
    expect(called).toBe(0);
  });
});
