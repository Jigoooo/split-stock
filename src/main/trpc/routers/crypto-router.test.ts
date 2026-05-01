import type { Credentials } from '@shared/contracts';
import type { TRPCError } from '@trpc/server';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveAccountRepo } from '../../account/active-account';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb } from '../../db/client';
import { SettingsRepo } from '../../db/settings-repo';
import { CredentialsRepo, type SafeStorageLike } from '../../security/credentials-repo';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { cryptoRouter } from './crypto-router';

const adapterMocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
}));

vi.mock('../../crypto/upbit/adapter', () => ({
  UpbitExchangeAdapter: vi.fn().mockImplementation(function UpbitExchangeAdapter() {
    return {
      createOrder: adapterMocks.createOrder,
    };
  }),
}));

const createCaller = t.createCallerFactory(cryptoRouter);

function makeMockSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
  };
}

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const activeAccounts = new ActiveAccountRepo(db);
  const credentialsRepo = new CredentialsRepo(db, makeMockSafeStorage());
  const settingsRepo = new SettingsRepo(db);
  const ctx = {
    activeAccounts,
    activeAccountId: null,
    bootStatus: { isRuntimeReady: () => true },
    currentEnv: null,
    credentialsRepo,
    cryptoRealtime: null,
    db,
    logger: { log: vi.fn() },
    settingsRepo,
  } as unknown as Context & {
    activeAccountId: number | null;
    currentEnv: 'MOCK' | 'PROD' | null;
  };
  return { activeAccounts, credentialsRepo, ctx };
}

function seedCredential(
  deps: ReturnType<typeof setup>,
  credential: Credentials,
  accountRef: { accountNo8: string; accountProdCd: string },
): number {
  const account = deps.activeAccounts.upsertFromCredentials({
    env: credential.env,
    broker: credential.broker,
    accountNo8: accountRef.accountNo8,
    accountProdCd: accountRef.accountProdCd,
  });
  if (account.isErr()) throw new Error('account seed failed');
  const saved = deps.credentialsRepo.saveCredentials(account.value, credential);
  if (saved.isErr()) throw new Error('credential seed failed');
  return account.value;
}

async function expectForbidden(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code: 'FORBIDDEN',
  } satisfies Partial<TRPCError>);
}

