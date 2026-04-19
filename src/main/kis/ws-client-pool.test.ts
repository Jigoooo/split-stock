import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { KIS_BASE_URL } from './endpoints';
import { KisHttpClient } from './http-client';
import type { Timer, WsLike } from './ws-client';
import { createKisWsClientPool } from './ws-client-pool';

function createFakeLogger(): EventLogger {
  return { log: () => undefined };
}

const fakeTimer: Timer = {
  setTimeout: () => ({ clear: () => undefined }),
  setInterval: () => ({ clear: () => undefined }),
  now: () => 0,
};

type WsEvent = { data?: unknown; code?: number; reason?: string; error?: unknown };
type WsListener = (event: WsEvent) => void;

class FakeWs implements WsLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Set<WsListener>>();
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: WsListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: WsListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  trigger(type: 'open' | 'message' | 'close' | 'error', e: WsEvent): void {
    for (const l of Array.from(this.listeners.get(type) ?? [])) l(e);
  }
}

function installMockAgent(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

describe('KisWsClientPool', () => {
  let agent: MockAgent;
  let approvalSeq: number;

  beforeEach(() => {
    agent = installMockAgent();
    approvalSeq = 0;
    const pool = agent.get(KIS_BASE_URL.MOCK);
    pool
      .intercept({ path: /oauth2\/Approval/, method: 'POST' })
      .reply(() => {
        approvalSeq += 1;
        return { statusCode: 200, data: { approval_key: `AK-${approvalSeq}` } };
      })
      .persist();
  });

  function buildPool() {
    const sockets: FakeWs[] = [];
    const factory = (url: string): WsLike => {
      const ws = new FakeWs(url);
      sockets.push(ws);
      return ws;
    };
    const http = new KisHttpClient({ baseUrl: KIS_BASE_URL.MOCK, dispatcher: agent });
    const pool = createKisWsClientPool({
      env: 'MOCK',
      http,
      factory,
      logger: createFakeLogger(),
      timer: fakeTimer,
    });
    return { pool, sockets };
  }

  it('계좌별 별도 KisWsClient 인스턴스 생성 — getOrCreate 두 번 호출 시 다른 client 반환', async () => {
    const { pool, sockets } = buildPool();
    const a = await pool.getOrCreate(1, 'APP_KEY_A', 'SECRET_A');
    const b = await pool.getOrCreate(2, 'APP_KEY_B', 'SECRET_B');
    expect(a.isOk()).toBe(true);
    expect(b.isOk()).toBe(true);
    if (a.isOk() && b.isOk()) {
      expect(a.value).not.toBe(b.value);
    }
    expect(sockets.length).toBe(2);
    expect(pool.listAccounts().sort()).toEqual([1, 2]);
  });

  it('같은 accountId 재호출 시 캐시된 client 반환 (소켓 재생성 X)', async () => {
    const { pool, sockets } = buildPool();
    const r1 = await pool.getOrCreate(1, 'APP_KEY_A', 'SECRET_A');
    const r2 = await pool.getOrCreate(1, 'APP_KEY_A', 'SECRET_A');
    expect(r1.isOk()).toBe(true);
    expect(r2.isOk()).toBe(true);
    if (r1.isOk() && r2.isOk()) expect(r1.value).toBe(r2.value);
    expect(sockets.length).toBe(1);
  });

  it('같은 appKey 가 다른 계좌에 사용되면 VALIDATION 에러 — approval_key 중복 방지', async () => {
    const { pool } = buildPool();
    const a = await pool.getOrCreate(1, 'SHARED_KEY', 'SECRET_X');
    expect(a.isOk()).toBe(true);
    const b = await pool.getOrCreate(2, 'SHARED_KEY', 'SECRET_Y');
    expect(b.isErr()).toBe(true);
    if (b.isErr()) {
      expect(b.error.kind).toBe('VALIDATION');
      expect(b.error.msg).toContain('appKey');
    }
  });

  it('같은 accountId 의 appKey 변경은 VALIDATION — remove 후 재등록 요구', async () => {
    const { pool } = buildPool();
    await pool.getOrCreate(1, 'KEY_OLD', 'SECRET');
    const r = await pool.getOrCreate(1, 'KEY_NEW', 'SECRET');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });

  it('remove 후 같은 appKey 를 다른 계좌에 재할당 가능', async () => {
    const { pool } = buildPool();
    await pool.getOrCreate(1, 'KEY_X', 'SECRET');
    pool.remove(1);
    const r = await pool.getOrCreate(2, 'KEY_X', 'SECRET');
    expect(r.isOk()).toBe(true);
    expect(pool.listAccounts()).toEqual([2]);
  });

  it('dispose — 모든 세션 stop + 풀 비우기', async () => {
    const { pool } = buildPool();
    await pool.getOrCreate(1, 'KEY_A', 'SECRET_A');
    await pool.getOrCreate(2, 'KEY_B', 'SECRET_B');
    expect(pool.listAccounts()).toHaveLength(2);
    pool.dispose();
    expect(pool.listAccounts()).toHaveLength(0);
    expect(pool.get(1)).toBeNull();
  });
});
