import { BROKERS } from '@shared/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb, type Db } from '../db/client';
import { accounts, watchOrders } from '../db/schema';
import { FakeTimer } from '../testing/fake-timer';
import {
  type ExecutionResult,
  WatchEngine,
  type WatchHandler,
  type WatchOrderInput,
} from './watch-engine';

/** Phase 6 H1: upsertWatchOrder 가 accounts.broker 를 lookup 하므로 테스트도 account row 필요. */
function insertTestAccount(db: Db, id: number, broker: string = BROKERS.KIS): void {
  db.insert(accounts)
    .values({
      id,
      env: 'MOCK',
      broker,
      accountNo8: `${id}`.padStart(8, '0'),
      accountProdCd: '01',
      createdAt: new Date(),
    })
    .run();
}

function setup(): { db: Db; timer: FakeTimer } {
  const db = createTestDb();
  bootstrapSchema(db);
  // 테스트에서 사용하는 모든 accountId 에 대해 도메스틱 KIS 계좌 사전 등록.
  for (const id of [1, 2, 7]) insertTestAccount(db, id);
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

  it('pause/resume: PAUSED 동안 트리거되지 않고 재개 후 다시 동작', async () => {
    const { db, timer } = setup();
    const calls: number[] = [];
    const engine = new WatchEngine({
      db,
      timer,
      handlers: {
        CUSTOM: async (order) => {
          calls.push(order.id);
          return { ok: true };
        },
      },
    });
    const r = engine.register(buyInput());
    if (r.isErr()) throw new Error('register failed');

    expect(engine.pause(r.value.id).isOk()).toBe(true);
    engine.onPrice('005930', 50_000);
    await flush();
    expect(calls).toEqual([]);

    const resumed = engine.resume(r.value.id);
    expect(resumed.isOk()).toBe(true);
    engine.onPrice('005930', 50_000);
    await flush();
    expect(calls).toEqual([r.value.id]);
  });

  it('setGlobalEnabled(false): WATCHING row도 실행 차단', async () => {
    const { db, timer } = setup();
    let called = 0;
    const engine = new WatchEngine({
      db,
      timer,
      handlers: {
        CUSTOM: async () => {
          called++;
          return { ok: true };
        },
      },
    });
    engine.setActiveAccountId(1);
    engine.setGlobalEnabled(1, false);
    const r = engine.register(buyInput());
    if (r.isErr()) throw new Error('register failed');

    engine.onPrice('005930', 50_000);
    await flush();
    expect(called).toBe(0);

    engine.setGlobalEnabled(1, true);
    engine.onPrice('005930', 50_000);
    await flush();
    expect(called).toBe(1);
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

  it('registerHandler: per-account 핸들러가 글로벌 fallback보다 우선', async () => {
    const { db, timer } = setup();
    const fallbackCalls: number[] = [];
    const perAccountCalls: number[] = [];
    const fallback: WatchHandler = async (o) => {
      fallbackCalls.push(o.accountId);
      return { ok: true };
    };
    const perAccount: WatchHandler = async (o) => {
      perAccountCalls.push(o.accountId);
      return { ok: true };
    };
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: fallback } });
    engine.registerHandler('CUSTOM', 1, perAccount);

    const r = engine.register(buyInput({ accountId: 1 }));
    if (r.isErr()) throw new Error('register failed');
    engine.onPrice('005930', 50_000);
    await flush();
    expect(perAccountCalls).toEqual([1]);
    expect(fallbackCalls).toEqual([]);
  });

  it('registerHandler: per-account 핸들러 미등록 시 글로벌 fallback 사용 (BC)', async () => {
    const { db, timer } = setup();
    const calls: number[] = [];
    const fallback: WatchHandler = async (o) => {
      calls.push(o.accountId);
      return { ok: true };
    };
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: fallback } });
    // registerHandler 호출 없음 → 단일계좌 시나리오 (기존 BC)
    const r = engine.register(buyInput({ accountId: 7 }));
    if (r.isErr()) throw new Error('register failed');
    engine.onPrice('005930', 50_000);
    await flush();
    expect(calls).toEqual([7]);
  });

  it('registerHandler: 다계좌 라우팅 — A의 트리거가 B의 핸들러를 호출하지 않음', async () => {
    const { db, timer } = setup();
    const aCalls: number[] = [];
    const bCalls: number[] = [];
    const handlerA: WatchHandler = async (o) => {
      aCalls.push(o.accountId);
      return { ok: true };
    };
    const handlerB: WatchHandler = async (o) => {
      bCalls.push(o.accountId);
      return { ok: true };
    };
    const engine = new WatchEngine({ db, timer });
    engine.registerHandler('BOOSTER', 1, handlerA);
    engine.registerHandler('BOOSTER', 2, handlerB);

    const ra = engine.register(buyInput({ source: 'BOOSTER', accountId: 1, pdno: '005930' }));
    const rb = engine.register(buyInput({ source: 'BOOSTER', accountId: 2, pdno: '000660' }));
    if (ra.isErr() || rb.isErr()) throw new Error('register failed');

    engine.onPrice('005930', 50_000); // A만 트리거
    await flush();
    expect(aCalls).toEqual([1]);
    expect(bCalls).toEqual([]);

    engine.onPrice('000660', 50_000); // B만 트리거
    await flush();
    expect(aCalls).toEqual([1]);
    expect(bCalls).toEqual([2]);
  });

  it('unregisterHandler: 해제 후 fallback 핸들러로 라우팅', async () => {
    const { db, timer } = setup();
    const fallbackCalls: number[] = [];
    const perAccountCalls: number[] = [];
    const fallback: WatchHandler = async (o) => {
      fallbackCalls.push(o.accountId);
      return { ok: true };
    };
    const perAccount: WatchHandler = async (o) => {
      perAccountCalls.push(o.accountId);
      return { ok: true };
    };
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: fallback } });
    engine.registerHandler('CUSTOM', 1, perAccount);
    engine.unregisterHandler('CUSTOM', 1);

    const r = engine.register(buyInput({ accountId: 1 }));
    if (r.isErr()) throw new Error('register failed');
    engine.onPrice('005930', 50_000);
    await flush();
    expect(perAccountCalls).toEqual([]);
    expect(fallbackCalls).toEqual([1]);
  });

  it('register: QTY 모드에 amountKrw 같이 전달 시 VALIDATION 거부', () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: okHandler } });
    const r = engine.register(buyInput({ qtyOrAmountMode: 'QTY', qty: 10, amountKrw: 1_000_000 }));
    expect(r.isErr()).toBe(true);
    if (r.isOk()) throw new Error('expected error');
    expect(r.error.kind).toBe('VALIDATION');
  });

  it('register: AMOUNT 모드에 qty 같이 전달 시 VALIDATION 거부', () => {
    const { db, timer } = setup();
    const engine = new WatchEngine({ db, timer, handlers: { CUSTOM: okHandler } });
    const r = engine.register(
      buyInput({ qtyOrAmountMode: 'AMOUNT', qty: 10, amountKrw: 1_000_000 }),
    );
    expect(r.isErr()).toBe(true);
    if (r.isOk()) throw new Error('expected error');
    expect(r.error.kind).toBe('VALIDATION');
  });

  it('expireStale: cancel과 race 시 onExpired 호출 안 함', () => {
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

    // cancel 먼저 호출 → status='CANCELLED'
    const c = engine.cancel(r.value.id);
    expect(c.isOk()).toBe(true);

    // 그 다음 expire 사이클 진입 → conditional update의 changes=0 → onExpired 호출 안 함
    engine.startCycle();
    timer.advance(60_000);
    expect(expired).toEqual([]); // race 가드 — CANCELLED는 EXPIRED로 덮어쓰지 않음
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