describe('cryptoRouter session boundary', () => {
  beforeEach(() => {
    adapterMocks.createOrder.mockReset();
    adapterMocks.createOrder.mockResolvedValue(
      ok({
        uuid: 'upbit-order-uuid',
        side: 'bid',
        ord_type: 'limit',
        state: 'wait',
        market: 'KRW-BTC',
        created_at: '2026-05-01T00:00:00+09:00',
        price: '5000',
        volume: '1',
        remaining_volume: '1',
        executed_volume: '0',
        paid_fee: '0',
        locked: '5000',
      }),
    );
  });

  it('blocks live Upbit order when current session is MOCK', async () => {
    const deps = setup();
    const upbitAccountId = seedCredential(
      deps,
      {
        env: 'PROD',
        broker: 'UPBIT',
        accessKey: 'upbit-access-key-12345678',
        secretKey: 'upbit-secret-key-12345678',
      },
      { accountNo8: 'UPBIT***', accountProdCd: 'CRYPTO' },
    );
    deps.ctx.activeAccountId = upbitAccountId;
    deps.ctx.currentEnv = 'MOCK';

    await expectForbidden(
      createCaller(deps.ctx).placeOrder({
        accountId: upbitAccountId,
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'limit',
        price: '5000',
        volume: '1',
      }),
    );
    expect(adapterMocks.createOrder).not.toHaveBeenCalled();
  });

  it('blocks live Upbit order when accountId is not the active account', async () => {
    const deps = setup();
    const kisAccountId = seedCredential(
      deps,
      {
        env: 'PROD',
        broker: 'KIS',
        appKey: 'PSKEY_abcdefghij',
        appSecret: 'PSSECRET_abcdefghij',
        accountNo8: '12345678',
        accountProdCd: '01',
      },
      { accountNo8: '12345678', accountProdCd: '01' },
    );
    const upbitAccountId = seedCredential(
      deps,
      {
        env: 'PROD',
        broker: 'UPBIT',
        accessKey: 'upbit-access-key-12345678',
        secretKey: 'upbit-secret-key-12345678',
      },
      { accountNo8: 'UPBIT***', accountProdCd: 'CRYPTO' },
    );
    deps.ctx.activeAccountId = kisAccountId;
    deps.ctx.currentEnv = 'PROD';

    await expectForbidden(
      createCaller(deps.ctx).placeOrder({
        accountId: upbitAccountId,
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'limit',
        price: '5000',
        volume: '1',
      }),
    );
    expect(adapterMocks.createOrder).not.toHaveBeenCalled();
  });

  it('allows live order only for the active PROD Upbit account', async () => {
    const deps = setup();
    const upbitAccountId = seedCredential(
      deps,
      {
        env: 'PROD',
        broker: 'UPBIT',
        accessKey: 'upbit-access-key-12345678',
        secretKey: 'upbit-secret-key-12345678',
      },
      { accountNo8: 'UPBIT***', accountProdCd: 'CRYPTO' },
    );
    deps.ctx.activeAccountId = upbitAccountId;
    deps.ctx.currentEnv = 'PROD';

    const result = await createCaller(deps.ctx).placeOrder({
      accountId: upbitAccountId,
      market: 'KRW-BTC',
      side: 'bid',
      ordType: 'limit',
      price: '5000',
      volume: '1',
    });

    expect(result.uuid).toBe('upbit-order-uuid');
    expect(adapterMocks.createOrder).toHaveBeenCalledOnce();
  });

  it('returns crypto realtime service status without requiring a private session', async () => {
    const deps = setup();
    deps.ctx.cryptoRealtime = {
      getStatus: () => ({
        publicSessions: [
          {
            key: 'KRW-BTC|1m',
            kind: 'public',
            state: 'open',
            refs: 1,
            market: 'KRW-BTC',
            candleUnit: '1m',
            lastMessageAt: 1,
            lastError: null,
            reconnectAttempts: 0,
            reconnectDelayMs: null,
            staleAfterMs: 15000,
          },
        ],
        privateSessions: [],
      }),
    } as never;

    const result = await createCaller(deps.ctx).getRealtimeStatus();

    expect(result.status.publicSessions[0]?.state).toBe('open');
  });

  it('runs manual order reconciliation through the crypto realtime service', async () => {
    const deps = setup();
    const upbitAccountId = seedCredential(
      deps,
      {
        env: 'PROD',
        broker: 'UPBIT',
        accessKey: 'upbit-access-key-12345678',
        secretKey: 'upbit-secret-key-12345678',
      },
      { accountNo8: 'UPBIT***', accountProdCd: 'CRYPTO' },
    );
    deps.ctx.activeAccountId = upbitAccountId;
    deps.ctx.currentEnv = 'PROD';
    const reconcilePrivate = vi.fn(async () =>
      ok({
        accountId: upbitAccountId,
        exchange: 'UPBIT',
        reason: 'manual',
        openOrders: 1,
        closedOrders: 1,
        detailedOrders: 1,
        persistedFills: 1,
        checkpointAt: 1,
      }),
    );
    deps.ctx.cryptoRealtime = { reconcilePrivate } as never;

    const result = await createCaller(deps.ctx).reconcileOrders({
      accountId: upbitAccountId,
      market: 'KRW-BTC',
    });

    expect(result.persistedFills).toBe(1);
    expect(reconcilePrivate).toHaveBeenCalledWith({
      accountId: upbitAccountId,
      accessKey: 'upbit-access-key-12345678',
      secretKey: 'upbit-secret-key-12345678',
      market: 'KRW-BTC',
      reason: 'manual',
    });
  });
});
