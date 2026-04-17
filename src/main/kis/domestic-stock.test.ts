import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import { inquireBalance, inquirePrice } from './domestic-stock';
import { KIS_BASE_URL } from './endpoints';
import { KisHttpClient } from './http-client';

const BASE = KIS_BASE_URL.MOCK;

function setupMock(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

function baseDeps(agent: MockAgent, token = 'tk_test') {
  return {
    http: new KisHttpClient({ baseUrl: BASE, dispatcher: agent }),
    env: 'MOCK' as const,
    token,
    appKey: 'APPKEY',
    appSecret: 'APPSECRET',
    accountNo8: '12345678',
    accountProdCd: '01',
  };
}

describe('inquireBalance', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('성공 응답을 Position 배열로 정규화', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /inquire-balance/, method: 'GET' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OK',
      msg1: 'success',
      output1: [
        {
          pdno: '005930',
          prdt_name: '삼성전자',
          hldg_qty: '10',
          pchs_avg_pric: '65000',
          prpr: '70000',
          evlu_amt: '700000',
          evlu_pfls_amt: '50000',
          evlu_pfls_rt: '7.69',
        },
      ],
      output2: [
        {
          dnca_tot_amt: '1000000',
          tot_evlu_amt: '1700000',
        },
      ],
    });

    const r = await inquireBalance(baseDeps(agent));
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const v = r.value;
      expect(v.positions).toHaveLength(1);
      expect(v.positions[0]).toMatchObject({
        code: '005930',
        name: '삼성전자',
        qty: 10,
        avgPrice: 65000,
        currentPrice: 70000,
        pnlRate: 7.69,
      });
      expect(v.deposit).toBe(1000000);
      expect(v.totalEval).toBe(1700000);
    }
  });

  it('rt_cd !== 0 이면 API_BUSINESS 에러', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /inquire-balance/, method: 'GET' }).reply(200, {
      rt_cd: '1',
      msg_cd: 'ERR001',
      msg1: '조회 실패',
      output1: [],
      output2: [],
    });

    const r = await inquireBalance(baseDeps(agent));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.kind).toBe('API_BUSINESS');
      expect(r.error.msg).toBe('조회 실패');
    }
  });

  it('토큰 만료 문구 감지 시 AUTH_FAILED', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /inquire-balance/, method: 'GET' }).reply(200, {
      rt_cd: '1',
      msg_cd: 'EGW00123',
      msg1: '접근토큰이 만료되었습니다',
      output1: [],
      output2: [],
    });
    const r = await inquireBalance(baseDeps(agent));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('AUTH_FAILED');
  });
});

describe('inquirePrice', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('현재가 응답 정규화', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /inquire-price/, method: 'GET' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OK',
      msg1: 'success',
      output: {
        stck_prpr: '70000',
        prdy_vrss: '1000',
        prdy_ctrt: '1.45',
        acml_vol: '15000000',
      },
    });

    const r = await inquirePrice(baseDeps(agent), '005930');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const v = r.value;
      expect(v.price).toBe(70000);
      expect(v.dayChangeRate).toBe(1.45);
      expect(v.accumVolume).toBe(15_000_000);
    }
  });
});
