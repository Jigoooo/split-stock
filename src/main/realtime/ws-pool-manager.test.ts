import { describe, expect, it } from 'vitest';
import type { Timer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';
import {
  type RestFallbackAdapter,
  WsPoolManager,
  type WsSubscribeAdapter,
} from './ws-pool-manager';

function createFakeLogger(): EventLogger {
  return { log: () => undefined };
}

interface FakeWsCall {
  op: 'sub' | 'unsub';
  accountId: number;
  pdno: string;
  kind: 'PRICE' | 'ORDERBOOK' | 'BOTH';
}

function createFakeWs(): WsSubscribeAdapter & { calls: FakeWsCall[] } {
  const calls: FakeWsCall[] = [];
  return {
    calls,
    subscribe: (accountId, pdno, kind) => calls.push({ op: 'sub', accountId, pdno, kind }),
    unsubscribe: (accountId, pdno, kind) => calls.push({ op: 'unsub', accountId, pdno, kind }),
  };
}

interface FakeRestCall {
  op: 'sub' | 'unsub';
  pdno: string;
}

function createFakeRest(): RestFallbackAdapter & { calls: FakeRestCall[] } {
  const calls: FakeRestCall[] = [];
  return {
    calls,
    subscribe: (pdno) => calls.push({ op: 'sub', pdno }),
    unsubscribe: (pdno) => calls.push({ op: 'unsub', pdno }),
  };
}

const fakeTimer: Timer = {
  setTimeout: (cb) => {
    cb();
    return { clear: () => undefined };
  },
  setInterval: () => ({ clear: () => undefined }),
  now: () => 0,
};

describe('WsPoolManager — capacity 라우팅', () => {
  it('capacity=20 일 때 21번째 PRICE 종목은 REST fallback 으로 배정', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 20,
      rebalanceDebounceMs: 0,
    });
    for (let i = 0; i < 21; i++) {
      const pdno = String(100000 + i).padStart(6, '0');
      mgr.subscribe({ accountId: 1, pdno, kind: 'PRICE', priority: 50 });
    }
    const active = mgr.getActiveSubscriptions(1);
    const ws20 = active.filter((a) => a.isWS);
    const rest1 = active.filter((a) => a.fallbackToRest);
    expect(ws20).toHaveLength(20);
    expect(rest1).toHaveLength(1);
    // ws.calls 에는 sub 20번, rest.calls 에는 sub 1번
    expect(ws.calls.filter((c) => c.op === 'sub')).toHaveLength(20);
    expect(rest.calls.filter((c) => c.op === 'sub')).toHaveLength(1);
  });

  it('BOTH kind 는 슬롯 2개 소비 — capacity=4 일 때 BOTH×2 만 WS 배정', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 4,
      rebalanceDebounceMs: 0,
    });
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'BOTH', priority: 100 });
    mgr.subscribe({ accountId: 1, pdno: '000002', kind: 'BOTH', priority: 90 });
    mgr.subscribe({ accountId: 1, pdno: '000003', kind: 'BOTH', priority: 80 });
    const active = mgr.getActiveSubscriptions(1);
    expect(active.filter((a) => a.isWS).map((a) => a.pdno)).toEqual(['000001', '000002']);
    // 000003 은 BOTH 라 PRICE 부분만 REST fallback (orderbook REST 는 별도 경로)
    const restSubs = rest.calls.filter((c) => c.op === 'sub').map((c) => c.pdno);
    expect(restSubs).toContain('000003');
  });

  it('priority 변경 시 재배치 — capacity=2 에서 새 priority=100 종목이 기존 priority=10 을 대체', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 2,
      rebalanceDebounceMs: 0,
    });
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'PRICE', priority: 10 });
    mgr.subscribe({ accountId: 1, pdno: '000002', kind: 'PRICE', priority: 10 });
    let active = mgr.getActiveSubscriptions(1);
    expect(active.every((a) => a.isWS)).toBe(true);

    // 새 종목이 들어오면 priority desc 로 가장 낮은 종목이 강등됨
    mgr.subscribe({ accountId: 1, pdno: '000003', kind: 'PRICE', priority: 100 });
    active = mgr.getActiveSubscriptions(1);
    const wsActive = active.filter((a) => a.isWS).map((a) => a.pdno);
    expect(wsActive).toContain('000003');
    expect(wsActive).toHaveLength(2);
    // 강등된 종목은 REST fallback 으로 이동
    expect(active.filter((a) => a.fallbackToRest)).toHaveLength(1);
  });

  it('계좌별 격리 — 계좌 A 의 capacity 초과는 계좌 B 슬롯에 영향 없음', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 2,
      rebalanceDebounceMs: 0,
    });
    // A: 3종목 (capacity=2 초과)
    mgr.subscribe({ accountId: 100, pdno: '000A01', kind: 'PRICE', priority: 50 });
    mgr.subscribe({ accountId: 100, pdno: '000A02', kind: 'PRICE', priority: 50 });
    mgr.subscribe({ accountId: 100, pdno: '000A03', kind: 'PRICE', priority: 50 });
    // B: 2종목 — 모두 WS 배정 가능해야
    mgr.subscribe({ accountId: 200, pdno: '000B01', kind: 'PRICE', priority: 50 });
    mgr.subscribe({ accountId: 200, pdno: '000B02', kind: 'PRICE', priority: 50 });

    const aActive = mgr.getActiveSubscriptions(100);
    const bActive = mgr.getActiveSubscriptions(200);
    expect(aActive.filter((a) => a.isWS)).toHaveLength(2);
    expect(aActive.filter((a) => a.fallbackToRest)).toHaveLength(1);
    expect(bActive.filter((a) => a.isWS)).toHaveLength(2);
    expect(bActive.filter((a) => a.fallbackToRest)).toHaveLength(0);
  });

  it('setSessionCapacity(60) 호출 시 폴링 종목이 WS 로 승격', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 20,
      rebalanceDebounceMs: 0,
    });
    for (let i = 0; i < 30; i++) {
      const pdno = String(100000 + i).padStart(6, '0');
      mgr.subscribe({ accountId: 1, pdno, kind: 'PRICE', priority: 50 });
    }
    let active = mgr.getActiveSubscriptions(1);
    expect(active.filter((a) => a.isWS)).toHaveLength(20);
    expect(active.filter((a) => a.fallbackToRest)).toHaveLength(10);

    mgr.setSessionCapacity(1, 60);
    active = mgr.getActiveSubscriptions(1);
    expect(active.filter((a) => a.isWS)).toHaveLength(30);
    expect(active.filter((a) => a.fallbackToRest)).toHaveLength(0);
  });

  it('unsubscribe 후 재배치 — REST 폴링 종목이 비어진 WS 슬롯으로 승격', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 2,
      rebalanceDebounceMs: 0,
    });
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'PRICE', priority: 50 });
    mgr.subscribe({ accountId: 1, pdno: '000002', kind: 'PRICE', priority: 50 });
    mgr.subscribe({ accountId: 1, pdno: '000003', kind: 'PRICE', priority: 30 });

    let restPdnos = mgr
      .getActiveSubscriptions(1)
      .filter((a) => a.fallbackToRest)
      .map((a) => a.pdno);
    expect(restPdnos).toEqual(['000003']);

    mgr.unsubscribe(1, '000001');
    restPdnos = mgr
      .getActiveSubscriptions(1)
      .filter((a) => a.fallbackToRest)
      .map((a) => a.pdno);
    expect(restPdnos).toEqual([]);
    const wsPdnos = mgr
      .getActiveSubscriptions(1)
      .filter((a) => a.isWS)
      .map((a) => a.pdno)
      .sort();
    expect(wsPdnos).toEqual(['000002', '000003']);
  });

  it('debounce — debounceMs > 0 일 때 reconcile 은 지연되며 reconcileNow 로 즉시 트리거 가능', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    type ScheduledEntry = { cb: () => void; cleared: boolean };
    const scheduled: ScheduledEntry[] = [];
    const manualTimer: Timer = {
      setTimeout: (cb) => {
        const entry: ScheduledEntry = { cb, cleared: false };
        scheduled.push(entry);
        return {
          clear: () => {
            entry.cleared = true;
          },
        };
      },
      setInterval: () => ({ clear: () => undefined }),
      now: () => 0,
    };
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: manualTimer,
      defaultCapacity: 5,
      rebalanceDebounceMs: 200,
    });
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'PRICE', priority: 50 });
    // debounce 미발화 — ws.calls 비어있어야
    expect(ws.calls).toHaveLength(0);
    expect(scheduled.filter((s) => !s.cleared)).toHaveLength(1);

    mgr.reconcileNow();
    // reconcileNow 는 debounce 무시하고 즉시 실행
    expect(ws.calls).toHaveLength(1);
    expect(ws.calls[0]).toMatchObject({ op: 'sub', pdno: '000001', kind: 'PRICE' });
  });

  it('kind-promotion PRICE→BOTH — 기존 PRICE 해지 후 BOTH 로 재구독 (ORDERBOOK 슬롯 추가)', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 10,
      rebalanceDebounceMs: 0,
    });
    // 1) PRICE 로 등록
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'PRICE', priority: 50 });
    expect(ws.calls.filter((c) => c.op === 'sub')).toEqual([
      { op: 'sub', accountId: 1, pdno: '000001', kind: 'PRICE' },
    ]);
    ws.calls.length = 0;

    // 2) BOTH 로 승격 — 같은 priority 라도 kind 변경이므로 갱신.
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'BOTH', priority: 50 });
    // 어댑터에는 prev PRICE unsubscribe + 신규 BOTH subscribe 가 모두 호출되어야 함
    // (그렇지 않으면 ORDERBOOK 슬롯이 누락된 채 BOTH 로 표시됨).
    const calls = ws.calls;
    expect(calls).toEqual([
      { op: 'unsub', accountId: 1, pdno: '000001', kind: 'PRICE' },
      { op: 'sub', accountId: 1, pdno: '000001', kind: 'BOTH' },
    ]);
    // view 도 BOTH 로 일관성 있게 표시
    const view = mgr.getActiveSubscriptions(1);
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ pdno: '000001', kind: 'BOTH', isWS: true });
  });

  it('kind-downgrade BOTH→PRICE — BOTH 전면 해지 후 PRICE 단일 슬롯으로 재구독', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 10,
      rebalanceDebounceMs: 0,
    });
    // 1) BOTH 로 등록
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'BOTH', priority: 50 });
    expect(ws.calls.filter((c) => c.op === 'sub')).toEqual([
      { op: 'sub', accountId: 1, pdno: '000001', kind: 'BOTH' },
    ]);
    ws.calls.length = 0;

    // 2) PRICE 로 다운그레이드 — kind 변경이므로 갱신 (priority 동일)
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'PRICE', priority: 50 });
    // BOTH unsubscribe → PRICE subscribe 가 모두 호출되어야 ORDERBOOK 슬롯이 명시적으로 해제됨
    expect(ws.calls).toEqual([
      { op: 'unsub', accountId: 1, pdno: '000001', kind: 'BOTH' },
      { op: 'sub', accountId: 1, pdno: '000001', kind: 'PRICE' },
    ]);
    const view = mgr.getActiveSubscriptions(1);
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ pdno: '000001', kind: 'PRICE', isWS: true });
  });

  it('dispose — 모든 active 구독 해지 + 슬롯 비우기', () => {
    const ws = createFakeWs();
    const rest = createFakeRest();
    const mgr = new WsPoolManager({
      ws,
      rest,
      logger: createFakeLogger(),
      timer: fakeTimer,
      defaultCapacity: 2,
      rebalanceDebounceMs: 0,
    });
    mgr.subscribe({ accountId: 1, pdno: '000001', kind: 'PRICE', priority: 50 });
    mgr.subscribe({ accountId: 1, pdno: '000002', kind: 'PRICE', priority: 50 });
    mgr.subscribe({ accountId: 1, pdno: '000003', kind: 'PRICE', priority: 30 });
    mgr.dispose();
    expect(mgr.getActiveSubscriptions(1)).toHaveLength(0);
    // 모든 ws + rest 가 unsubscribe 되어야
    expect(ws.calls.filter((c) => c.op === 'unsub')).toHaveLength(2);
    expect(rest.calls.filter((c) => c.op === 'unsub')).toHaveLength(1);
  });
});
