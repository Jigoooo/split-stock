import type {
  AppEnv,
  Balance,
  BrokerError,
  BrokerId,
  Candle,
  DailyExecution,
  ExecNoticeEvent,
  Holding,
  OrderAck,
  OrderAmendIntent,
  OrderbookSnapshot,
  OrderIntent,
  Quote,
  RealtimeEvent,
  RealtimeKind,
  StockSymbol,
} from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type {
  BrokerAccountRealtimeEvent,
  BrokerAccountRealtimeHandler,
  CancelOrderInput,
  ExecNoticeHandler,
  GetDailyOhlcvParams,
  ListDailyExecutionsParams,
  RealtimeHandler,
  RealtimePort,
  RealtimeStatus,
  Subscription,
} from '../ports';
import type { BrokerPort } from '../ports/broker-port';

/**
 * 결정론적 in-memory broker adapter — trading/realtime 단위 테스트용.
 *
 * KisAdapter 처럼 BrokerPort 를 구현하지만 외부 HTTP/WS 호출 없이 메모리 fixture
 * 만 반환. 사전 시드된 잔고/주문/체결로 시나리오 재현.
 *
 * 사용:
 *   const fake = new FakeBrokerAdapter({ holdings: [...] });
 *   await fake.placeOrder(...);
 *   expect(fake.placedOrders).toHaveLength(1);
 *
 * Conformance: BrokerPort 인터페이스를 100% 구현하므로 broker-agnostic 코드의
 * 단위 테스트에서 KisAdapter 대용으로 사용 가능.
 */
export interface FakeBrokerAdapterOptions {
  brokerId?: BrokerId;
  env?: AppEnv;
  /** 시드 잔고 (positions/deposit 등). */
  balance?: Balance;
  /** 시드 일봉 — pdno → Candle[]. */
  candlesBySymbol?: Record<string, Candle[]>;
  /** 시드 호가 — pdno → OrderbookSnapshot. */
  orderbookBySymbol?: Record<string, OrderbookSnapshot>;
  /** 시드 현재가 — pdno → Quote. */
  quoteBySymbol?: Record<string, Quote>;
  /** 시드 일별 체결 목록. */
  dailyExecutions?: DailyExecution[];
  /** 휴장일 함수. 기본: 토/일 false, 그 외 true. */
  isTradingDayFn?: (date: Date) => boolean;
  /** 다음 발급 brokerOrderId 의 시작값. */
  startOrderId?: number;
  /** 강제 에러 모드 — 모든 호출이 이 에러로 실패. */
  forceError?: BrokerError;
}

const DEFAULT_BALANCE: Balance = {
  positions: [],
  deposit: 0,
  d2Deposit: 0,
  totalEval: 0,
  estimatedAsset: 0,
};

const DEFAULT_TRADING_DAY = (date: Date): boolean => {
  const day = date.getDay();
  return day !== 0 && day !== 6;
};

export class FakeBrokerAdapter implements BrokerPort {
  readonly brokerId: BrokerId;
  readonly env: AppEnv;

  /** 호출 카운터 — 테스트 검증용. */
  readonly callCount = {
    placeOrder: 0,
    cancelOrder: 0,
    amendOrder: 0,
    inquireBalance: 0,
    getQuote: 0,
    getOrderbook: 0,
    getDailyOhlcv: 0,
    isTradingDay: 0,
    listDailyExecutions: 0,
    ensureSession: 0,
  };

  /** 발생한 주문 — 테스트가 검사 가능. */
  readonly placedOrders: OrderIntent[] = [];
  readonly cancelledOrders: CancelOrderInput[] = [];
  readonly amendedOrders: OrderAmendIntent[] = [];

  private balance: Balance;
  private nextOrderId: number;
  private readonly fakeRealtime: FakeRealtimePort;
  private sessionInvalidated = false;
  private disposed = false;

  constructor(private readonly opts: FakeBrokerAdapterOptions = {}) {
    this.brokerId = opts.brokerId ?? 'KIS';
    this.env = opts.env ?? 'MOCK';
    this.balance = opts.balance ?? DEFAULT_BALANCE;
    this.nextOrderId = opts.startOrderId ?? 1000;
    this.fakeRealtime = new FakeRealtimePort();
  }

  async ensureSession(_opts?: { forceRefresh?: boolean }): Promise<Result<void, BrokerError>> {
    this.callCount.ensureSession += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    this.sessionInvalidated = false;
    return ok(undefined);
  }

  invalidateSession(): void {
    this.sessionInvalidated = true;
  }

  async placeOrder(intent: OrderIntent): Promise<Result<OrderAck, BrokerError>> {
    this.callCount.placeOrder += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    this.placedOrders.push(intent);
    const id = String(this.nextOrderId++);
    return ok({ brokerOrderId: id, brokerOrgNo: '00001', acceptedAt: '093000' });
  }

  async cancelOrder(input: CancelOrderInput): Promise<Result<OrderAck, BrokerError>> {
    this.callCount.cancelOrder += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    this.cancelledOrders.push(input);
    return ok({ brokerOrderId: input.brokerOrderId, acceptedAt: '093001' });
  }

  async amendOrder(input: OrderAmendIntent): Promise<Result<OrderAck, BrokerError>> {
    this.callCount.amendOrder += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    this.amendedOrders.push(input);
    return ok({ brokerOrderId: input.brokerOrderId, acceptedAt: '093002' });
  }

