import type {
  CryptoCandleUnit,
  CryptoPrivateAssetEvent,
  CryptoPrivateOrderEvent,
  CryptoRealtimeSessionState,
  CryptoRealtimeStatus,
} from '@shared/contracts';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import { CryptoOrderReconciler } from './crypto-order-reconciler';
import { CryptoRealtimeBus } from './crypto-realtime-bus';
import { CryptoTradingRepo } from './crypto-repo';
import type { CryptoRealtimeAdapter } from './ports';
import { UpbitExchangeAdapter } from './upbit/adapter';
import { UpbitRealtimeClient } from './upbit/realtime-client';

type Timer = ReturnType<typeof setTimeout>;
type SessionKind = 'public' | 'private';

type Session = {
  key: string;
  kind: SessionKind;
  refs: number;
  state: CryptoRealtimeSessionState;
  close: () => void;
  start: () => void;
  staleAfterMs: number;
  staleTimer: Timer | null;
  reconnectTimer: Timer | null;
  lastMessageAt: number | null;
  lastError: string | null;
  reconnectAttempts: number;
  reconnectDelayMs: number | null;
  market?: string;
  candleUnit?: CryptoCandleUnit;
  accountId?: number;
};

export interface CryptoRealtimeServiceOptions {
  publicStaleAfterMs?: number;
  privateStaleAfterMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  realtimeFactory?: (input?: { accessKey: string; secretKey: string }) => CryptoRealtimeAdapter;
  exchangeFactory?: (input: { accessKey: string; secretKey: string }) => UpbitExchangeAdapter;
  orderReconciler?: CryptoOrderReconciler;
}

export class CryptoRealtimeService {
  readonly bus: CryptoRealtimeBus;
  private readonly repo: CryptoTradingRepo;
  private readonly reconciler: CryptoOrderReconciler;
  private readonly publicSessions = new Map<string, Session>();
  private readonly privateSessions = new Map<number, Session>();
  private readonly publicStaleAfterMs: number;
  private readonly privateStaleAfterMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly realtimeFactory: NonNullable<CryptoRealtimeServiceOptions['realtimeFactory']>;
  private readonly exchangeFactory: NonNullable<CryptoRealtimeServiceOptions['exchangeFactory']>;

  constructor(
    db: Db,
    private readonly logger: EventLogger,
    bus = new CryptoRealtimeBus(),
    options: CryptoRealtimeServiceOptions = {},
  ) {
    this.bus = bus;
    this.repo = new CryptoTradingRepo(db);
    this.reconciler = options.orderReconciler ?? new CryptoOrderReconciler(this.repo, logger);
    this.publicStaleAfterMs = options.publicStaleAfterMs ?? 15_000;
    this.privateStaleAfterMs = options.privateStaleAfterMs ?? 30_000;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
    this.realtimeFactory =
      options.realtimeFactory ??
      ((credentials) =>
        credentials === undefined
          ? new UpbitRealtimeClient()
          : new UpbitRealtimeClient(credentials));
    this.exchangeFactory =
      options.exchangeFactory ?? ((credentials) => new UpbitExchangeAdapter(credentials));
  }

  watchMarket(input: { market: string; candleUnit: CryptoCandleUnit }): void {
    const key = publicKey(input.market, input.candleUnit);
    const existing = this.publicSessions.get(key);
    if (existing) {
      existing.refs += 1;
      return;
    }

    const session = this.createSession({
      key,
      kind: 'public',
      staleAfterMs: this.publicStaleAfterMs,
      market: input.market,
      candleUnit: input.candleUnit,
    });
    session.start = () => this.startPublicSession(session, input);
    this.publicSessions.set(key, session);
    session.start();
  }

  unwatchMarket(input: { market: string; candleUnit: CryptoCandleUnit }): void {
    const key = publicKey(input.market, input.candleUnit);
    const existing = this.publicSessions.get(key);
    if (!existing) return;
    existing.refs -= 1;
    if (existing.refs > 0) return;
    this.closeSession(existing);
    this.publicSessions.delete(key);
  }

