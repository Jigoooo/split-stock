import type { AppEnv, CniNotice, KisError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { EventLogger } from '../logging/event-logger';
import { KIS_WS_URL } from './endpoints';
import { makeKisError } from './errors';
import type { KisHttpClient } from './http-client';
import { issueApprovalKey } from './ws-approval';
import { parseKisControlFrame } from './ws-control-frame';
import { decryptAes256CbcBase64 } from './ws-crypto';
import { WsDeduper } from './ws-dedup';
import { parseKisRealtimeFrame } from './ws-realtime-frame';
import { reconnectDelayMs } from './ws-reconnect';
import { buildSubscriptionControlFrame, subscriptionId } from './ws-subscriptions';

export { issueApprovalKey } from './ws-approval';
export { decryptAes256CbcBase64 } from './ws-crypto';
// renderer 가 동일 타입을 참조해야 하므로 shared/contracts 에 단일 정의 — 본 모듈에서도 재export.
export type { CniNotice };

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

/**
 * 지원 TR 목록.
 *
 * H0STCNT0: 국내주식 체결가 — WS 세션당 호가와 합산 20종목 한도 (향후 60 확장 예정).
 *   WsPoolManager 가 우선순위 desc 로 capacity 안에 든 종목을 WS 로 라우팅하고
 *   초과분은 RotatingQuoteFeed(REST 15rps) 로 위임한다.
 * H0STASP0: 국내주식 호가 (10단 매도/매수 + 잔량 + 예상체결가).
 *   H0STCNT0 와 슬롯 합산 — 같은 종목 둘 다 활성화 시 슬롯 2개 소비.
 * H0STCNI0: 국내주식 체결통보 실전 (AES-256-CBC 암호화, tr_key = HTS ID)
 * H0STCNI9: 국내주식 체결통보 모의 (AES-256-CBC 암호화, tr_key = HTS ID)
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

export interface RealtimeMessage {
  tr: string;
  code: string;
  seq: number;
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
 * KIS 실시간 WebSocket 클라이언트 — 현재 단일 계정 전용.
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
 *
 * --- 다계좌 확장 정책 (후속 마일스톤용 설계 메모) ---
 * KIS WS 체결통보(H0STCNI0/9)는 tr_key=HTS_ID(계좌 식별자)로 구독하며,
 * 하나의 WS 연결에는 하나의 approval_key(= 하나의 appKey/appSecret 쌍)만 사용 가능.
 * 따라서 다계좌 환경에서는 계좌별로 독립된 KisWsClient 인스턴스가 필요하다.
 *
 * 향후 다계좌 지원 시:
 * - RealtimeService를 per-accountId로 인스턴스화 (현재는 per-env 단일 인스턴스).
 * - 각 계좌의 (appKey, appSecret) 쌍으로 별도 approval_key 발급 후 WS 연결.
 * - 체결통보 수신 시 notice.htsId로 accountId를 resolve하여 해당 계좌 BalanceSync 트리거.
 * - KIS 스펙상 계좌당 WS 동시 접속 수 제한(1개) 준수 필요.
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
  private readonly onCniNotice?: (notice: CniNotice) => void;

  private approvalKey: string | null = null;
  private readonly subscriptions = new Map<string, SubscriptionKey>();
  private readonly cniCryptoByTr = new Map<string, CniCryptoParams & { htsId: string }>();
  private phase: WsPhase = 'idle';
  private current: ConnectedState | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: { clear: () => void } | null = null;
  private reconnectStabilityTimer: { clear: () => void } | null = null;
  private readonly deduper = new WsDeduper(2048);
  private cniSeq = 0;

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
    if (opts.onCniNotice) this.onCniNotice = opts.onCniNotice;
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
    this.clearReconnectStabilityTimer();
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
      this.clearReconnectStabilityTimer();
      this.reconnectStabilityTimer = this.timer.setTimeout(() => {
        this.reconnectStabilityTimer = null;
        this.reconnectAttempt = 0;
      }, this.reconnectBaseMs);
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
      this.clearReconnectStabilityTimer();
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

  private clearReconnectStabilityTimer(): void {
    if (!this.reconnectStabilityTimer) return;
    this.reconnectStabilityTimer.clear();
    this.reconnectStabilityTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.phase === 'closed') return;
    this.phase = 'reconnect-wait';
    const attempt = this.reconnectAttempt;
    const delay = reconnectDelayMs(this.reconnectBaseMs, this.reconnectMaxMs, attempt);
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
    const frame = buildSubscriptionControlFrame(this.approvalKey, sub, type);
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
      this.handleControlFrame(raw);
      return;
    }
    const parsed = parseKisRealtimeFrame(raw);
    if (!parsed) return;
    if (parsed.kind === 'cni') {
      this.handleCniPayload(parsed.tr, parsed.payload, parsed.encrypted);
      return;
    }
    const dedupKey = `${parsed.tr}:${parsed.code}:${parsed.seq}`;
    if (!this.deduper.remember(dedupKey)) return;
    if (this.onMessage) {
      this.onMessage({ tr: parsed.tr, code: parsed.code, seq: parsed.seq, raw });
    }
  }

  private handleControlFrame(raw: string): void {
    const parsed = parseKisControlFrame(raw);
    if (!parsed.ok) {
      this.logger.log({
        level: 'WARN',
        category: 'WS',
        message: 'ws.control.parse_failed',
        payload: {
          cause: parsed.cause instanceof Error ? parsed.cause.message : String(parsed.cause),
        },
      });
      return;
    }
    if (parsed.frame.kind === 'pingpong' || parsed.frame.kind === 'ignored') return;
    this.cniCryptoByTr.set(parsed.frame.tr, {
      iv: parsed.frame.iv,
      key: parsed.frame.key,
      htsId: parsed.frame.htsId,
    });
  }

  private handleCniPayload(tr: 'H0STCNI0' | 'H0STCNI9', payload: string, encrypted: boolean): void {
    const crypto = this.cniCryptoByTr.get(tr);
    let decrypted = payload;
    if (encrypted || crypto) {
      if (!crypto) {
        this.logger.log({
          level: 'WARN',
          category: 'WS',
          message: 'ws.cni.crypto_missing',
          payload: { tr },
        });
        return;
      }
      try {
        decrypted = decryptAes256CbcBase64(crypto.key, crypto.iv, payload);
      } catch (cause) {
        this.logger.log({
          level: 'WARN',
          category: 'WS',
          message: 'ws.cni.decrypt_failed',
          payload: { tr, cause: cause instanceof Error ? cause.message : String(cause) },
        });
        return;
      }
    }

    const dedupKey = `${tr}:${decrypted}`;
    if (!this.deduper.remember(dedupKey)) return;

    this.cniSeq += 1;
    this.onCniNotice?.({
      tr,
      htsId: crypto?.htsId ?? '',
      seq: this.cniSeq,
      raw: decrypted,
    });
  }
}
