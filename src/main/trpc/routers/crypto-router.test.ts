import type { Credentials } from '@shared/contracts';
import type { TRPCError } from '@trpc/server';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveAccountRepo } from '../../account/active-account';
import { CryptoTradingRepo } from '../../crypto/crypto-repo';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb } from '../../db/client';
import { SettingsRepo } from '../../db/settings-repo';
import { CredentialsRepo, type SafeStorageLike } from '../../security/credentials-repo';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { cryptoRouter } from './crypto-router';

const adapterMocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  getDeposit: vi.fn(),
  getWithdrawal: vi.fn(),
  listBalances: vi.fn(),
  listDeposits: vi.fn(),
  listWalletStatuses: vi.fn(),
  listWithdrawals: vi.fn(),
}));

vi.mock('../../crypto/upbit/adapter', () => ({
  UpbitExchangeAdapter: vi.fn().mockImplementation(function UpbitExchangeAdapter() {
    return {
      createOrder: adapterMocks.createOrder,
      getDeposit: adapterMocks.getDeposit,
      getWithdrawal: adapterMocks.getWithdrawal,
      listBalances: adapterMocks.listBalances,
      listDeposits: adapterMocks.listDeposits,
      listWalletStatuses: adapterMocks.listWalletStatuses,
      listWithdrawals: adapterMocks.listWithdrawals,
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

function seedActiveUpbit(deps: ReturnType<typeof setup>): number {
  const accountId = seedCredential(
    deps,
    {
      env: 'PROD',
      broker: 'UPBIT',
      accessKey: 'upbit-access-key-12345678',
      secretKey: 'upbit-secret-key-12345678',
    },
    { accountNo8: 'UPBIT***', accountProdCd: 'CRYPTO' },
  );
  deps.ctx.activeAccountId = accountId;
  deps.ctx.currentEnv = 'PROD';
  return accountId;
}

async function expectForbidden(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code: 'FORBIDDEN',
  } satisfies Partial<TRPCError>);
}

describe('cryptoRouter session boundary', () => {
  beforeEach(() => {
    for (const mock of Object.values(adapterMocks)) {
      mock.mockReset();
    }
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
    adapterMocks.listBalances.mockResolvedValue(
      ok([
        {
          currency: 'BTC',
          balance: '0.1',
          locked: '0.01',
          avgBuyPrice: '90000000',
          unitCurrency: 'KRW',
        },
      ]),
    );
    adapterMocks.listDeposits.mockResolvedValue(
      ok([
        {
          direction: 'deposit',
          uuid: 'deposit-uuid',
          currency: 'BTC',
          amount: '0.01',
          fee: '0',
          state: 'ACCEPTED',
          txid: 'deposit-txid',
          transactionType: 'default',
          transferType: 'deposit',
          netType: 'BTC',
          createdAt: 1,
          doneAt: 2,
        },
      ]),
    );
    adapterMocks.listWithdrawals.mockResolvedValue(
      ok([
        {
          direction: 'withdraw',
          uuid: 'withdraw-uuid',
          currency: 'ETH',
          amount: '1.5',
          fee: '0.01',
          state: 'DONE',
          txid: 'withdraw-txid',
          transactionType: 'default',
          transferType: 'withdraw',
          netType: 'ETH',
          createdAt: 3,
          doneAt: 4,
          isCancelable: false,
        },
      ]),
    );
    adapterMocks.getDeposit.mockResolvedValue(
      ok({
        direction: 'deposit',
        uuid: 'deposit-uuid',
        currency: 'BTC',
        amount: '0.01',
        fee: '0',
        state: 'ACCEPTED',
        txid: 'deposit-txid',
        transactionType: 'default',
        transferType: 'deposit',
        netType: 'BTC',
        createdAt: 1,
        doneAt: 2,
      }),
    );
    adapterMocks.getWithdrawal.mockResolvedValue(
      ok({
        direction: 'withdraw',
        uuid: 'withdraw-uuid',
        currency: 'ETH',
        amount: '1.5',
        fee: '0.01',
        state: 'DONE',
        txid: 'withdraw-txid',
        transactionType: 'default',
        transferType: 'withdraw',
        netType: 'ETH',
        createdAt: 3,
        doneAt: 4,
        isCancelable: false,
      }),
    );
    adapterMocks.listWalletStatuses.mockResolvedValue(
      ok([
        {
          currency: 'BTC',
          netType: 'BTC',
          networkName: 'Bitcoin',
          walletState: 'working',
          blockElapsedMinutes: 1,
          blockHeight: 900000,
          blockState: 'normal',
          blockUpdatedAt: 1,
        },
      ]),
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

  it('runs read-only live smoke without placing or cancelling orders', async () => {
    const deps = setup();
    const upbitAccountId = seedActiveUpbit(deps);
    const watchPrivate = vi.fn();
    const reconcilePrivate = vi.fn(async () =>
      ok({
        accountId: upbitAccountId,
        exchange: 'UPBIT',
        reason: 'manual',
        openOrders: 0,
        closedOrders: 1,
        detailedOrders: 1,
        persistedFills: 1,
        checkpointAt: 10,
      }),
    );
    const privateSession = {
      key: String(upbitAccountId),
      kind: 'private',
      state: 'connecting',
      refs: 1,
      accountId: upbitAccountId,
      lastMessageAt: null,
      lastError: null,
      reconnectAttempts: 0,
      reconnectDelayMs: null,
      staleAfterMs: 30000,
    };
    const getStatus = vi
      .fn()
      .mockReturnValueOnce({ publicSessions: [], privateSessions: [] })
      .mockReturnValue({ publicSessions: [], privateSessions: [privateSession] });
    deps.ctx.cryptoRealtime = { getStatus, reconcilePrivate, watchPrivate } as never;

    const result = await createCaller(deps.ctx).runReadonlySmoke({
      accountId: upbitAccountId,
      market: 'KRW-BTC',
    });

    expect(result.dangerousCallsBlocked).toBe(true);
    expect(result.balances).toMatchObject({ ok: true, count: 1 });
    expect(result.privateWs.ok).toBe(true);
    expect(result.reconciliation.ok).toBe(true);
    expect(adapterMocks.listBalances).toHaveBeenCalledOnce();
    expect(watchPrivate).toHaveBeenCalledWith({
      accountId: upbitAccountId,
      accessKey: 'upbit-access-key-12345678',
      secretKey: 'upbit-secret-key-12345678',
      markets: ['KRW-BTC'],
    });
    expect(reconcilePrivate).toHaveBeenCalledWith({
      accountId: upbitAccountId,
      accessKey: 'upbit-access-key-12345678',
      secretKey: 'upbit-secret-key-12345678',
      market: 'KRW-BTC',
      reason: 'manual',
    });
    expect(adapterMocks.createOrder).not.toHaveBeenCalled();
  });

  it('exposes transfer and wallet status queries without execution routes', async () => {
    const deps = setup();
    const upbitAccountId = seedActiveUpbit(deps);
    const caller = createCaller(deps.ctx);

    const transfers = await caller.listTransfers({ accountId: upbitAccountId, limit: 10 });
    const deposit = await caller.getTransfer({
      accountId: upbitAccountId,
      direction: 'deposit',
      uuid: 'deposit-uuid',
    });
    const wallets = await caller.listWalletStatuses({ accountId: upbitAccountId });

    expect(transfers.transfers.map((transfer) => transfer.direction)).toEqual([
      'withdraw',
      'deposit',
    ]);
    expect(deposit.transfer.uuid).toBe('deposit-uuid');
    expect(wallets.statuses[0]?.walletState).toBe('working');
    expect(adapterMocks.listDeposits).toHaveBeenCalledWith({ limit: 10 });
    expect(adapterMocks.listWithdrawals).toHaveBeenCalledWith({ limit: 10 });
    expect(Object.keys(cryptoRouter._def.procedures)).not.toEqual(
      expect.arrayContaining([
        'createDepositAddress',
        'depositKrw',
        'createWithdrawal',
        'createKrwWithdrawal',
        'cancelWithdrawal',
      ]),
    );
  });

  it('returns persisted order detail with fills', async () => {
    const deps = setup();
    const upbitAccountId = seedActiveUpbit(deps);
    const repo = new CryptoTradingRepo(deps.ctx.db);
    repo.upsertOrderSnapshot({
      accountId: upbitAccountId,
      exchange: 'UPBIT',
      order: {
        uuid: 'order-uuid',
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'limit',
        state: 'done',
        price: '100',
        volume: '0.5',
        remainingVolume: '0',
        executedVolume: '0.5',
        paidFee: '0.01',
        locked: '0',
        placedAt: 1,
        trades: [
          {
            uuid: 'trade-uuid',
            price: '100',
            volume: '0.5',
            funds: '50',
            fee: '0.01',
            createdAt: 2,
          },
        ],
      },
    });

    const detail = await createCaller(deps.ctx).getOrderDetail({
      accountId: upbitAccountId,
      uuid: 'order-uuid',
    });

    expect(detail.order).toMatchObject({
      uuid: 'order-uuid',
      averageExecutedPrice: '100',
      totalExecutedFunds: '50',
      totalFee: '0.01',
      fillCount: 1,
    });
  });
});