  watchPrivate(input: {
    accountId: number;
    accessKey: string;
    secretKey: string;
    markets?: string[];
  }): void {
    const existing = this.privateSessions.get(input.accountId);
    if (existing) {
      existing.refs += 1;
      return;
    }

    void this.reconcilePrivate({
      accountId: input.accountId,
      accessKey: input.accessKey,
      secretKey: input.secretKey,
      reason: 'watch-private',
      ...(input.markets?.[0] !== undefined ? { market: input.markets[0] } : {}),
    });

    const session = this.createSession({
      key: String(input.accountId),
      kind: 'private',
      staleAfterMs: this.privateStaleAfterMs,
      accountId: input.accountId,
      ...(input.markets?.[0] !== undefined ? { market: input.markets[0] } : {}),
    });
    session.start = () => this.startPrivateSession(session, input);
    this.privateSessions.set(input.accountId, session);
    session.start();
  }

  unwatchPrivate(accountId: number): void {
    const existing = this.privateSessions.get(accountId);
    if (!existing) return;
    existing.refs -= 1;
    if (existing.refs > 0) return;
    this.closeSession(existing);
    this.privateSessions.delete(accountId);
  }

  async reconcilePrivate(input: {
    accountId: number;
    accessKey: string;
    secretKey: string;
    reason: 'startup' | 'watch-private' | 'reconnect' | 'manual';
    market?: string;
  }) {
    const result = await this.reconciler.reconcile({
      accountId: input.accountId,
      exchange: 'UPBIT',
      adapter: this.exchangeFactory({ accessKey: input.accessKey, secretKey: input.secretKey }),
      reason: input.reason,
      ...(input.market !== undefined ? { market: input.market } : {}),
    });
    if (result.isErr()) {
      this.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'crypto.order-reconcile.failed',
        payload: {
          accountId: input.accountId,
          reason: input.reason,
          kind: result.error.kind,
          msg: result.error.message,
        },
      });
    }
    return result;
  }

  getWatchedMarkets(): Array<{ market: string; candleUnit: CryptoCandleUnit; refs: number }> {
    return Array.from(this.publicSessions.values()).map((session) => ({
      market: session.market ?? '',
      candleUnit: session.candleUnit ?? '1m',
      refs: session.refs,
    }));
  }

  getStatus(): CryptoRealtimeStatus {
    return {
      publicSessions: Array.from(this.publicSessions.values()).map(sessionStatus),
      privateSessions: Array.from(this.privateSessions.values()).map(sessionStatus),
    };
  }

  private startPublicSession(
    session: Session,
    input: { market: string; candleUnit: CryptoCandleUnit },
  ): void {
    this.prepareSessionStart(session);
    const client = this.realtimeFactory();
    const subscription = client.watchPublic({
      market: input.market,
      candleUnit: input.candleUnit,
      onEvent: (event) => {
        this.markMessage(session);
        if (event.kind === 'ticker') this.bus.publishTicker(event.value);
        if (event.kind === 'trade') this.bus.publishTrade(event.value);
        if (event.kind === 'orderbook') this.bus.publishOrderbook(event.value);
        if (event.kind === 'candle') {
          this.bus.publishCandle(event.value);
          this.repo.upsertCandles([event.value]);
        }
      },
      onError: (cause) => {
        this.logger.log({
          level: 'WARN',
          category: 'WS',
          message: 'crypto.upbit.public-ws.failed',
          payload: {
            market: input.market,
            candleUnit: input.candleUnit,
            cause: errorMessage(cause),
          },
        });
        this.scheduleReconnect(session, cause);
      },
    });
    session.close = subscription.close;
  }

  private startPrivateSession(
    session: Session,
    input: {
      accountId: number;
      accessKey: string;
      secretKey: string;
      markets?: string[];
    },
  ): void {
    this.prepareSessionStart(session);
    const client = this.realtimeFactory({
      accessKey: input.accessKey,
      secretKey: input.secretKey,
    });
    const subscription = client.watchPrivate({
      accountId: input.accountId,
      onOrder: (event) => this.applyPrivateOrder(session, event),
      onAsset: (event) => this.applyPrivateAsset(session, event),
      onError: (cause) => {
        this.logger.log({
          level: 'WARN',
          category: 'WS',
          message: 'crypto.upbit.private-ws.failed',
          payload: {
            accountId: input.accountId,
            cause: errorMessage(cause),
          },
        });
        void this.reconcilePrivate({
          accountId: input.accountId,
          accessKey: input.accessKey,
          secretKey: input.secretKey,
          reason: 'reconnect',
          ...(input.markets?.[0] !== undefined ? { market: input.markets[0] } : {}),
        });
        this.scheduleReconnect(session, cause);
      },
      ...(input.markets !== undefined ? { markets: input.markets } : {}),
    });
    session.close = subscription.close;
  }

  private applyPrivateOrder(session: Session, event: CryptoPrivateOrderEvent): void {
    this.markMessage(session);
    this.repo.applyPrivateOrderEvent(event);
    this.bus.publishPrivateOrder(event);
  }

  private applyPrivateAsset(session: Session, event: CryptoPrivateAssetEvent): void {
    this.markMessage(session);
    this.repo.applyPrivateAssetEvent(event);
    this.bus.publishPrivateAsset(event);
  }

  private createSession(input: {
    key: string;
    kind: SessionKind;
    staleAfterMs: number;
    market?: string;
    candleUnit?: CryptoCandleUnit;
    accountId?: number;
  }): Session {
    return {
      key: input.key,
      kind: input.kind,
      refs: 1,
      state: 'connecting',
      close: () => undefined,
      start: () => undefined,
      staleAfterMs: input.staleAfterMs,
      staleTimer: null,
      reconnectTimer: null,
      lastMessageAt: null,
      lastError: null,
      reconnectAttempts: 0,
      reconnectDelayMs: null,
      ...(input.market !== undefined ? { market: input.market } : {}),
      ...(input.candleUnit !== undefined ? { candleUnit: input.candleUnit } : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
    };
  }

  private prepareSessionStart(session: Session): void {
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
    session.reconnectDelayMs = null;
    session.state = session.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
  }

  private markMessage(session: Session): void {
    session.state = 'open';
    session.lastMessageAt = Date.now();
    session.lastError = null;
    session.reconnectAttempts = 0;
    session.reconnectDelayMs = null;
    if (session.staleTimer) clearTimeout(session.staleTimer);
    session.staleTimer = setTimeout(() => {
      if (session.state === 'open') session.state = 'stale';
    }, session.staleAfterMs);
  }

  private scheduleReconnect(session: Session, cause: unknown): void {
    if (session.state === 'closed') return;
    session.lastError = errorMessage(cause);
    session.reconnectAttempts += 1;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** Math.max(0, session.reconnectAttempts - 1),
      this.reconnectMaxDelayMs,
    );
    session.reconnectDelayMs = delay;
    session.state = 'reconnecting';
    if (session.staleTimer) clearTimeout(session.staleTimer);
    try {
      session.close();
    } catch {
      // best effort close before reconnect
    }
    session.reconnectTimer = setTimeout(() => {
      if (session.state === 'closed') return;
      session.start();
    }, delay);
  }

  private closeSession(session: Session): void {
    session.state = 'closed';
    if (session.staleTimer) clearTimeout(session.staleTimer);
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    try {
      session.close();
    } catch {
      // best effort close
    }
  }
}

function publicKey(market: string, unit: CryptoCandleUnit): string {
  return `${market}|${unit}`;
}

function sessionStatus(session: Session): CryptoRealtimeStatus['publicSessions'][number] {
  return {
    key: session.key,
    kind: session.kind,
    state: session.state,
    refs: session.refs,
    ...(session.market !== undefined ? { market: session.market } : {}),
    ...(session.candleUnit !== undefined ? { candleUnit: session.candleUnit } : {}),
    ...(session.accountId !== undefined ? { accountId: session.accountId } : {}),
    lastMessageAt: session.lastMessageAt,
    lastError: session.lastError,
    reconnectAttempts: session.reconnectAttempts,
    reconnectDelayMs: session.reconnectDelayMs,
    staleAfterMs: session.staleAfterMs,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
