import { beforeEach, describe, expect, it } from 'vitest';
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

  beforeEach(() => {
    db = createTestDb();
    bootstrapSchema(db);
  });

  const validCred = {
    env: 'MOCK' as const,
    appKey: 'PSKEY_abcdefghij',
    appSecret: 'PSSECRET_abcdefghij',
    accountNo8: '12345678',
    accountProdCd: '01',
  };

  it('저장 후 로드하면 원문 복구', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage());
    const saved = repo.saveCredentials(validCred);
    expect(saved.isOk()).toBe(true);

    const loaded = repo.loadCredentials('MOCK');
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

  it('저장되지 않은 env는 null 반환', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage());
    const loaded = repo.loadCredentials('PROD');
    expect(loaded.isOk()).toBe(true);
    if (loaded.isOk()) expect(loaded.value).toBeNull();
  });

  it('clearCredentials 후 load하면 null', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage());
    repo.saveCredentials(validCred);
    repo.clearCredentials('MOCK');
    const loaded = repo.loadCredentials('MOCK');
    if (loaded.isOk()) expect(loaded.value).toBeNull();
  });

  it('safeStorage 비활성 시 저장 에러', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage({ available: false }));
    const saved = repo.saveCredentials(validCred);
    expect(saved.isErr()).toBe(true);
    if (saved.isErr()) expect(saved.error.kind).toBe('ENCRYPTION_UNAVAILABLE');
  });

  it('잘못된 입력(계좌번호 형식)은 VALIDATION 에러', () => {
    const repo = new CredentialsRepo(db, makeMockSafeStorage());
    const saved = repo.saveCredentials({ ...validCred, accountNo8: '123' });
    expect(saved.isErr()).toBe(true);
    if (saved.isErr()) expect(saved.error.kind).toBe('VALIDATION');
  });
});
