import type { AppEnv, KisError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { EventLogger } from '../logging/event-logger';
import { KIS_PATH, KIS_WS_URL } from './endpoints';
import { makeKisError } from './errors';
import type { KisHttpClient } from './http-client';

/** 브라우저/ws 호환 최소 WebSocket 인터페이스. */
export interface WsLike {
  readonly readyState: number; // 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown; code?: number; reason?: string; error?: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown; code?: number; reason?: string; error?: unknown }) => void,
  ): void;
}

export type WsFactory = (url: string) => WsLike;

export interface Timer {
  setTimeout(cb: () => void, ms: number): { clear: () => void };
  setInterval(cb: () => void, ms: number): { clear: () => void };
  now(): number;
}

export const realTimer: Timer = {
  setTimeout(cb, ms) {
    const h = setTimeout(cb, ms);
    return { clear: () => clearTimeout(h) };
  },
  setInterval(cb, ms) {
    const h = setInterval(cb, ms);
    return { clear: () => clearInterval(h) };
  },
  now: () => Date.now(),
};

const KisApprovalResponseSchema = z.object({
  approval_key: z.string().min(1),
});

/**
 * KIS 실시간 접속용 approval_key 발급 — POST /oauth2/Approval.
 * 평상시 access_token과는 별도의 키. 요청 바디는 appkey/appsecret + secretkey 필드명 사용.
 */
export async function issueApprovalKey(
  http: KisHttpClient,
  appKey: string,
  appSecret: string,
): Promise<Result<string, KisError>> {
  const r = await http.post<unknown>(KIS_PATH.APPROVAL_KEY, {
    grant_type: 'client_credentials',
    appkey: appKey,
    secretkey: appSecret,
  });
  if (r.isErr()) return err(r.error);
  const parsed = KisApprovalResponseSchema.safeParse(r.value.body);
  if (!parsed.success) {
    return err(
      makeKisError('VALIDATION', 'approval 응답 파싱 실패', {
        cause: parsed.error.message,
      }),
    );
  }
  return ok(parsed.data.approval_key);
}

/**
 * 지원 TR 목록.
 * H0STCNT0: 국내주식 체결가 (BC 유지, RotatingQuoteFeed 위임 후 미사용)
 * H0STASP0: 국내주식 호가   (BC 유지, RotatingQuoteFeed 위임 후 미사용)
 * H0STCNI0: 국내주식 체결통보 실전 (AES-256-CBC 암호화)
 * H0STCNI9: 국내주식 체결통보 모의 (AES-256-CBC 암호화)
 */
export type RealtimeTr = 'H0STCNT0' | 'H0STASP0' | 'H0STCNI0' | 'H0STCNI9';

/** CNI 구독 ACK 에서 수신한 AES 파라미터. */
export interface CniCryptoParams {
  iv: string;
  key: string;
}

export interface SubscriptionKey {
  tr: RealtimeTr;
  code: string;
}

function subscriptionId(sub: SubscriptionKey): string {
  return `${sub.tr}:${sub.code}`;
}

export interface RealtimeMessage {
  tr: string;
  code: string;
  seq: number;
  raw: string;
}

/** 체결통보 파싱 결과 — AES 복호화 후 pipe-delimited 레코드. */
export interface CniNotice {
  tr: 'H0STCNI0' | 'H0STCNI9';
  /** 고객 HTS ID (tr_key). */
  htsId: string;
  seq: number;
  /** 복호화된 원시 레코드 문자열 (^-delimited). */
  raw: string;
}

export interface KisWsClientOptions {
  env: AppEnv;
  http: KisHttpClient;
  factory: WsFactory;
  logger: EventLogger;
  timer?: Timer;
  /** 최대 구독 종목 수 (tr별 합산). KIS 기본 20. */
  maxSubscriptions?: number;
  /** 하트비트 주기 ms (기본 30s). */
  heartbeatMs?: number;
  /** 초기 백오프 ms (기본 1000). */
  reconnectBaseMs?: number;
  /** 최대 백오프 ms (기본 30s). */
  reconnectMaxMs?: number;
  onMessage?: (msg: RealtimeMessage) => void;
  /** 체결통보 수신 시 콜백. AES 복호화 성공한 레코드만 전달. */
  onCniNotice?: (notice: CniNotice) => void;
}

