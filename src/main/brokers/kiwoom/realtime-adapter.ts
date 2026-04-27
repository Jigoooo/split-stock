import type { BrokerError, RealtimeEvent, RealtimeKind, StockSymbol } from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type {
  ExecNoticeHandler,
  RealtimeHandler,
  RealtimePort,
  RealtimeStatus,
  Subscription,
} from '../ports';
import { KIWOOM_WS_TYPE } from './metadata/endpoints';
import type { KiwoomSocketClient, KiwoomWsRealMessage } from './socket-client';

/**
 * KIWOOM_WS_TYPE → RealtimeKind 역매핑.
 */
function kindToWsType(kind: RealtimeKind): string | null {
  switch (kind) {
    case 'TICK':
      return KIWOOM_WS_TYPE.TICK;
    case 'ORDERBOOK':
      return KIWOOM_WS_TYPE.ORDERBOOK;
    case 'EXEC_NOTICE':
      return KIWOOM_WS_TYPE.EXEC_NOTICE;
    default:
      return null;
  }
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Kiwoom WS REAL 메시지 → RealtimeEvent 변환.
 *
 * values 키 매핑은 Kiwoom 공식 문서 기준. 라이브 검증(Stage 6.5) 시 정확한
 * 키 보정 가능.
 */
function mapKiwoomRealToEvent(
  data: KiwoomWsRealMessage['data'][number],
  seq: number,
): RealtimeEvent | null {
  const v = data.values ?? {};
  if (data.type === KIWOOM_WS_TYPE.TICK) {
    return {
      kind: 'TICK',
      data: {
        symbol: data.item,
        price: parseNum(v['10']) || parseNum(v.cur_prc), // 10: 현재가 (Kiwoom WS 표준 코드)
        volume: parseNum(v['15']) || parseNum(v.trde_qty),
        tradedAt: v['20'] ?? v.cntr_tm ?? '',
        seq,
      },
    };
  }
  if (data.type === KIWOOM_WS_TYPE.ORDERBOOK) {
    const asks: Array<{ price: number; qty: number }> = [];
    const bids: Array<{ price: number; qty: number }> = [];
    for (let n = 1; n <= 10; n++) {
      asks.push({
        price: parseNum(v[`sel${n}bid`] ?? v[`41${n - 1}`]),
        qty: parseNum(v[`sel${n}bid_req`] ?? v[`61${n - 1}`]),
      });
      bids.push({
        price: parseNum(v[`buy${n}bid`] ?? v[`51${n - 1}`]),
        qty: parseNum(v[`buy${n}bid_req`] ?? v[`71${n - 1}`]),
      });
    }
    return {
      kind: 'ORDERBOOK',
      data: {
        snapshot: {
          symbol: data.item,
          time: v['21'] ?? v.bid_req_base_tm ?? '',
          asks,
          bids,
          totalAskQty: parseNum(v['121'] ?? v.tot_sel_req),
          totalBidQty: parseNum(v['125'] ?? v.tot_buy_req),
          expectedPrice: 0,
          expectedQty: 0,
        },
        seq,
      },
    };
  }
  if (data.type === KIWOOM_WS_TYPE.EXEC_NOTICE) {
    return {
      kind: 'EXEC_NOTICE',
      data: {
        brokerOrderId: v['9203'] ?? v.ord_no ?? '',
        symbol: data.item,
        filledQty: parseNum(v['911'] ?? v.cntr_qty),
        price: parseNum(v['910'] ?? v.cntr_pric),
        at: v['908'] ?? v.cntr_tm ?? '',
      },
    };
  }
  return null;
}

/**
 * Kiwoom WS 클라이언트를 broker-agnostic RealtimePort 로 노출.
 *
 * - subscribe('TICK')      → socket.subscribe(symbol, '0B')
 * - subscribe('ORDERBOOK') → socket.subscribe(symbol, '0D')
 * - subscribe('EXEC_NOTICE')/subscribeExecutions → '00' 코드 (Kiwoom 은 KIS 와 달리 직접 지원)
 *
 * Stage 6.5 라이브 검증 시 values 키 매핑 보정.
 */
export class KiwoomRealtimeAdapter implements RealtimePort {
  private seqCounter = 0;
  private readonly perKindHandlers = new Map<
    string, // `${symbol}:${kind}`
    Set<RealtimeHandler>
  >();
  private readonly execHandlers = new Set<ExecNoticeHandler>();
  private msgUnsubscribe: (() => void) | null = null;

  constructor(private readonly socket: KiwoomSocketClient) {}

  async start(): Promise<Result<void, BrokerError>> {
    if (!this.msgUnsubscribe) {
      this.msgUnsubscribe = this.socket.onReal((msg) => this.handleReal(msg));
    }
    try {
      await this.socket.connect();
      return ok(undefined);
    } catch (cause) {
      return err(
        makeBrokerError({
          brokerId: 'KIWOOM',
          kind: 'NETWORK',
          msg: cause instanceof Error ? cause.message : 'WS connect failed',
          cause,
        }),
      );
    }
  }

  stop(): void {
    if (this.msgUnsubscribe) {
      this.msgUnsubscribe();
      this.msgUnsubscribe = null;
    }
    this.socket.disconnect();
  }

  subscribe(
    symbol: StockSymbol,
    kind: RealtimeKind,
    handler: RealtimeHandler,
  ): Result<Subscription, BrokerError> {
    const wsType = kindToWsType(kind);
    if (!wsType) {
      return err(
        makeBrokerError({
          brokerId: 'KIWOOM',
          kind: 'VALIDATION',
          msg: `unsupported RealtimeKind: ${kind}`,
        }),
      );
    }
    const key = `${symbol}:${kind}`;
    let handlers = this.perKindHandlers.get(key);
    if (!handlers) {
      handlers = new Set();
      this.perKindHandlers.set(key, handlers);
      this.socket.subscribe(symbol, wsType);
    }
    handlers.add(handler);
    // closure 캡처: TypeScript 가 closure 안에서 narrow 못 하므로
    // const 로 명시 — non-null assertion 회피.
    const handlersRef = handlers;
    return ok({
      unsubscribe: () => {
        handlersRef.delete(handler);
        if (handlersRef.size === 0) {
          this.perKindHandlers.delete(key);
          this.socket.unsubscribe(symbol, wsType);
        }
      },
    });
  }

  subscribeExecutions(handler: ExecNoticeHandler): Result<Subscription, BrokerError> {
    this.execHandlers.add(handler);
    // 체결통보는 종목별이 아닌 계좌별 — '00' type 한 번만 구독
    if (this.execHandlers.size === 1) {
      this.socket.subscribe('', KIWOOM_WS_TYPE.EXEC_NOTICE);
    }
    return ok({
      unsubscribe: () => {
        this.execHandlers.delete(handler);
        if (this.execHandlers.size === 0) {
          this.socket.unsubscribe('', KIWOOM_WS_TYPE.EXEC_NOTICE);
        }
      },
    });
  }

  getStatus(): RealtimeStatus {
    return {
      phase: this.socket.getPhase(),
      subscriptions: this.perKindHandlers.size + (this.execHandlers.size > 0 ? 1 : 0),
    };
  }

  private handleReal(msg: KiwoomWsRealMessage): void {
    for (const data of msg.data) {
      this.seqCounter += 1;
      const event = mapKiwoomRealToEvent(data, this.seqCounter);
      if (!event) continue;

      if (event.kind === 'TICK') {
        const handlers = this.perKindHandlers.get(`${event.data.symbol}:TICK`);
        if (handlers) for (const h of handlers) h(event);
        continue;
      }
      if (event.kind === 'ORDERBOOK') {
        const handlers = this.perKindHandlers.get(`${event.data.snapshot.symbol}:ORDERBOOK`);
        if (handlers) for (const h of handlers) h(event);
        continue;
      }
      if (event.kind === 'EXEC_NOTICE') {
        for (const h of this.execHandlers) h(event.data);
      }
    }
  }
}
