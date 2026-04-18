import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import { inquireDailyChart } from './domestic-stock';
import { KIS_BASE_URL } from './endpoints';
import { KisHttpClient } from './http-client';

const BASE = KIS_BASE_URL.MOCK;

function setupMock(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

function deps(agent: MockAgent) {
  return {
    http: new KisHttpClient({ baseUrl: BASE, dispatcher: agent }),
    env: 'MOCK' as const,
    token: 'tk',
    appKey: 'AK',
    appSecret: 'AS',
  };
}

describe('inquireDailyChart', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('output2 정규화 + 날짜 오름차순 정렬 + ISO 포맷', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /inquire-daily-itemchartprice/, method: 'GET' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OK',
      msg1: 'ok',
      output2: [
        {
          stck_bsop_date: '20260418',
          stck_oprc: '70000',
          stck_hgpr: '71000',
          stck_lwpr: '69500',
          stck_clpr: '70500',
          acml_vol: '15000000',
        },
        {
          stck_bsop_date: '20260417',
          stck_oprc: '69000',
          stck_hgpr: '70500',
          stck_lwpr: '68700',
          stck_clpr: '70000',
          acml_vol: '12000000',
        },
      ],
    });

    const r = await inquireDailyChart(deps(agent), {
      code: '005930',
      from: new Date('2026-04-01'),
      to: new Date('2026-04-18'),
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toHaveLength(2);
      expect(r.value[0]?.date).toBe('2026-04-17');
      expect(r.value[1]?.date).toBe('2026-04-18');
      expect(r.value[0]?.open).toBe(69_000);
      expect(r.value[1]?.close).toBe(70_500);
    }
  });

  it('close=0(비거래일) 행 제거', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /inquire-daily-itemchartprice/, method: 'GET' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OK',
      msg1: 'ok',
      output2: [
        {
          stck_bsop_date: '20260418',
          stck_oprc: '0',
          stck_hgpr: '0',
          stck_lwpr: '0',
          stck_clpr: '0',
          acml_vol: '0',
        },
        {
          stck_bsop_date: '20260417',
          stck_oprc: '69000',
          stck_hgpr: '70500',
          stck_lwpr: '68700',
          stck_clpr: '70000',
          acml_vol: '12000000',
        },
      ],
    });
    const r = await inquireDailyChart(deps(agent), {
      code: '005930',
      from: new Date('2026-04-01'),
      to: new Date('2026-04-18'),
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toHaveLength(1);
  });

  it('rt_cd != 0 → API_BUSINESS', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /inquire-daily-itemchartprice/, method: 'GET' }).reply(200, {
      rt_cd: '1',
      msg_cd: 'ERR',
      msg1: '조회 실패',
    });
    const r = await inquireDailyChart(deps(agent), {
      code: '005930',
      from: new Date(),
      to: new Date(),
    });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('API_BUSINESS');
  });
});