type WsPhase = 'idle' | 'connecting' | 'open' | 'reconnect-wait' | 'closed';

interface ConnectedState {
  ws: WsLike;
  heartbeatHandle: { clear: () => void } | null;
}

/**
 * KIS 실시간 WebSocket 클라이언트 — 매직스플릿 단일 계정 전용.
 *
 * 보장:
 * - 하트비트 PINGPONG 주기 발송
 * - 끊김 시 지수백오프(1s→2s→4s→...→max) 재연결, 구독은 자동 복원
 * - (tr_id, code, seq) 튜플 중복 메시지 스킵
 * - 총 구독 종목 수 제한 (기본 20)
 *
 * 비보장 (호출측 책임):
 * - approval_key 만료 시 재발급 (호출측이 reconnectNow를 통해 유도)
 * - credentials 관리
 */
export class KisWsClient {
  private readonly env: AppEnv;
  private readonly http: KisHttpClient;
  private readonly factory: WsFactory;
  private readonly logger: EventLogger;
  private readonly timer: Timer;
  private readonly maxSubs: number;
  private readonly heartbeatMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly onMessage?: (msg: RealtimeMessage) => void;

  private approvalKey: string | null = null;
  private readonly subscriptions = new Map<string, SubscriptionKey>();
  private phase: WsPhase = 'idle';
  private current: ConnectedState | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: { clear: () => void } | null = null;
  private seenKeys = new Set<string>();
  private readonly seenLimit = 2048;
  private seenOrder: string[] = [];

  constructor(opts: KisWsClientOptions) {
    this.env = opts.env;
    this.http = opts.http;
    this.factory = opts.factory;
    this.logger = opts.logger;
    this.timer = opts.timer ?? realTimer;
    this.maxSubs = opts.maxSubscriptions ?? 20;
    this.heartbeatMs = opts.heartbeatMs ?? 30_000;
    this.reconnectBaseMs = opts.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 30_000;
    if (opts.onMessage) this.onMessage = opts.onMessage;
  }

  getPhase(): WsPhase {
    return this.phase;
  }

  getSubscriptions(): SubscriptionKey[] {
    return Array.from(this.subscriptions.values());
  }

  async start(appKey: string, appSecret: string): Promise<Result<void, KisError>> {
    const ak = await issueApprovalKey(this.http, appKey, appSecret);
    if (ak.isErr()) return err(ak.error);
    this.approvalKey = ak.value;
    this.openSocket();
    return ok(undefined);
  }

  stop(): void {
    this.phase = 'closed';
    if (this.reconnectTimer) {
      this.reconnectTimer.clear();
      this.reconnectTimer = null;
    }
    if (this.current) {
      if (this.current.heartbeatHandle) this.current.heartbeatHandle.clear();
      try {
        this.current.ws.close(1000, 'client stop');
      } catch {
        // swallow
      }
      this.current = null;
    }
  }

  subscribe(sub: SubscriptionKey): Result<void, KisError> {
    const id = subscriptionId(sub);
    if (this.subscriptions.has(id)) return ok(undefined);
    if (this.subscriptions.size >= this.maxSubs) {
      return err(
        makeKisError('VALIDATION', `구독 종목 수 상한(${this.maxSubs}) 초과`, {
          cause: { current: this.subscriptions.size, max: this.maxSubs },
        }),
      );
    }
    this.subscriptions.set(id, sub);
    if (this.current && this.current.ws.readyState === 1) {
      this.sendControl(this.current.ws, sub, '1');
    }
    return ok(undefined);
  }

  unsubscribe(sub: SubscriptionKey): void {
    const id = subscriptionId(sub);
    if (!this.subscriptions.delete(id)) return;
    if (this.current && this.current.ws.readyState === 1) {
      this.sendControl(this.current.ws, sub, '2');
    }
  }