  async listDailyExecutions(
    p: ListDailyExecutionsParams,
  ): Promise<Result<DailyExecution[], BrokerError>> {
    this.callCount.listDailyExecutions += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    const all = this.opts.dailyExecutions ?? [];
    let filtered = all;
    if (p.symbol !== undefined) filtered = filtered.filter((e) => e.symbol === p.symbol);
    if (p.brokerOrderId !== undefined)
      filtered = filtered.filter((e) => e.brokerOrderId === p.brokerOrderId);
    if (p.side !== undefined && p.side !== 'ALL')
      filtered = filtered.filter((e) => e.side === p.side);
    if (p.filledOnly === true) filtered = filtered.filter((e) => e.totalFilledQty > 0);
    return ok(filtered);
  }

  async inquireBalance(): Promise<Result<Balance, BrokerError>> {
    this.callCount.inquireBalance += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    return ok(this.balance);
  }

  /** 테스트 도중 잔고를 변경. */
  setBalance(balance: Balance): void {
    this.balance = balance;
  }

  /** 테스트 도중 holdings 만 변경 (deposit 등 기존 값 유지). */
  setHoldings(positions: Holding[]): void {
    this.balance = { ...this.balance, positions };
  }

  async getQuote(symbol: StockSymbol): Promise<Result<Quote, BrokerError>> {
    this.callCount.getQuote += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    const q = this.opts.quoteBySymbol?.[symbol];
    if (!q) {
      return err(
        makeBrokerError({
          brokerId: this.brokerId,
          kind: 'BUSINESS',
          msg: `no fixture for symbol=${symbol}`,
        }),
      );
    }
    return ok(q);
  }

  async getOrderbook(symbol: StockSymbol): Promise<Result<OrderbookSnapshot, BrokerError>> {
    this.callCount.getOrderbook += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    const o = this.opts.orderbookBySymbol?.[symbol];
    if (!o) {
      return err(
        makeBrokerError({
          brokerId: this.brokerId,
          kind: 'BUSINESS',
          msg: `no orderbook fixture for ${symbol}`,
        }),
      );
    }
    return ok(o);
  }

  async getDailyOhlcv(p: GetDailyOhlcvParams): Promise<Result<Candle[], BrokerError>> {
    this.callCount.getDailyOhlcv += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    return ok(this.opts.candlesBySymbol?.[p.symbol] ?? []);
  }

  async isTradingDay(date: Date): Promise<Result<boolean, BrokerError>> {
    this.callCount.isTradingDay += 1;
    if (this.opts.forceError) return err(this.opts.forceError);
    const fn = this.opts.isTradingDayFn ?? DEFAULT_TRADING_DAY;
    return ok(fn(date));
  }

  realtime(): RealtimePort {
    return this.fakeRealtime;
  }

  dispose(): void {
    this.disposed = true;
  }

  // ─── 테스트 헬퍼 ────────────────────────────────────────────────────────

  isDisposed(): boolean {
    return this.disposed;
  }

  isSessionInvalidated(): boolean {
    return this.sessionInvalidated;
  }
}

/**
 * Fake RealtimePort — 테스트가 emit() 으로 이벤트 주입.
 */
export class FakeRealtimePort implements RealtimePort {
  private readonly subs: Array<{
    symbol: StockSymbol;
    kind: RealtimeKind;
    handler: RealtimeHandler;
  }> = [];
  private readonly execHandlers: ExecNoticeHandler[] = [];
  private readonly accountHandlers: BrokerAccountRealtimeHandler[] = [];
  private phase: RealtimeStatus['phase'] = 'idle';

  async start(): Promise<Result<void, BrokerError>> {
    this.phase = 'open';
    return ok(undefined);
  }

  stop(): void {
    this.phase = 'closed';
  }

  subscribe(
    symbol: StockSymbol,
    kind: RealtimeKind,
    handler: RealtimeHandler,
  ): Result<Subscription, BrokerError> {
    const entry = { symbol, kind, handler };
    this.subs.push(entry);
    return ok({
      unsubscribe: () => {
        const idx = this.subs.indexOf(entry);
        if (idx >= 0) this.subs.splice(idx, 1);
      },
    });
  }

  subscribeExecutions(handler: ExecNoticeHandler): Result<Subscription, BrokerError> {
    this.execHandlers.push(handler);
    return ok({
      unsubscribe: () => {
        const idx = this.execHandlers.indexOf(handler);
        if (idx >= 0) this.execHandlers.splice(idx, 1);
      },
    });
  }

  subscribeAccountEvents(handler: BrokerAccountRealtimeHandler): Result<Subscription, BrokerError> {
    this.accountHandlers.push(handler);
    return ok({
      unsubscribe: () => {
        const idx = this.accountHandlers.indexOf(handler);
        if (idx >= 0) this.accountHandlers.splice(idx, 1);
      },
    });
  }

  getStatus(): RealtimeStatus {
    return {
      phase: this.phase,
      subscriptions: this.subs.length + this.execHandlers.length + this.accountHandlers.length,
    };
  }

  /** 테스트가 이벤트를 fire 할 때 사용. */
  emit(event: RealtimeEvent): void {
    for (const sub of this.subs) {
      if (event.kind === 'TICK' && sub.kind === 'TICK' && event.data.symbol === sub.symbol) {
        sub.handler(event);
      } else if (
        event.kind === 'ORDERBOOK' &&
        sub.kind === 'ORDERBOOK' &&
        event.data.snapshot.symbol === sub.symbol
      ) {
        sub.handler(event);
      } else if (event.kind === 'EXEC_NOTICE' && sub.kind === 'EXEC_NOTICE') {
        sub.handler(event);
      }
    }
  }

  emitExec(event: ExecNoticeEvent): void {
    for (const handler of this.execHandlers) handler(event);
  }

  emitAccount(event: BrokerAccountRealtimeEvent): void {
    for (const handler of this.accountHandlers) handler(event);
  }
}
