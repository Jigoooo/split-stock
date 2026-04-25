import type { AppEnv, Credentials } from '@shared/contracts';
import { ok } from 'neverthrow';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KIS_BASE_URL } from '../kis/endpoints';
import { KisHttpClient } from '../kis/http-client';
import { AutoOrderBlockedError } from './auto-order-errors';
import { MarketSessionGuard } from './market-session-guard';

const BASE = KIS_BASE_URL.MOCK;

function setupMock(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

function credentials(): Credentials {
  return {
    env: 'MOCK',
    appKey: 'APPKEY',
    appSecret: 'APPSECRET',
    accountNo8: '12345678',
    accountProdCd: '01',
  };
}

function createGuard(agent: MockAgent, now: Date) {
  const logger = { log: vi.fn() };
  const guard = new MarketSessionGuard({
    auth: {
      getValidToken: vi.fn(async () =>
        ok({ token: 'tk_test', tokenType: 'Bearer', issuedAt: 0, expiresAt: Date.now() + 1000 }),
      ),
    } as never,
    credentialsRepo: {
      loadCredentials: vi.fn(() => ok(credentials())),
    } as never,
    getCurrentEnv: () => 'MOCK' as AppEnv,
    httpByEnv: {
      MOCK: new KisHttpClient({ baseUrl: BASE, dispatcher: agent }),
      PROD: new KisHttpClient({ baseUrl: KIS_BASE_URL.PROD, dispatcher: agent }),
    },
    logger: logger as never,
    now: () => now,
  });
  return { guard, logger };
}

describe('MarketSessionGuard', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('주말에는 KIS 호출 전에 자동주문을 차단한다', async () => {
    const { guard } = createGuard(agent, new Date('2026-04-25T14:05:00+09:00'));

    await expect(
      guard.assertAutoOrderAllowed({
        accountId: 1,
        pdno: '452450',
        side: 'SELL',
        source: 'STRATEGY',
      }),
    ).rejects.toMatchObject({
      code: 'MARKET_WEEKEND',
    });
  });

  it('정규장 개장일은 허용하고 하루 결과를 캐시한다', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /chk-holiday/, method: 'GET' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OK',
      msg1: 'success',
      output: {
        bass_dt: '20260424',
        wday_dvsn_cd: '5',
        bzdy_yn: 'Y',
        tr_day_yn: 'Y',
        opnd_yn: 'Y',
        sttl_day_yn: 'Y',
      },
    });
    const { guard } = createGuard(agent, new Date('2026-04-24T10:00:00+09:00'));
    const input = {
      accountId: 1,
      pdno: '452450',
      side: 'SELL' as const,
      source: 'STRATEGY' as const,
    };

    await expect(guard.assertAutoOrderAllowed(input)).resolves.toBeUndefined();
    await expect(guard.assertAutoOrderAllowed(input)).resolves.toBeUndefined();
  });

  it('KIS 개장일여부가 N이면 자동주문을 차단한다', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /chk-holiday/, method: 'GET' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OK',
      msg1: 'success',
      output: {
        bass_dt: '20260424',
        wday_dvsn_cd: '5',
        bzdy_yn: 'N',
        tr_day_yn: 'N',
        opnd_yn: 'N',
        sttl_day_yn: 'N',
      },
    });
    const { guard } = createGuard(agent, new Date('2026-04-24T10:00:00+09:00'));

    await expect(
      guard.assertAutoOrderAllowed({
        accountId: 1,
        pdno: '452450',
        side: 'SELL',
        source: 'WATCH',
      }),
    ).rejects.toBeInstanceOf(AutoOrderBlockedError);
  });
});
