import type { Credentials } from '@shared/contracts/app';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActiveAccountRepo } from '../account/active-account';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb, type Db } from '../db/client';
import { CredentialsRepo, type SafeStorageLike } from './credentials-repo';

/**
 * safeStorage mock — encrypt/decrypt를 XOR + prefix로 시뮬.
 * 원문과 암호화 결과가 반드시 달라야 한다는 불변식만 만족하면 됨.
 */
function makeMockSafeStorage(options: { available?: boolean } = {}): SafeStorageLike {
  const available = options.available ?? true;
  return {
    isEncryptionAvailable: () => available,
    encryptString(plain: string): Buffer {
      const body = Buffer.from(plain, 'utf8');
      for (let i = 0; i < body.length; i++) {
        body[i] = (body[i] ?? 0) ^ 0x7a;
      }
      return Buffer.concat([Buffer.from('ENC1', 'utf8'), body]);
    },
    decryptString(encrypted: Buffer): string {
      if (encrypted.slice(0, 4).toString('utf8') !== 'ENC1') {
        throw new Error('invalid prefix');
      }
      const body = Buffer.from(encrypted.slice(4));
      for (let i = 0; i < body.length; i++) {
        body[i] = (body[i] ?? 0) ^ 0x7a;
      }
      return body.toString('utf8');
    },
  };
}

describe('CredentialsRepo', () => {
  let db: Db;
  let accountIdMock: number;

  beforeEach(() => {
    db = createTestDb();
    bootstrapSchema(db);
    const accounts = new ActiveAccountRepo(db);
    const r = accounts.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    if (!r.isOk()) throw new Error('seed account failed');
    accountIdMock = r.value;
  });

  const validCred: Credentials = {
    env: 'MOCK',
    appKey: 'PSKEY_abcdefghij',
    appSecret: 'PSSECRET_abcdefghij',
    accountNo8: '12345678',
    accountProdCd: '01',
  };

  it('계좌별 저장 후 로드하면 원문 복구', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage());
    const saved = repo.saveCredentials(accountIdMock, validCred);
    expect(saved.isOk()).toBe(true);

    const loaded = repo.loadCredentials(accountIdMock);
    expect(loaded.isOk()).toBe(true);
    if (loaded.isOk()) expect(loaded.value).toEqual(validCred);
  });

  it('mock safeStorage는 평문과 다른 Buffer를 반환 (암호화 불변식)', () => {
    const safe = makeMockSafeStorage();
    const plain = JSON.stringify(validCred);
    const encrypted = safe.encryptString(plain);
    expect(encrypted.toString('utf8')).not.toBe(plain);
    expect(safe.decryptString(encrypted)).toBe(plain);
  });

  it('등록되지 않은 계좌는 null 반환', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage());
    const loaded = repo.loadCredentials(9999);
    expect(loaded.isOk()).toBe(true);
    if (loaded.isOk()) expect(loaded.value).toBeNull();
  });

  it('clearCredentials 후 load하면 null', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage());
    repo.saveCredentials(accountIdMock, validCred);
    repo.clearCredentials(accountIdMock);
    const loaded = repo.loadCredentials(accountIdMock);
    if (loaded.isOk()) expect(loaded.value).toBeNull();
  });

  it('safeStorage 비활성 시 저장 에러', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage({ available: false }));
    const saved = repo.saveCredentials(accountIdMock, validCred);
    expect(saved.isErr()).toBe(true);
    if (saved.isErr()) expect(saved.error.kind).toBe('ENCRYPTION_UNAVAILABLE');
  });

  it('잘못된 입력(계좌번호 형식)은 VALIDATION 에러', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage());
    const saved = repo.saveCredentials(accountIdMock, { ...validCred, accountNo8: '123' });
    expect(saved.isErr()).toBe(true);
    if (saved.isErr()) expect(saved.error.kind).toBe('VALIDATION');
  });

  describe('per-account 격리 + BC env API', () => {
    it('계좌 A의 자격증명은 계좌 B에서 load 불가', () => {
      const accounts = new ActiveAccountRepo(db);
      const b = accounts.upsertFromCredentials({
        env: 'PROD',
        accountNo8: '99999999',
        accountProdCd: '01',
      });
      if (!b.isOk()) throw new Error('seed B failed');
      const accountIdProd = b.value;
      const credProd = { ...validCred, env: 'PROD' as const, accountNo8: '99999999' };

      const repo = new CredentialsRepo(db, makeMockSafeStorage());
      repo.saveCredentials(accountIdMock, validCred);
      repo.saveCredentials(accountIdProd, credProd);

      const a = repo.loadCredentials(accountIdMock);
      const c = repo.loadCredentials(accountIdProd);
      if (!(a.isOk() && c.isOk())) throw new Error('load failed');
      expect(a.value?.env).toBe('MOCK');
      expect(c.value?.env).toBe('PROD');
      expect(a.value?.accountNo8).toBe('12345678');
      expect(c.value?.accountNo8).toBe('99999999');
    });

    it('loadCredentialsByEnv — UNIQUE INDEX 보장으로 단일 결과', () => {
      const repo = new CredentialsRepo(db, makeMockSafeStorage());
      repo.saveCredentials(accountIdMock, validCred);

      const r = repo.loadCredentialsByEnv('MOCK');
      if (!r.isOk()) throw new Error('load failed');
      expect(r.value).toEqual(validCred);
    });

    it('clearCredentialsByEnv — env 일괄 삭제', () => {
      const repo = new CredentialsRepo(db, makeMockSafeStorage());
      repo.saveCredentials(accountIdMock, validCred);
      const r = repo.clearCredentialsByEnv('MOCK');
      expect(r.isOk()).toBe(true);
      const loaded = repo.loadCredentials(accountIdMock);
      if (loaded.isOk()) expect(loaded.value).toBeNull();
    });

    it('resolveAccountIdByEnv — 저장된 env 의 계좌 ID 반환', () => {
      const repo = new CredentialsRepo(db, makeMockSafeStorage());
      repo.saveCredentials(accountIdMock, validCred);
      expect(repo.resolveAccountIdByEnv('MOCK')).toBe(accountIdMock);
      expect(repo.resolveAccountIdByEnv('PROD')).toBeNull();
    });

    it('listEntries — 저장된 자격증명 메타 반환', () => {
      const repo = new CredentialsRepo(db, makeMockSafeStorage());
      repo.saveCredentials(accountIdMock, validCred);
      const entries = repo.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({ accountId: accountIdMock, env: 'MOCK' });
    });
  });
});
