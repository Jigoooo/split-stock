import type { AppEnv } from '@shared/contracts';
import type { Timer, WsFactory, WsLike } from '../core/types';
import { realTimer } from '../core/types';
import { KIWOOM_WS_URL } from './metadata/endpoints';

/**
 * Kiwoom WebSocket 메시지 — JSON 프로토콜.
 * 검증: KiwoomRestApi.Net `KiwoomWebSocketSendMessage` + 공식 가이드.
 */
export interface KiwoomWsLoginMessage {
  trnm: 'LOGIN';
  token: string;
}

export interface KiwoomWsSubscribeMessage {
  trnm: 'REG' | 'REMOVE';
  grp_no: string;
  refresh: string;
  data: Array<{
    item: string[];
    type: string[];
  }>;
}

export interface KiwoomWsRealMessage {
  trnm: 'REAL';
  data: Array<{
    type: string;
    name?: string;
    item: string;
    values?: Record<string, string>;
  }>;
}

export type KiwoomWsIncoming =
  | KiwoomWsRealMessage
  | { trnm: string; return_code?: number; return_msg?: string };

export interface KiwoomSocketClientDeps {
  env: AppEnv;
  /** 토큰을 lazy 로 얻는 getter — adapter 가 ensureSession 으로 보장. */
  getToken: () => string | null;
  factory: WsFactory;
  timer?: Timer;
  /** 재연결 backoff base ms. 기본 1000. */
  reconnectBaseMs?: number;
}

type ConnectionPhase = 'idle' | 'connecting' | 'open' | 'reconnect-wait' | 'closed';

/**
 * Kiwoom WebSocket 클라이언트.
 *
 * - connect(): WS open + LOGIN 메시지 → 서버 응답 받으면 'open'
 * - subscribe(items, types, groupId): REG 메시지 발송
 * - unsubscribe(items, types, groupId): REMOVE 메시지 발송
 * - on('real', handler): REAL 메시지 수신 시 handler 호출
 * - 재연결: open 후 close 발생하면 backoff 후 자동 재연결
 *
 * NOTE: 본 클라이언트는 lifecycle 만 다룬다. 도메인 변환(REAL → RealtimeEvent)은
 * realtime-adapter 책임. Stage 6.5 라이브 검증 시 type 별 values 키 매핑 보정.
 */
export class KiwoomSocketClient {
  private ws: WsLike | null = null;
  private phase: ConnectionPhase = 'idle';
  private readonly timer: Timer;
  private readonly reconnectBaseMs: number;
  private reconnectAttempt = 0;
  private reconnectHandle: { clear: () => void } | null = null;
  private readonly handlers = new Set<(msg: KiwoomWsRealMessage) => void>();
  /** 활성 구독 — 재연결 시 자동 재구독. key = `${groupId}:${item}:${type}`. */
  private readonly activeSubscriptions = new Map<
    string,
    { groupId: string; item: string; type: string }
  >();

  constructor(private readonly deps: KiwoomSocketClientDeps) {
    this.timer = deps.timer ?? realTimer;
    this.reconnectBaseMs = deps.reconnectBaseMs ?? 1000;
  }

  getPhase(): ConnectionPhase {
    return this.phase;
  }

  getSubscriptionCount(): number {
    return this.activeSubscriptions.size;
  }

  async connect(): Promise<void> {
    if (this.phase === 'open' || this.phase === 'connecting') return;
    const token = this.deps.getToken();
    if (!token) throw new Error('Kiwoom WS connect: token missing');
    this.phase = 'connecting';
    const url = KIWOOM_WS_URL[this.deps.env];
    const ws = this.deps.factory(url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.send({ trnm: 'LOGIN', token });
    });
    ws.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') this.handleMessage(data);
      else if (data instanceof Buffer) this.handleMessage(data.toString('utf8'));
      else if (data instanceof ArrayBuffer) this.handleMessage(Buffer.from(data).toString('utf8'));
    });
    ws.addEventListener('close', () => {
      this.handleClose();
    });
    ws.addEventListener('error', () => {
      this.handleClose();
    });
  }

  disconnect(): void {
    if (this.reconnectHandle) {
      this.reconnectHandle.clear();
      this.reconnectHandle = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // 무시
      }
      this.ws = null;
    }
    this.phase = 'closed';
    this.activeSubscriptions.clear();
  }

  subscribe(item: string, type: string, groupId = '1'): void {
    const key = `${groupId}:${item}:${type}`;
    this.activeSubscriptions.set(key, { groupId, item, type });
    if (this.phase !== 'open') return; // open 되면 자동 재구독
    this.send({
      trnm: 'REG',
      grp_no: groupId,
      refresh: '1',
      data: [{ item: [item], type: [type] }],
    });
  }

  unsubscribe(item: string, type: string, groupId = '1'): void {
    const key = `${groupId}:${item}:${type}`;
    this.activeSubscriptions.delete(key);
    if (this.phase !== 'open' || !this.ws) return;
    this.send({
      trnm: 'REMOVE',
      grp_no: groupId,
      refresh: '0',
      data: [{ item: [item], type: [type] }],
    });
  }

  onReal(handler: (msg: KiwoomWsRealMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private send(msg: KiwoomWsLoginMessage | KiwoomWsSubscribeMessage): void {
    if (!this.ws) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      // 전송 실패 — handleClose 가 reconnect 처리
    }
  }

  private handleMessage(text: string): void {
    let msg: KiwoomWsIncoming | null = null;
    try {
      msg = JSON.parse(text) as KiwoomWsIncoming;
    } catch {
      return;
    }
    if (!msg) return;
    if (msg.trnm === 'LOGIN') {
      const loginMsg = msg as { trnm: string; return_code?: number };
      if (loginMsg.return_code === 0) {
        this.phase = 'open';
        this.reconnectAttempt = 0;
        // 활성 구독 재발송
        for (const sub of this.activeSubscriptions.values()) {
          this.send({
            trnm: 'REG',
            grp_no: sub.groupId,
            refresh: '1',
            data: [{ item: [sub.item], type: [sub.type] }],
          });
        }
      }
      return;
    }
    if (msg.trnm === 'REAL') {
      const realMsg = msg as KiwoomWsRealMessage;
      for (const handler of this.handlers) handler(realMsg);
    }
  }

  private handleClose(): void {
    if (this.phase === 'closed') return;
    this.ws = null;
    this.phase = 'reconnect-wait';
    const delay = Math.min(this.reconnectBaseMs * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt += 1;
    this.reconnectHandle = this.timer.setTimeout(() => {
      void this.connect();
    }, delay);
  }
}
