import { createCipheriv } from 'node:crypto';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { KIS_BASE_URL } from './endpoints';
import { KisHttpClient } from './http-client';
import {
  type CniNotice,
  decryptAes256CbcBase64,
  issueApprovalKey,
  KisWsClient,
  type RealtimeMessage,
  type Timer,
  type WsLike,
} from './ws-client';

function createFakeLogger(): EventLogger & { entries: Array<{ message: string }> } {
  const entries: Array<{ message: string }> = [];
  return {
    entries,
    log(entry) {
      entries.push({ message: entry.message });
    },
  };
}

function installMockAgent(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

describe('issueApprovalKey', () => {
  it('approval 응답에서 approval_key 추출', async () => {
    const agent = installMockAgent();
    const BASE = KIS_BASE_URL.MOCK;
    const pool = agent.get(BASE);
    pool.intercept({ path: /oauth2\/Approval/, method: 'POST' }).reply(200, {
      approval_key: 'AK-abcd-1234',
    });
    const http = new KisHttpClient({ baseUrl: BASE, dispatcher: agent });
    const r = await issueApprovalKey(http, 'APPKEY', 'APPSECRET');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('AK-abcd-1234');
  });

  it('approval_key 누락 응답은 VALIDATION 에러', async () => {
    const agent = installMockAgent();
    const BASE = KIS_BASE_URL.MOCK;
    const pool = agent.get(BASE);
    pool.intercept({ path: /oauth2\/Approval/, method: 'POST' }).reply(200, {});
    const http = new KisHttpClient({ baseUrl: BASE, dispatcher: agent });
    const r = await issueApprovalKey(http, 'APPKEY', 'APPSECRET');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });
});

type WsEvent = { data?: unknown; code?: number; reason?: string; error?: unknown };
type WsListener = (event: WsEvent) => void;

class FakeWs implements WsLike {
  readyState = 0;
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  private listeners = new Map<string, Set<WsListener>>();

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed.push({
      ...(code !== undefined && { code }),
      ...(reason !== undefined && { reason }),
    });
    const evt: WsEvent = {
      ...(code !== undefined && { code }),
      ...(reason !== undefined && { reason }),
    };
    this.trigger('close', evt);
  }

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: WsListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: WsListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  trigger(type: 'open' | 'message' | 'close' | 'error', event: WsEvent): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const l of Array.from(set)) l(event);
  }

  openNow(): void {
    this.readyState = 1;
    this.trigger('open', {});
  }

  remoteMessage(data: string): void {
    this.trigger('message', { data });
  }

  remoteClose(code = 1006, reason = 'lost'): void {
    this.readyState = 3;
    this.trigger('close', { code, reason });
  }
}

class FakeTimer implements Timer {
  private timeouts: Array<{ cb: () => void; at: number; cleared: boolean }> = [];
  private intervals: Array<{ cb: () => void; every: number; next: number; cleared: boolean }> = [];
  private current = 0;

  setTimeout(cb: () => void, ms: number): { clear: () => void } {
    const entry = { cb, at: this.current + ms, cleared: false };
    this.timeouts.push(entry);
    return {
      clear: () => {
        entry.cleared = true;
      },
    };
  }

  setInterval(cb: () => void, ms: number): { clear: () => void } {
    const entry = { cb, every: ms, next: this.current + ms, cleared: false };
    this.intervals.push(entry);
    return {
      clear: () => {
        entry.cleared = true;
      },
    };
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    const target = this.current + ms;
    // 안전장치
    for (let i = 0; i < 10_000; i++) {
      const nextTimeoutAt = this.timeouts
        .filter((t) => !t.cleared && t.at <= target)
        .map((t) => t.at)
        .sort((a, b) => a - b)[0];
      const nextIntervalAt = this.intervals
        .filter((t) => !t.cleared && t.next <= target)
        .map((t) => t.next)
        .sort((a, b) => a - b)[0];
      const next = [nextTimeoutAt, nextIntervalAt]
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b)[0];
      if (next === undefined) break;
      this.current = next;
      const firingTimeouts = this.timeouts.filter((t) => !t.cleared && t.at === next);
      for (const t of firingTimeouts) {
        t.cleared = true;
        t.cb();
      }
      const firingIntervals = this.intervals.filter((t) => !t.cleared && t.next === next);
      for (const t of firingIntervals) {
        t.next = t.next + t.every;
        t.cb();
      }
    }
    this.current = target;
  }
}

