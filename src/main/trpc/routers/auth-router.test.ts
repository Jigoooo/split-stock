import type { Credentials } from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ActiveAccountRepo } from '../../account/active-account';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb } from '../../db/client';
import { SettingsRepo } from '../../db/settings-repo';
import { CredentialsRepo, type SafeStorageLike } from '../../security/credentials-repo';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { authRouter } from './auth-router';

const createCaller = t.createCallerFactory(authRouter);

function makeMockSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
  };
}

function createAuthContext(seed: {
  activeAccountId: number | null;
  currentEnv: 'MOCK' | 'PROD' | null;
  activeAccounts: ActiveAccountRepo;
  credentialsRepo: CredentialsRepo;
  settingsRepo: SettingsRepo;
}) {
  const stockMasterSync = { syncIfStaleWithLog: vi.fn() };
  const ctx = {
    activeAccounts: seed.activeAccounts,
    activeAccountId: seed.activeAccountId,
    currentEnv: seed.currentEnv,
    credentialsRepo: seed.credentialsRepo,
    currentStateSync: { trigger: vi.fn() },
    logger: { log: vi.fn() },
    settingsRepo: seed.settingsRepo,
    stockMasterSync,
    setActiveAccountId(next: number | null) {
      ctx.activeAccountId = next;
    },
    setCurrentEnv(next: 'MOCK' | 'PROD' | null) {
      ctx.currentEnv = next;
    },
    setEnvAndAccount(next: { env: 'MOCK' | 'PROD' | null; accountId: number | null }) {
      ctx.currentEnv = next.env;
      ctx.activeAccountId = next.accountId;
    },
  } as unknown as Context & {
    activeAccountId: number | null;
    currentEnv: 'MOCK' | 'PROD' | null;
    stockMasterSync: typeof stockMasterSync;
  };
  return ctx;
}

function setupRepo() {
  const db = createTestDb();
  bootstrapSchema(db);
  const activeAccounts = new ActiveAccountRepo(db);
  const credentialsRepo = new CredentialsRepo(db, makeMockSafeStorage());
  const settingsRepo = new SettingsRepo(db);
  return { activeAccounts, credentialsRepo, settingsRepo };
}

function seedCredential(deps: ReturnType<typeof setupRepo>, credential: Credentials): number {
  const accountRef =
    credential.broker === 'UPBIT'
      ? { accountNo8: 'UPBIT***', accountProdCd: 'CRYPTO' }
      : { accountNo8: credential.accountNo8, accountProdCd: credential.accountProdCd };
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

const upbitCredential = {
  env: 'PROD',
  broker: 'UPBIT',
  accessKey: 'upbit-access-key-12345678',
  secretKey: 'upbit-secret-key-12345678',
} satisfies Credentials;

describe('authRouter provider-aware credentials', () => {
  it('clearCredentials clears active UPBIT session when deleting active credentials', async () => {
    const deps = setupRepo();
    const upbitAccountId = seedCredential(deps, upbitCredential);
    deps.activeAccounts.setActiveAccountId(upbitAccountId);
    deps.settingsRepo.set('last_active_env', 'PROD');
    const ctx = createAuthContext({
      ...deps,
      activeAccountId: upbitAccountId,
      currentEnv: 'PROD',
    });

    const result = await createCaller(ctx).clearCredentials({ env: 'PROD', broker: 'UPBIT' });

    expect(result).toEqual({ ok: true });
    expect(deps.credentialsRepo.loadCredentials(upbitAccountId)._unsafeUnwrap()).toBeNull();
    expect(ctx.currentEnv).toBeNull();
    expect(ctx.activeAccountId).toBeNull();
    expect(deps.settingsRepo.get('last_active_env')).toBeNull();
  });

  it('logout clearStored deletes active UPBIT credentials and clears account context', async () => {
    const deps = setupRepo();
    const upbitAccountId = seedCredential(deps, upbitCredential);
    deps.activeAccounts.setActiveAccountId(upbitAccountId);
    const ctx = createAuthContext({
      ...deps,
      activeAccountId: upbitAccountId,
      currentEnv: 'PROD',
    });

    const result = await createCaller(ctx).logout({ clearStored: true });

    expect(result).toEqual({ ok: true });
    expect(deps.credentialsRepo.loadCredentials(upbitAccountId)._unsafeUnwrap()).toBeNull();
    expect(ctx.currentEnv).toBeNull();
    expect(ctx.activeAccountId).toBeNull();
  });

  it('setEnv keeps the active UPBIT account when PROD has multiple providers', async () => {
    const deps = setupRepo();
    seedCredential(deps, {
      env: 'PROD',
      broker: 'KIS',
      appKey: 'PSKEY_abcdefghij',
      appSecret: 'PSSECRET_abcdefghij',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    const upbitAccountId = seedCredential(deps, upbitCredential);
    deps.activeAccounts.setActiveAccountId(upbitAccountId);
    const ctx = createAuthContext({
      ...deps,
      activeAccountId: upbitAccountId,
      currentEnv: null,
    });

    const result = await createCaller(ctx).setEnv('PROD');

    expect(result).toEqual({ env: 'PROD', accountId: upbitAccountId });
    expect(ctx.currentEnv).toBe('PROD');
    expect(ctx.activeAccountId).toBe(upbitAccountId);
    expect(deps.activeAccounts.getById(upbitAccountId)?.isActive).toBe(true);
    expect(ctx.stockMasterSync.syncIfStaleWithLog).not.toHaveBeenCalled();
  });
});
