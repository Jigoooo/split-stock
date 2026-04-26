import type { FeedBus } from '@main/realtime/feed-bus';
import type { RealtimeService } from '@main/realtime/realtime-service';
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

export interface KisRealtimeAdapterDeps {
  /**
   * 활성 RealtimeService 를 lazy 로 얻는 getter. env 전환 시 재생성되므로
   * 매 호출마다 최신 인스턴스를 가져온다.
   */
  getService: () => RealtimeService | null;
  /** 동일 인스턴스에서 emit 된 tick/orderbook 을 받는 bus. */
  bus: FeedBus;
}

/**
 * KIS RealtimeService + FeedBus 를 broker-agnostic RealtimePort 로 노출.
 *
 * - subscribe('TICK')      → service.watch(symbol, 'tick')      + bus.subscribeTick
 * - subscribe('ORDERBOOK') → service.watch(symbol, 'orderbook') + bus.subscribeOrderbook
 * - subscribe('EXEC_NOTICE') / subscribeExecutions → 현재 H0STCNI 복호화 미구현이므로
 *   NOT_IMPLEMENTED 반환 (Phase B 추후 작업)
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

    // EXEC_NOTICE — H0STCNI AES 복호화 (Phase B) 후 활성화
    return err(
      makeBrokerError({
        brokerId: 'KIS',
        kind: 'NOT_IMPLEMENTED',
        msg: 'EXEC_NOTICE 구독은 KIS H0STCNI AES 복호화 구현(Phase B) 후 활성화',
      }),
    );
  }

  subscribeExecutions(_handler: ExecNoticeHandler): Result<Subscription, BrokerError> {
    return err(
      makeBrokerError({
        brokerId: 'KIS',
        kind: 'NOT_IMPLEMENTED',
        msg: 'EXEC_NOTICE 구독은 Phase B 후 활성화',
      }),
    );
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
