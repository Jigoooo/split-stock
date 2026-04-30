import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { WsLike } from '../kis/ws-client';
import { type ContextFactoryOptions, createContextFactory } from './context';

type WsEvent = { data?: unknown; code?: number; reason?: string; error?: unknown };
type WsListener = (event: WsEvent) => void;

class FakeWs implements WsLike {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<WsListener>>();

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.trigger('close', {});
  }

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: WsListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: WsListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  openNow(): void {
    this.readyState = 1;
    this.trigger('open', {});
  }

  message(data: string): void {
    this.trigger('message', { data });
  }

  private trigger(type: string, event: WsEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('createContextFactory account realtime wiring', () => {
  it('Kiwoom 계좌 dirty subscription은 실제 WS를 시작하고 주문체결/잔고 type을 등록한다', async () => {
    const sockets: FakeWs[] = [];
    const logger = { log: vi.fn() };
    const credential = {
      env: 'MOCK' as const,
      broker: 'KIWOOM' as const,
      appKey: 'APPKEY_1234567890',
      appSecret: 'APPSECRET_1234567890',
      accountNo8: '12345678',
      accountProdCd: '01' as const,
    };
    const factory = createContextFactory({
      logger,
      credentialsRepo: {
        loadCredentials: () => ok(credential),
      },
      kiwoomTokenStore: {
        load: () =>
          ok({
            token: 'TOKEN',
            tokenType: 'Bearer',
            issuedAt: Date.now(),
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          }),
      },
      kiwoomWsFactory: (url: string) => {
        const ws = new FakeWs(url);
        sockets.push(ws);
        return ws;
      },
      kiwoomHttpByEnv: { MOCK: {}, PROD: {} },
      httpByEnv: { MOCK: {}, PROD: {} },
      auth: {},
      db: {},
      settingsRepo: {},
      safetyRegistry: { get: () => ({}) },
      strategyRepo: {},
      stockMasterRepo: {},
      stockMasterSync: {},
      candlesRepo: {},
      tradingCalendar: { getTradingDayStatus: vi.fn() },
      lotsRepo: {},
      prebuyRepo: {},
      activeAccounts: {},
      timeWindowRepo: {},
      rateGuardRepo: {},
      protectionLimitsRepo: {},
      watchEngine: null,
      strategyEngine: null,
      pendingOrderWatcher: null,
      bus: {},
      aiCredentialsRepo: null,
      llmClient: null,
      dartClient: null,
      dartCorpCodeRepo: null,
      marketContextService: null,
      naverDatalabClient: null,
      newsFetcher: null,
      initialActiveAccountId: 1,
    } as unknown as ContextFactoryOptions);

    factory.setEnvAndAccount({ env: 'MOCK', accountId: 1 });
    factory.setCurrentStateSync({ enqueueBrokerEvent: vi.fn() } as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(sockets).toHaveLength(1);
    const ws = sockets[0];
    if (!ws) throw new Error('missing ws');
    ws.openNow();
    ws.message(JSON.stringify({ trnm: 'LOGIN', return_code: 0 }));

    const frames = ws.sent.map((frame) => JSON.parse(frame) as { trnm: string; data?: unknown });
    expect(frames[0]).toMatchObject({ trnm: 'LOGIN', token: 'TOKEN' });
    expect(frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trnm: 'REG',
          data: [{ item: [''], type: ['00'] }],
        }),
        expect.objectContaining({
          trnm: 'REG',
          data: [{ item: [''], type: ['04'] }],
        }),
      ]),
    );
  });
});
