import type { FeedBus } from '@main/realtime/feed-bus';
import type { RealtimeService } from '@main/realtime/realtime-service';
import type {
  BrokerError,
  CniNotice,
  RealtimeEvent,
  RealtimeKind,
  StockSymbol,
} from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type {
  BrokerAccountRealtimeEvent,
  BrokerAccountRealtimeHandler,
  ExecNoticeHandler,
  RealtimeHandler,
  RealtimePort,
  RealtimeStatus,
  Subscription,
} from '../ports';

export interface KisRealtimeAdapterDeps {
  /**
   * 활성 RealtimeService 를 lazy 로 얻는 getter. env 전환 시 재생성되므로
   * 매 호출마다 최신 인스턴스를 가져온다.
   */
  getService: () => RealtimeService | null;
  /** 동일 인스턴스에서 emit 된 tick/orderbook 을 받는 bus. */
  bus: FeedBus;
  /** KIS CNI 구독용 HTS ID. 없으면 polling fallback 만 사용한다. */
  getHtsId: () => string | null;
}

/**
 * KIS RealtimeService + FeedBus 를 broker-agnostic RealtimePort 로 노출.
 *
 * - subscribe('TICK')      → service.watch(symbol, 'tick')      + bus.subscribeTick
 * - subscribe('ORDERBOOK') → service.watch(symbol, 'orderbook') + bus.subscribeOrderbook
 * - subscribe('EXEC_NOTICE') / subscribeExecutions → CNI account event 를 execution
 *   projection 으로 노출. 장부 확정은 ManualOrderReconciler 가 REST 조회로 수행한다.
 *
 * RealtimeService 는 main 부트스트랩이 env 별로 생성·관리하므로 본 adapter 는
 * lifecycle (start/stop/dispose) 에 직접 관여하지 않는다.
 */
export class KisRealtimeAdapter implements RealtimePort {
  constructor(private readonly deps: KisRealtimeAdapterDeps) {}

  async start(): Promise<Result<void, BrokerError>> {
    // RealtimeService 는 부트스트랩에서 자동 시작. broker 측에서는 noop.
    return ok(undefined);
  }

  stop(): void {
    // 동일 — 부트스트랩이 setEnv(null) 시 service.stop() 처리.
  }

  subscribe(
    symbol: StockSymbol,
    kind: RealtimeKind,
    handler: RealtimeHandler,
  ): Result<Subscription, BrokerError> {
    const service = this.deps.getService();
    if (!service) {
      return err(
        makeBrokerError({
          brokerId: 'KIS',
          kind: 'BUSINESS',
          msg: 'RealtimeService 미준비 (env 미선택 또는 KIS WS 비활성)',
        }),
      );
    }

    if (kind === 'TICK') {
      service.watch(symbol, 'tick');
      let seq = 0;
      const unsub = this.deps.bus.subscribeTick(symbol, (u) => {
        seq += 1;
        const event: RealtimeEvent = {
          kind: 'TICK',
          data: {
            symbol: u.pdno,
            price: u.price,
            volume: u.volume,
            tradedAt: u.time,
            seq,
          },
        };
        handler(event);
      });
      return ok({
        unsubscribe: () => {
          unsub();
          service.unwatch(symbol, 'tick');
        },
      });
    }

    if (kind === 'ORDERBOOK') {
      service.watch(symbol, 'orderbook');
      let seq = 0;
      const unsub = this.deps.bus.subscribeOrderbook(symbol, (u) => {
        seq += 1;
        const event: RealtimeEvent = {
          kind: 'ORDERBOOK',
          data: {
            snapshot: {
              symbol: u.pdno,
              time: u.time,
              asks: u.asks.map((a) => ({ price: a.price, qty: a.quantity })),
              bids: u.bids.map((b) => ({ price: b.price, qty: b.quantity })),
              totalAskQty: u.totalAskQty,
              totalBidQty: u.totalBidQty,
              expectedPrice: u.expectedPrice,
              expectedQty: u.expectedQty,
            },
            seq,
          },
        };
        handler(event);
      });
      return ok({
        unsubscribe: () => {
          unsub();
          service.unwatch(symbol, 'orderbook');
        },
      });
    }

    if (kind === 'EXEC_NOTICE') {
      return this.subscribeAccountEvents((event) => {
        if (event.kind === 'ORDER_DIRTY' && event.execution) {
          handler({ kind: 'EXEC_NOTICE', data: event.execution });
        }
      });
    }

    return err(
      makeBrokerError({
        brokerId: 'KIS',
        kind: 'VALIDATION',
        msg: `unsupported RealtimeKind: ${kind}`,
      }),
    );
  }

  subscribeExecutions(handler: ExecNoticeHandler): Result<Subscription, BrokerError> {
    return this.subscribeAccountEvents((event) => {
      if (event.kind === 'ORDER_DIRTY' && event.execution) handler(event.execution);
    });
  }

  subscribeAccountEvents(handler: BrokerAccountRealtimeHandler): Result<Subscription, BrokerError> {
    const service = this.deps.getService();
    if (!service) {
      return err(
        makeBrokerError({
          brokerId: 'KIS',
          kind: 'BUSINESS',
          msg: 'RealtimeService 미준비 (env 미선택 또는 KIS WS 비활성)',
        }),
      );
    }
    const htsId = this.deps.getHtsId();
    if (!htsId) {
      return err(
        makeBrokerError({
          brokerId: 'KIS',
          kind: 'VALIDATION',
          msg: 'KIS 체결통보 구독을 위한 HTS ID가 없습니다. polling 동기화만 사용합니다.',
        }),
      );
    }

    const subscribed = service.subscribeCniNotices(htsId, (notice) => {
      const event = mapKisCniNoticeToAccountEvent(notice);
      if (event) handler(event);
    });
    if (!subscribed.ok) {
      return err(
        makeBrokerError({
          brokerId: 'KIS',
          kind: 'VALIDATION',
          msg: subscribed.reason,
        }),
      );
    }
    return ok({ unsubscribe: subscribed.unsubscribe });
  }

  getStatus(): RealtimeStatus {
    const service = this.deps.getService();
    if (!service) return { phase: 'idle', subscriptions: 0 };
    const watched = service.getWatched();
    return {
      phase: watched.length > 0 ? 'open' : 'idle',
      subscriptions: watched.length,
    };
  }
}

function parsePositiveInt(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value.replace(/^\+/, ''));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function parseSymbol(value: string | undefined): StockSymbol | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^A/, '');
  return /^\d{6}$/.test(normalized) ? normalized : undefined;
}

export function mapKisCniNoticeToAccountEvent(
  notice: CniNotice,
): BrokerAccountRealtimeEvent | null {
  const fields = notice.raw.split('^');
  const brokerOrderId = fields[2] ?? '';
  if (!brokerOrderId) return null;
  const symbol = parseSymbol(fields[8]);
  const filledQty = parsePositiveInt(fields[9]);
  const price = parsePositiveInt(fields[10]);
  const at = fields[11] ?? '';
  const fillFlag = fields[13] ?? '';
  const execution =
    fillFlag === '2' && symbol && filledQty > 0
      ? {
          brokerOrderId,
          symbol,
          filledQty,
          price,
          at,
        }
      : undefined;
  return {
    kind: 'ORDER_DIRTY',
    brokerOrderId,
    ...(symbol !== undefined && { symbol }),
    ...(execution !== undefined && { execution }),
    at: at || new Date().toISOString(),
  };
}