  private openSocket(): void {
    if (!this.approvalKey) {
      this.logger.log({
        level: 'ERROR',
        category: 'WS',
        message: 'ws.open.no_approval_key',
      });
      return;
    }
    this.phase = 'connecting';
    const url = KIS_WS_URL[this.env];
    const ws = this.factory(url);

    const onOpen = (): void => {
      this.phase = 'open';
      this.reconnectAttempt = 0;
      const heartbeat = this.timer.setInterval(() => {
        try {
          ws.send(JSON.stringify({ header: { tr_id: 'PINGPONG', tr_type: '1' } }));
        } catch (cause) {
          this.logger.log({
            level: 'WARN',
            category: 'WS',
            message: 'ws.heartbeat.send_failed',
            payload: { cause: String(cause) },
          });
        }
      }, this.heartbeatMs);
      this.current = { ws, heartbeatHandle: heartbeat };
      this.logger.log({ level: 'INFO', category: 'WS', message: 'ws.open' });
      for (const sub of this.subscriptions.values()) {
        this.sendControl(ws, sub, '1');
      }
    };

    const onMessage = (event: { data?: unknown }): void => {
      if (typeof event.data !== 'string') return;
      this.handleFrame(event.data);
    };

    const onClose = (event: { code?: number; reason?: string }): void => {
      this.logger.log({
        level: 'WARN',
        category: 'WS',
        message: 'ws.close',
        payload: { code: event.code ?? null, reason: event.reason ?? null },
      });
      if (this.current?.heartbeatHandle) this.current.heartbeatHandle.clear();
      this.current = null;
      if (this.phase === 'closed') return;
      this.scheduleReconnect();
    };

    const onError = (event: { error?: unknown }): void => {
      this.logger.log({
        level: 'ERROR',
        category: 'WS',
        message: 'ws.error',
        payload: { cause: event.error ? String(event.error) : null },
      });
    };

    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
  }

  private scheduleReconnect(): void {
    if (this.phase === 'closed') return;
    this.phase = 'reconnect-wait';
    const attempt = this.reconnectAttempt;
    const delay = Math.min(this.reconnectBaseMs * 2 ** attempt, this.reconnectMaxMs);
    this.reconnectAttempt += 1;
    this.logger.log({
      level: 'INFO',
      category: 'WS',
      message: 'ws.reconnect.scheduled',
      payload: { attempt, delayMs: delay },
    });
    this.reconnectTimer = this.timer.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private sendControl(ws: WsLike, sub: SubscriptionKey, type: '1' | '2'): void {
    if (!this.approvalKey) return;
    const frame = {
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: type, // 1=subscribe, 2=unsubscribe
        'content-type': 'utf-8',
      },
      body: { input: { tr_id: sub.tr, tr_key: sub.code } },
    };
    try {
      ws.send(JSON.stringify(frame));
    } catch (cause) {
      this.logger.log({
        level: 'WARN',
        category: 'WS',
        message: 'ws.control.send_failed',
        payload: { tr: sub.tr, code: sub.code, type, cause: String(cause) },
      });
    }
  }

  private handleFrame(raw: string): void {
    // 제어 응답 프레임은 보통 JSON. 체결/호가 실시간 프레임은 pipe-delimited 문자열.
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { header?: { tr_id?: string } };
        if (parsed.header?.tr_id === 'PINGPONG') {
          return; // heartbeat ack — 로깅 생략
        }
      } catch {
        // fall through: treat as non-JSON frame
      }
      return;
    }
    const parts = raw.split('|');
    if (parts.length < 4) return;
    const [, trId, , payload] = parts;
    if (!trId || !payload) return;
    const firstRecord = payload.split('^');
    const code = firstRecord[0] ?? '';
    const seqRaw = firstRecord[1] ?? '';
    const seq = Number(seqRaw);
    if (!Number.isFinite(seq) || !code) return;
    const dedupKey = `${trId}:${code}:${seq}`;
    if (this.seenKeys.has(dedupKey)) return;
    this.seenKeys.add(dedupKey);
    this.seenOrder.push(dedupKey);
    if (this.seenOrder.length > this.seenLimit) {
      const evicted = this.seenOrder.shift();
      if (evicted) this.seenKeys.delete(evicted);
    }
    if (this.onMessage) {
      this.onMessage({ tr: trId, code, seq, raw });
    }
  }
}
