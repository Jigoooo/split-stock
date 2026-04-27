import type { Credentials } from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ActiveAccountRepo } from '../../account/active-account';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb } from '../../db/client';
import { SettingsRepo } from '../../db/settings-repo';
import { CredentialsRepo, type SafeStorageLike } from '../../security/credentials-repo';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { accountRouter } from './account-router';

const createCaller = t.createCallerFactory(accountRouter);

function makeMockSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
  };
}

function setupStoredCredentialOnly() {
  const db = createTestDb();
  bootstrapSchema(db);
  const activeAccounts = new ActiveAccountRepo(db);
  const credentialsRepo = new CredentialsRepo(db, makeMockSafeStorage());
  const settingsRepo = new SettingsRepo(db);
  const logger = { log: vi.fn() };
  const credential: Credentials = {
    env: 'PROD',
    broker: 'KIS',
    appKey: 'PSKEY_abcdefghij',
    appSecret: 'PSSECRET_abcdefghij',
    accountNo8: '99999999',
    accountProdCd: '01',
  };
  const saved = credentialsRepo.saveCredentials(7, credential);
  if (saved.isErr()) throw new Error('seed credential failed');

  const ctx = {
    activeAccounts,
    activeAccountId: null,
    currentEnv: 'MOCK',
    credentialsRepo,
    currentStateSync: { trigger: vi.fn() },
    logger,
    settingsRepo,
    setEnvAndAccount(next: { env: 'MOCK' | 'PROD' | null; accountId: number | null }) {
      ctx.currentEnv = next.env;
      ctx.activeAccountId = next.accountId;
    },
  } as unknown as Context & { activeAccountId: number | null; currentEnv: 'MOCK' | 'PROD' | null };

  return { activeAccounts, ctx, logger };
}

describe('accountRouter stored credential repair', () => {
  it('listAccounts — credentials만 남은 PROD 계좌를 accounts 행으로 복구한다', async () => {
    const { activeAccounts, ctx } = setupStoredCredentialOnly();
    expect(activeAccounts.getById(7)).toBeNull();

    const result = await createCaller(ctx).listAccounts();

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]?.id).toBe(7);
    expect(result.accounts[0]?.env).toBe('PROD');
    expect(result.activeAccountId).toBe(7);
  });

  it('setActive — fallback으로 보이는 stored credential 계좌도 전환 가능하다', async () => {
    const { activeAccounts, ctx } = setupStoredCredentialOnly();
    expect(activeAccounts.getById(7)).toBeNull();

    const result = await createCaller(ctx).setActive({ accountId: 7 });

    expect(result).toEqual({ ok: true, accountId: 7, env: 'PROD' });
    expect(activeAccounts.getById(7)?.isActive).toBe(true);
    expect(ctx.currentEnv).toBe('PROD');
    expect(ctx.activeAccountId).toBe(7);
  });
});
