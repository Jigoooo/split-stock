import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb, type Db } from '../db/client';
import { AuthService } from './auth';
import { KIS_BASE_URL } from './endpoints';
import { KisHttpClient } from './http-client';
import { TokenStore } from './token-store';

const MOCK_BASE = KIS_BASE_URL.MOCK;
const PROD_BASE = KIS_BASE_URL.PROD;

function setupMock(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

function makeHttpByEnv(agent: MockAgent) {
  return {
    MOCK: new KisHttpClient({ baseUrl: MOCK_BASE, dispatcher: agent }),
    PROD: new KisHttpClient({ baseUrl: PROD_BASE, dispatcher: agent }),
  } as const;
}

describe('AuthService', () => {
  let db: Db;
  let store: TokenStore;
  let agent: MockAgent;

  beforeEach(() => {
    db = createTestDb();
    bootstrapSchema(db);
    store = new TokenStore(db);
    agent = setupMock();
  });

  it('토큰 발급 성공 시 DB에 저장되고 두 번째 호출은 캐시 히트', async () => {
    const pool = agent.get(MOCK_BASE);
    pool.intercept({ path: '/oauth2/tokenP', method: 'POST' }).reply(200, {
      access_token: 'tk_abc',
      token_type: 'Bearer',
      expires_in: 86_400,
    });
    const now = () => 1_700_000_000_000;
    const svc = new AuthService(makeHttpByEnv(agent), store, { now, maxRetries: 1 });

    const first = await svc.getValidToken('MOCK', 'APP', 'SECRET');
    expect(first.isOk()).toBe(true);
    if (first.isOk()) {
      expect(first.value.token).toBe('tk_abc');
      expect(first.value.expiresAt).toBe(now() + 86_400_000);
    }

    // 두 번째 호출은 캐시 히트 — 새 intercept 없이도 성공해야 함
    const second = await svc.getValidToken('MOCK', 'APP', 'SECRET');
    expect(second.isOk()).toBe(true);
    if (second.isOk()) expect(second.value.token).toBe('tk_abc');
  });

  it('만료 6h 이내면 재발급', async () => {
    // 기존 토큰을 DB에 직접 주입 (곧 만료될 토큰)
    const now = 1_700_000_000_000;
    store.save('MOCK', {
      token: 'tk_old',
      tokenType: 'Bearer',
      issuedAt: now - 23 * 3600_000,
      expiresAt: now + 2 * 3600_000, // 2시간 남음 → 재사용 불가
    });

    const pool = agent.get(MOCK_BASE);
    pool.intercept({ path: '/oauth2/tokenP', method: 'POST' }).reply(200, {
      access_token: 'tk_new',
      token_type: 'Bearer',
      expires_in: 86_400,
    });

    const svc = new AuthService(makeHttpByEnv(agent), store, { now: () => now, maxRetries: 1 });
    const r = await svc.getValidToken('MOCK', 'APP', 'SECRET');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.token).toBe('tk_new');
  });

  it('500 에러는 재시도 — 마지막까지 실패하면 NETWORK', async () => {
    const pool = agent.get(MOCK_BASE);
    pool.intercept({ path: '/oauth2/tokenP', method: 'POST' }).reply(500, { err: 'boom' }).times(3);
    const svc = new AuthService(makeHttpByEnv(agent), store, {
      now: () => 1_700_000_000_000,
      maxRetries: 3,
    });
    const r = await svc.issueAndStore('MOCK', 'APP', 'SECRET');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('NETWORK');
  });

  it('401 에러는 재시도 없이 즉시 AUTH_FAILED', async () => {
    const pool = agent.get(MOCK_BASE);
    pool.intercept({ path: '/oauth2/tokenP', method: 'POST' }).reply(401, {
      err: 'unauthorized',
    });
    const svc = new AuthService(makeHttpByEnv(agent), store, {
      now: () => 1_700_000_000_000,
      maxRetries: 3,
    });
    const r = await svc.issueAndStore('MOCK', 'APP', 'SECRET');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('AUTH_FAILED');
  });

  it('스키마가 안 맞으면 VALIDATION 에러', async () => {
    const pool = agent.get(MOCK_BASE);
    pool.intercept({ path: '/oauth2/tokenP', method: 'POST' }).reply(200, {
      // access_token 누락
      token_type: 'Bearer',
      expires_in: 86_400,
    });
    const svc = new AuthService(makeHttpByEnv(agent), store, {
      now: () => 1_700_000_000_000,
      maxRetries: 1,
    });
    const r = await svc.issueAndStore('MOCK', 'APP', 'SECRET');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });

  it('env=PROD 는 PROD base URL로 발급된다 (MOCK URL intercept는 건드리지 않음)', async () => {
    // MOCK base에 대한 intercept만 등록 — 만약 PROD 요청이 MOCK base로 간다면
    // intercept가 소모되어 두 번째 MOCK 호출이 실패할 것.
    const mockPool = agent.get(MOCK_BASE);
    mockPool.intercept({ path: '/oauth2/tokenP', method: 'POST' }).reply(200, {
      access_token: 'tk_mock',
      token_type: 'Bearer',
      expires_in: 86_400,
    });
    const prodPool = agent.get(PROD_BASE);
    prodPool.intercept({ path: '/oauth2/tokenP', method: 'POST' }).reply(200, {
      access_token: 'tk_prod',
      token_type: 'Bearer',
      expires_in: 86_400,
    });

    const now = () => 1_700_000_000_000;
    const svc = new AuthService(makeHttpByEnv(agent), store, { now, maxRetries: 1 });

    const prod = await svc.getValidToken('PROD', 'APP', 'SECRET');
    expect(prod.isOk()).toBe(true);
    if (prod.isOk()) expect(prod.value.token).toBe('tk_prod');

    const mock = await svc.getValidToken('MOCK', 'APP', 'SECRET');
    expect(mock.isOk()).toBe(true);
    if (mock.isOk()) expect(mock.value.token).toBe('tk_mock');
  });
});

describe('TokenStore.isReusable', () => {
  it('여유 > 6h면 재사용 가능', () => {
    const now = 1_700_000_000_000;
    expect(
      TokenStore.isReusable(
        { token: 't', tokenType: 'Bearer', issuedAt: now, expiresAt: now + 7 * 3600_000 },
        now,
      ),
    ).toBe(true);
  });
  it('여유 <= 6h면 재사용 불가', () => {
    const now = 1_700_000_000_000;
    expect(
      TokenStore.isReusable(
        { token: 't', tokenType: 'Bearer', issuedAt: now, expiresAt: now + 5 * 3600_000 },
        now,
      ),
    ).toBe(false);
  });
});
