import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { CryptoRealtimeService } from './crypto-realtime-service';
import type { CryptoRealtimeAdapter } from './ports';

describe('CryptoRealtimeService status and recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks public session open, stale, and reconnecting states', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const close = vi.fn();
    const capture: { publicInput?: Parameters<CryptoRealtimeAdapter['watchPublic']>[0] } = {};
    const realtimeFactory = vi.fn(
      () =>
        ({
          watchPublic: vi.fn((input) => {
            capture.publicInput = input;
            return { close };
          }),
          watchPrivate: vi.fn(),
        }) as CryptoRealtimeAdapter,
    );
    const service = new CryptoRealtimeService(db, { log: vi.fn() }, undefined, {
      publicStaleAfterMs: 1000,
      reconnectBaseDelayMs: 500,
      realtimeFactory,
    });

    service.watchMarket({ market: 'KRW-BTC', candleUnit: '1m' });
    expect(service.getStatus().publicSessions[0]?.state).toBe('connecting');
    if (!capture.publicInput) throw new Error('public subscription was not created');

    capture.publicInput.onEvent({
      kind: 'ticker',
      value: {
        exchange: 'UPBIT',
        market: 'KRW-BTC',
        tradePrice: '100',
        signedChangePrice: '1',
        signedChangeRate: '0.01',
        accTradePrice24h: '1000',
        accTradeVolume24h: '10',
        timestamp: Date.now(),
        receivedAt: Date.now(),
      },
    });
    expect(service.getStatus().publicSessions[0]?.state).toBe('open');
    expect(service.getStatus().publicSessions[0]?.lastMessageAt).toBe(Date.now());

    vi.advanceTimersByTime(1000);
    expect(service.getStatus().publicSessions[0]?.state).toBe('stale');

    capture.publicInput.onError?.(new Error('socket down'));
    expect(service.getStatus().publicSessions[0]).toMatchObject({
      state: 'reconnecting',
      lastError: 'socket down',
      reconnectAttempts: 1,
      reconnectDelayMs: 500,
    });
    expect(close).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(500);
    expect(realtimeFactory).toHaveBeenCalledTimes(2);
    expect(service.getStatus().publicSessions[0]?.state).toBe('reconnecting');
  });

  it('runs private reconciliation on watch and after private websocket failure', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const capture: { privateInput?: Parameters<CryptoRealtimeAdapter['watchPrivate']>[0] } = {};
    const realtimeFactory = vi.fn(
      () =>
        ({
          watchPublic: vi.fn(),
          watchPrivate: vi.fn((input) => {
            capture.privateInput = input;
            return { close: vi.fn() };
          }),
        }) as CryptoRealtimeAdapter,
    );
    const exchange = {
      listOpenOrders: vi.fn(async () => ok([])),
      listClosedOrders: vi.fn(async () => ok([])),
      getOrder: vi.fn(),
    };
    const service = new CryptoRealtimeService(db, { log: vi.fn() }, undefined, {
      privateStaleAfterMs: 1000,
      reconnectBaseDelayMs: 500,
      realtimeFactory,
      exchangeFactory: () => exchange as never,
    });

    service.watchPrivate({
      accountId: 1,
      accessKey: 'access',
      secretKey: 'secret',
      markets: ['KRW-BTC'],
    });
    await vi.runOnlyPendingTimersAsync();
    if (!capture.privateInput) throw new Error('private subscription was not created');

    expect(exchange.listOpenOrders).toHaveBeenCalledOnce();
    capture.privateInput.onError?.(new Error('private down'));
    await vi.runOnlyPendingTimersAsync();
    expect(exchange.listOpenOrders).toHaveBeenCalledTimes(2);
    expect(service.getStatus().privateSessions[0]).toMatchObject({
      state: 'reconnecting',
      lastError: 'private down',
    });
  });
});
