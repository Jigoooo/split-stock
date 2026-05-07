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
  type WsPhase,
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
      maxReconnectAttempts?: number;
      onMessage?: (msg: RealtimeMessage) => void;
      onCniNotice?: (notice: CniNotice) => void;
      onReconnectExhausted?: () => void;
      onPhaseChange?: (phase: WsPhase) => void;
      onFallbackStart?: () => void;
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
      ...(opts.maxReconnectAttempts !== undefined && {
        maxReconnectAttempts: opts.maxReconnectAttempts,
      }),
      ...(opts.onMessage && { onMessage: opts.onMessage }),
      ...(opts.onCniNotice && { onCniNotice: opts.onCniNotice }),
      ...(opts.onReconnectExhausted && { onReconnectExhausted: opts.onReconnectExhausted }),
      ...(opts.onPhaseChange && { onPhaseChange: opts.onPhaseChange }),
      ...(opts.onFallbackStart && { onFallbackStart: opts.onFallbackStart }),
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

  it('maxReconnectAttempts: 한도 초과 시 reconnect-exhausted 로 전환, onReconnectExhausted 콜백 1회 호출', async () => {
    let exhaustedCalls = 0;
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      heartbeatMs: 60_000,
      maxReconnectAttempts: 2,
      onReconnectExhausted: () => {
        exhaustedCalls += 1;
      },
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');
    s0.openNow();

    // 1차 끊김 → attempt=0 → delay=100ms → socket#2
    s0.remoteClose();
    expect(client.getPhase()).toBe('reconnect-wait');
    timer.advance(100);
    expect(sockets.length).toBe(2);

    // socket#2 open + close → attempt=1 → delay=200ms → socket#3
    const s1 = sockets[1];
    if (!s1) throw new Error('s1 missing');
    s1.openNow();
    s1.remoteClose();
    expect(client.getPhase()).toBe('reconnect-wait');
    timer.advance(200);
    expect(sockets.length).toBe(3);

    // socket#3 open + close → attempt=2 >= maxReconnectAttempts(2) → exhausted
    const s2 = sockets[2];
    if (!s2) throw new Error('s2 missing');
    s2.openNow();
    s2.remoteClose();
    expect(client.getPhase()).toBe('reconnect-exhausted');
    expect(exhaustedCalls).toBe(1);

    // 추가 타이머 진행해도 소켓 미생성
    timer.advance(5_000);
    expect(sockets.length).toBe(3);
  });

  it('reconnectNow: reconnect-exhausted 상태에서 즉시 재연결, attempt 카운터 초기화', async () => {
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      heartbeatMs: 60_000,
      maxReconnectAttempts: 1,
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0');
    s0.openNow();
    s0.remoteClose();

    // attempt=0 → retry → socket#2
    timer.advance(100);
    const s1 = sockets[1];
    if (!s1) throw new Error('s1');
    s1.openNow();
    s1.remoteClose();
    // attempt=1 >= maxReconnectAttempts(1) → exhausted
    expect(client.getPhase()).toBe('reconnect-exhausted');

    // reconnectNow → 새 소켓 즉시 생성, phase=connecting
    client.reconnectNow();
    expect(sockets.length).toBe(3);
    expect(client.getPhase()).toBe('connecting');

    // 연결 성공 후 open 상태 정상 전환
    const s2 = sockets[2];
    if (!s2) throw new Error('s2');
    s2.openNow();
    expect(client.getPhase()).toBe('open');
  });

  it('maxReconnectAttempts=0: 첫 close 즉시 exhausted (재시도 없음)', async () => {
    let exhaustedCalls = 0;
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      heartbeatMs: 60_000,
      maxReconnectAttempts: 0,
      onReconnectExhausted: () => {
        exhaustedCalls += 1;
      },
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0');
    s0.openNow();
    s0.remoteClose();

    expect(client.getPhase()).toBe('reconnect-exhausted');
    expect(exhaustedCalls).toBe(1);
    // 타이머 진행해도 소켓 미생성
    timer.advance(5_000);
    expect(sockets.length).toBe(1);
  });

  it('BC: maxReconnectAttempts 미설정 시 무한 재연결 (기존 동작 유지)', async () => {
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 200,
      heartbeatMs: 60_000,
      // maxReconnectAttempts 미설정
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0');
    s0.openNow();
    s0.remoteClose();

    // 6번 연속 reconnect 후에도 exhausted 아님
    for (let i = 0; i < 6; i++) {
      timer.advance(200);
      const s = sockets[i + 1];
      if (!s) throw new Error(`socket ${String(i + 1)} missing`);
      s.openNow();
      s.remoteClose();
    }
    expect(client.getPhase()).not.toBe('reconnect-exhausted');
    expect(sockets.length).toBe(7);
  });

  // ─── D2: onPhaseChange ───────────────────────────────────────────────────

  it('onPhaseChange: WS 전환(open → reconnect-wait → open) 시 콜백 호출', async () => {
    const phases: WsPhase[] = [];
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      heartbeatMs: 60_000,
      onPhaseChange: (phase) => phases.push(phase),
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');

    // connecting → open
    s0.openNow();
    await Promise.resolve(); // queueMicrotask 콜백 실행
    expect(phases).toContain('open');

    // open → reconnect-wait
    s0.remoteClose(1006, 'network');
    await Promise.resolve();
    expect(phases).toContain('reconnect-wait');

    // reconnect-wait → connecting → open (2번째)
    timer.advance(100);
    const s1 = sockets[1];
    if (!s1) throw new Error('s1 missing');
    s1.openNow();
    await Promise.resolve();
    expect(phases.filter((p) => p === 'open').length).toBeGreaterThanOrEqual(2);
  });

  // ─── D2a: isReconnecting + onFallbackStart ────────────────────────────────

  it('isReconnecting: 초기 false, open 후에도 false', async () => {
    const { client, sockets } = build({ heartbeatMs: 60_000 });
    await client.start('APPKEY', 'APPSECRET');
    expect(client.getIsReconnecting()).toBe(false);
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');
    s0.openNow();
    expect(client.getIsReconnecting()).toBe(false);
  });

  it('isReconnecting: WS 끊김 시 true → 재연결 성공 시 false', async () => {
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      heartbeatMs: 60_000,
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');
    s0.openNow();
    expect(client.getIsReconnecting()).toBe(false);

    s0.remoteClose(1006, 'lost');
    expect(client.getIsReconnecting()).toBe(true);

    timer.advance(100);
    const s1 = sockets[1];
    if (!s1) throw new Error('s1 missing');
    s1.openNow();
    expect(client.getIsReconnecting()).toBe(false);
  });

  it('isReconnecting: 재연결 대기 중 재시도 실패 시 true 유지', async () => {
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 200,
      heartbeatMs: 60_000,
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');
    s0.openNow();
    s0.remoteClose(1006, 'lost');
    expect(client.getIsReconnecting()).toBe(true);

    // 재연결 시도 1 — open 없이 바로 close
    timer.advance(100);
    const s1 = sockets[1];
    if (!s1) throw new Error('s1 missing');
    s1.remoteClose();
    expect(client.getIsReconnecting()).toBe(true); // 여전히 reconnecting

    // 재연결 시도 2 — 성공
    timer.advance(200);
    const s2 = sockets[2];
    if (!s2) throw new Error('s2 missing');
    s2.openNow();
    expect(client.getIsReconnecting()).toBe(false);
  });

  it('isReconnecting: stop() 후 false', async () => {
    const { client, sockets } = build({ heartbeatMs: 60_000, reconnectBaseMs: 100 });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');
    s0.openNow();
    s0.remoteClose(1006, 'lost');
    expect(client.getIsReconnecting()).toBe(true);
    client.stop();
    expect(client.getIsReconnecting()).toBe(false);
  });

  it('isReconnecting: reconnect-exhausted 전환 시 false', async () => {
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      heartbeatMs: 60_000,
      maxReconnectAttempts: 1,
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');
    s0.openNow();
    s0.remoteClose();
    expect(client.getIsReconnecting()).toBe(true);

    timer.advance(100);
    const s1 = sockets[1];
    if (!s1) throw new Error('s1 missing');
    s1.openNow();
    s1.remoteClose();
    expect(client.getPhase()).toBe('reconnect-exhausted');
    expect(client.getIsReconnecting()).toBe(false);
  });

  it('onFallbackStart: WS 끊김 시 1회 호출, 동일 세션 재시도 중 추가 호출 없음', async () => {
    const starts: number[] = [];
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 200,
      heartbeatMs: 60_000,
      onFallbackStart: () => starts.push(starts.length + 1),
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');
    s0.openNow();
    expect(starts).toHaveLength(0); // 정상 연결 중에는 호출 없음

    s0.remoteClose(1006, 'lost');
    await Promise.resolve(); // queueMicrotask 플러시
    expect(starts).toHaveLength(1); // 첫 끊김에 정확히 1회

    // 재연결 시도 실패 (open 없이 바로 close) → 추가 호출 없어야 함
    timer.advance(100);
    const s1 = sockets[1];
    if (!s1) throw new Error('s1 missing');
    s1.remoteClose();
    await Promise.resolve();
    expect(starts).toHaveLength(1);

    // 추가 실패 → 여전히 1회
    timer.advance(200);
    const s2 = sockets[2];
    if (!s2) throw new Error('s2 missing');
    s2.remoteClose();
    await Promise.resolve();
    expect(starts).toHaveLength(1);
  });

  it('onFallbackStart: 재연결 성공 후 재끊김 시 다시 1회 호출', async () => {
    const starts: number[] = [];
    const { client, timer, sockets } = build({
      reconnectBaseMs: 100,
      reconnectMaxMs: 200,
      heartbeatMs: 60_000,
      onFallbackStart: () => starts.push(starts.length + 1),
    });
    await client.start('APPKEY', 'APPSECRET');
    const s0 = sockets[0];
    if (!s0) throw new Error('s0 missing');
    s0.openNow();

    // 첫 번째 끊김
    s0.remoteClose(1006, 'lost');
    await Promise.resolve();
    expect(starts).toHaveLength(1);

    // 재연결 성공 → isReconnecting false
    timer.advance(100);
    const s1 = sockets[1];
    if (!s1) throw new Error('s1 missing');
    s1.openNow();
    expect(client.getIsReconnecting()).toBe(false);
    expect(starts).toHaveLength(1); // 성공해도 추가 호출 없음

    // 두 번째 끊김 → 새 disconnect 세션이므로 다시 호출
    s1.remoteClose(1006, 'lost2');
    await Promise.resolve();
    expect(starts).toHaveLength(2);
  });

  // ─── D2c: 재연결 시 heartbeat interval 정리 / 구독 중복 방지 ────────────

  describe('D2c: 재연결 시 heartbeat interval 정리', () => {
    it('재연결 후 이전 heartbeat interval 이 정리되어 ping 이 누적되지 않는다', async () => {
      const { client, timer, sockets } = build({
        reconnectBaseMs: 100,
        reconnectMaxMs: 1000,
        heartbeatMs: 1000,
      });
      await client.start('APPKEY', 'APPSECRET');
      const s0 = sockets[0];
      if (!s0) throw new Error('s0 missing');
      s0.openNow(); // heartbeat1 등록 (next=t+1000ms)

      // 50ms 후 끊김 — heartbeat1 은 1000ms 미도달로 아직 미발화, onClose 에서 cleared
      timer.advance(50);
      s0.remoteClose(1006, 'lost');
      expect(s0.sent.filter((f) => f.includes('PINGPONG'))).toHaveLength(0);

      // 재연결 (백오프 100ms) → s1 생성
      timer.advance(100);
      const s1 = sockets[1];
      if (!s1) throw new Error('s1 missing');
      s1.openNow(); // heartbeat2 등록

      // 1000ms 경과 → heartbeat2 1회 발화, s0 에는 추가 ping 없음
      timer.advance(1000);
      expect(s0.sent.filter((f) => f.includes('PINGPONG'))).toHaveLength(0);
      expect(s1.sent.filter((f) => f.includes('PINGPONG'))).toHaveLength(1);
    });

    it('2회 재연결 사이클에서 각 소켓은 자신의 heartbeat 만 수신한다', async () => {
      const { client, timer, sockets } = build({
        reconnectBaseMs: 100,
        reconnectMaxMs: 1000,
        heartbeatMs: 1000,
      });
      await client.start('APPKEY', 'APPSECRET');
      const s0 = sockets[0];
      if (!s0) throw new Error('s0');
      s0.openNow();

      // 1차 끊김 (50ms — heartbeat 미발화, stability timer 미발화)
      timer.advance(50); // t=50
      s0.remoteClose(1006, 'lost1'); // heartbeat1 cleared, attempt=0→delay=100ms

      timer.advance(100); // t=150 → reconnect → s1 생성
      const s1 = sockets[1];
      if (!s1) throw new Error('s1');
      s1.openNow(); // heartbeat2 next=1150

      // 2차 끊김 (50ms — heartbeat2 미발화)
      timer.advance(50); // t=200
      s1.remoteClose(1006, 'lost2'); // heartbeat2 cleared, attempt=1→delay=200ms

      timer.advance(200); // t=400 → reconnect → s2 생성
      const s2 = sockets[2];
      if (!s2) throw new Error('s2');
      s2.openNow(); // heartbeat3 next=1400

      // 3000ms 진행 → s2 heartbeat3 가 1400/2400/3400 에 발화 (3회)
      timer.advance(3000); // t=3400

      expect(s0.sent.filter((f) => f.includes('PINGPONG'))).toHaveLength(0);
      expect(s1.sent.filter((f) => f.includes('PINGPONG'))).toHaveLength(0);
      expect(s2.sent.filter((f) => f.includes('PINGPONG'))).toHaveLength(3);
    });
  });

  describe('D2c: 재연결 시 구독 중복 방지', () => {
    it('2회 재연결 후 동일 구독 resubscribe 는 각 소켓당 정확히 1회씩만 전송된다', async () => {
      const { client, timer, sockets } = build({
        reconnectBaseMs: 100,
        reconnectMaxMs: 1000,
        heartbeatMs: 60_000,
      });
      await client.start('APPKEY', 'APPSECRET');
      const s0 = sockets[0];
      if (!s0) throw new Error('s0');
      s0.openNow();

      client.subscribe({ tr: 'H0STCNT0', code: '005930' });
      client.subscribe({ tr: 'H0STASP0', code: '005930' });

      // 1차 재연결
      s0.remoteClose(1006, 'lost1'); // stability timer cleared, attempt=0→delay=100ms
      timer.advance(100);
      const s1 = sockets[1];
      if (!s1) throw new Error('s1');
      s1.openNow();

      // 2차 재연결
      s1.remoteClose(1006, 'lost2'); // stability timer cleared, attempt=1→delay=200ms
      timer.advance(200);
      const s2 = sockets[2];
      if (!s2) throw new Error('s2');
      s2.openNow();

      // 구독 목록 중복 없음
      expect(client.getSubscriptions()).toHaveLength(2);

      // 각 재연결 소켓마다 정확히 2개의 subscribe(tr_type=1) 프레임
      const subFrameCount = (sent: string[]): number =>
        sent.filter((f) => f.includes('"tr_type":"1"')).length;
      expect(subFrameCount(s1.sent)).toBe(2);
      expect(subFrameCount(s2.sent)).toBe(2);
    });

    it('3회 재연결 사이클 후에도 getSubscriptions 는 중복 없는 원본 목록 유지', async () => {
      const { client, timer, sockets } = build({
        reconnectBaseMs: 100,
        reconnectMaxMs: 1000,
        heartbeatMs: 60_000,
      });
      await client.start('APPKEY', 'APPSECRET');
      const s0 = sockets[0];
      if (!s0) throw new Error('s0');
      s0.openNow();

      client.subscribe({ tr: 'H0STCNT0', code: '005930' });
      client.subscribe({ tr: 'H0STCNT0', code: '035420' });
      client.subscribe({ tr: 'H0STCNT0', code: '035720' });
      expect(client.getSubscriptions()).toHaveLength(3);

      // 3회 재연결 사이클: 각 소켓 즉시 close (stability timer 발화 전)
      // attempt 0→100ms, 1→200ms, 2→400ms (stability timer 미발화로 attempt 리셋 없음)
      const backoffDelays = [100, 200, 400] as const;
      for (const delay of backoffDelays) {
        const prev = sockets[sockets.length - 1];
        if (!prev) throw new Error('prev socket missing');
        prev.remoteClose(1006, 'lost');
        timer.advance(delay);
        const next = sockets[sockets.length - 1];
        if (!next || next === prev) throw new Error('new socket not created');
        next.openNow();
      }

      // 3회 재연결 후에도 구독 수 3개 유지 (중복 없음)
      expect(client.getSubscriptions()).toHaveLength(3);
    });
  });
});