function encryptAes256CbcBase64(key: string, iv: string, plainText: string): string {
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  return Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]).toString('base64');
}

describe('KisWsClient', () => {
  let agent: MockAgent;
  let approvalIntercepted = 0;

  beforeEach(() => {
    agent = installMockAgent();
    approvalIntercepted = 0;
    const pool = agent.get(KIS_BASE_URL.MOCK);
    pool
      .intercept({ path: /oauth2\/Approval/, method: 'POST' })
      .reply(() => {
        approvalIntercepted += 1;
        return { statusCode: 200, data: { approval_key: `AK-${approvalIntercepted}` } };
      })
      .persist();
  });

  function build(
    opts: {
      maxSubs?: number;
      heartbeatMs?: number;
      reconnectBaseMs?: number;
      reconnectMaxMs?: number;
      onMessage?: (msg: RealtimeMessage) => void;
      onCniNotice?: (notice: CniNotice) => void;
    } = {},
  ) {
    const logger = createFakeLogger();
    const http = new KisHttpClient({ baseUrl: KIS_BASE_URL.MOCK, dispatcher: agent });
    const timer = new FakeTimer();
    const sockets: FakeWs[] = [];
    const factory = (url: string): WsLike => {
      const ws = new FakeWs(url);
      sockets.push(ws);
      return ws;
    };
    const client = new KisWsClient({
      env: 'MOCK',
      http,
      factory,
      logger,
      timer,
      ...(opts.maxSubs !== undefined && { maxSubscriptions: opts.maxSubs }),
      ...(opts.heartbeatMs !== undefined && { heartbeatMs: opts.heartbeatMs }),
      ...(opts.reconnectBaseMs !== undefined && { reconnectBaseMs: opts.reconnectBaseMs }),
      ...(opts.reconnectMaxMs !== undefined && { reconnectMaxMs: opts.reconnectMaxMs }),
      ...(opts.onMessage && { onMessage: opts.onMessage }),
      ...(opts.onCniNotice && { onCniNotice: opts.onCniNotice }),
    });
    return { client, logger, timer, sockets };
  }

  it('heartbeat: 주기적으로 PINGPONG 프레임 전송', async () => {
    const { client, timer, sockets } = build({ heartbeatMs: 1000 });
    const r = await client.start('APPKEY', 'APPSECRET');
    expect(r.isOk()).toBe(true);
    const first = sockets[0];
    if (!first) throw new Error('no socket');
    first.openNow();
    timer.advance(3500);
    const pings = first.sent.filter((s) => s.includes('PINGPONG'));
    expect(pings.length).toBe(3); // 1000, 2000, 3000
  });

  it('재연결: close 이벤트 후 백오프 만료 시 새 소켓 생성 + 구독 자동 복원', async () => {
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      heartbeatMs: 60_000,
    });
    await client.start('APPKEY', 'APPSECRET');
    const s1 = sockets[0];
    if (!s1) throw new Error('s1 missing');
    s1.openNow();
    client.subscribe({ tr: 'H0STCNT0', code: '005930' });
    expect(s1.sent.some((f) => f.includes('005930') && f.includes('"tr_type":"1"'))).toBe(true);

    // 원격 끊김
    s1.remoteClose(1006, 'network');
    expect(client.getPhase()).toBe('reconnect-wait');

    timer.advance(100); // 첫 백오프 = 100ms
    expect(sockets.length).toBe(2);
    const s2 = sockets[1];
    if (!s2) throw new Error('s2 missing');
    s2.openNow();
    // 재연결 후 자동 재구독 프레임
    expect(s2.sent.some((f) => f.includes('005930') && f.includes('"tr_type":"1"'))).toBe(true);
  });

  it('재연결 백오프: 연속 실패 시 지수 증가 (100 → 200 → 400 → 1000 cap)', async () => {
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      heartbeatMs: 60_000,
    });
    await client.start('APPKEY', 'APPSECRET');

    // 각 소켓 열리자마자 즉시 끊김 반복
    const expected = [100, 200, 400, 800, 1000];
    let prevIndex = 0;
    const s0 = sockets[0];
    if (!s0) throw new Error('s0');
    s0.openNow();
    s0.remoteClose();
    for (const delay of expected) {
      timer.advance(delay - 1);
      expect(sockets.length).toBe(prevIndex + 1);
      timer.advance(1);
      const next = sockets[prevIndex + 1];
      if (!next) throw new Error(`no reconnect after ${delay}ms`);
      next.openNow();
      next.remoteClose();
      prevIndex += 1;
    }
    expect(sockets.length).toBe(expected.length + 1);
  });

  it('중복 메시지 제거: 같은 (tr,code,seq) 프레임은 onMessage 한 번만 호출', async () => {
    const received: RealtimeMessage[] = [];
    const { client, sockets } = build({
      heartbeatMs: 60_000,
      onMessage: (m) => received.push(m),
    });
    await client.start('APPKEY', 'APPSECRET');
    const s = sockets[0];
    if (!s) throw new Error('no ws');
    s.openNow();

    // KIS 실시간 프레임 예시: encrypt|tr_id|count|code^seq^price...
    const frame = '0|H0STCNT0|001|005930^42^70000^200';
    s.remoteMessage(frame);
    s.remoteMessage(frame); // 중복
    s.remoteMessage('0|H0STCNT0|001|005930^43^70100^210');

    expect(received).toHaveLength(2);
    expect(received[0]?.seq).toBe(42);
    expect(received[1]?.seq).toBe(43);
  });

  it('CNI ACK의 AES 파라미터로 체결통보 payload를 복호화하고 중복 수신을 제거한다', async () => {
    const received: CniNotice[] = [];
    const { client, sockets } = build({
      heartbeatMs: 60_000,
      onCniNotice: (notice) => received.push(notice),
    });
    await client.start('APPKEY', 'APPSECRET');
    const s = sockets[0];
    if (!s) throw new Error('no ws');
    s.openNow();

    const key = '12345678901234567890123456789012';
    const iv = '1234567890123456';
    const plain = '0^1^ORD-1^x^x^x^x^x^005930^3^70100^093001^x^2';
    const encrypted = encryptAes256CbcBase64(key, iv, plain);
    expect(decryptAes256CbcBase64(key, iv, encrypted)).toBe(plain);

    s.remoteMessage(
      JSON.stringify({
        header: { tr_id: 'H0STCNI9', tr_key: 'HTS123' },
        body: { rt_cd: '0', output: { iv, key } },
      }),
    );
    s.remoteMessage(`1|H0STCNI9|001|${encrypted}`);
    s.remoteMessage(`1|H0STCNI9|001|${encrypted}`);

    expect(received).toEqual([{ tr: 'H0STCNI9', htsId: 'HTS123', seq: 1, raw: plain }]);
  });

  it('구독 상한 초과: 20을 초과하는 추가 구독은 VALIDATION 에러', async () => {
    const { client, sockets } = build({ maxSubs: 3, heartbeatMs: 60_000 });
    await client.start('APPKEY', 'APPSECRET');
    const s = sockets[0];
    if (!s) throw new Error('no ws');
    s.openNow();
    expect(client.subscribe({ tr: 'H0STCNT0', code: '000001' }).isOk()).toBe(true);
    expect(client.subscribe({ tr: 'H0STCNT0', code: '000002' }).isOk()).toBe(true);
    expect(client.subscribe({ tr: 'H0STCNT0', code: '000003' }).isOk()).toBe(true);
    const over = client.subscribe({ tr: 'H0STCNT0', code: '000004' });
    expect(over.isErr()).toBe(true);
    if (over.isErr()) expect(over.error.kind).toBe('VALIDATION');
  });

  it('unsubscribe: 열린 연결에서는 즉시 해지 프레임 전송', async () => {
    const { client, sockets } = build({ heartbeatMs: 60_000 });
    await client.start('APPKEY', 'APPSECRET');
    const s = sockets[0];
    if (!s) throw new Error('no ws');
    s.openNow();
    client.subscribe({ tr: 'H0STCNT0', code: '005930' });
    client.unsubscribe({ tr: 'H0STCNT0', code: '005930' });
    expect(s.sent.filter((f) => f.includes('"tr_type":"2"')).length).toBe(1);
    expect(client.getSubscriptions()).toHaveLength(0);
  });

  it('stop: 닫힘 이벤트로 재연결 스케줄 안 됨', async () => {
    const { client, timer, sockets } = build({ heartbeatMs: 60_000, reconnectBaseMs: 100 });
    await client.start('APPKEY', 'APPSECRET');
    const s = sockets[0];
    if (!s) throw new Error('no ws');
    s.openNow();
    client.stop();
    timer.advance(5_000);
    expect(sockets).toHaveLength(1);
    expect(client.getPhase()).toBe('closed');
  });
});
