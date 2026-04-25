import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  inquireBalance,
  inquireDailyCcld,
  inquireDomesticHoliday,
  inquirePrice,
} from './domestic-stock';
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
      // 미응답 필드는 0 으로 정규화 — 차트 헤더에서 0 이면 '—' 로 노출.
      expect(v.upperLimit).toBe(0);
      expect(v.lowerLimit).toBe(0);
      expect(v.high).toBe(0);
      expect(v.low).toBe(0);
    }
  });

  it('시가/고가/저가/상한가/하한가/기준가까지 정규화', async () => {
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
        stck_oprc: '69500',
        stck_hgpr: '70500',
        stck_lwpr: '69000',
        stck_mxpr: '89700',
        stck_llam: '48300',
        stck_sdpr: '69000',
      },
    });

    const r = await inquirePrice(baseDeps(agent), '005930');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const v = r.value;
      expect(v.open).toBe(69_500);
      expect(v.high).toBe(70_500);
      expect(v.low).toBe(69_000);
      expect(v.upperLimit).toBe(89_700);
      expect(v.lowerLimit).toBe(48_300);
      expect(v.prevClose).toBe(69_000);
    }
  });
});

describe('inquireDomesticHoliday', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('국내휴장일조회 응답의 개장일 여부를 정규화한다', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /chk-holiday/, method: 'GET' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OK',
      msg1: 'success',
      output: [
        {
          bass_dt: '20260424',
          wday_dvsn_cd: '5',
          bzdy_yn: 'Y',
          tr_day_yn: 'Y',
          opnd_yn: 'Y',
          sttl_day_yn: 'Y',
        },
        {
          bass_dt: '20260425',
          wday_dvsn_cd: '6',
          bzdy_yn: 'N',
          tr_day_yn: 'N',
          opnd_yn: 'N',
          sttl_day_yn: 'N',
        },
      ],
    });

    const r = await inquireDomesticHoliday(baseDeps(agent), '20260424');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual([
        {
          date: '20260424',
          weekdayCode: '5',
          businessDay: true,
          tradingDay: true,
          openDay: true,
          settlementDay: true,
        },
        {
          date: '20260425',
          weekdayCode: '6',
          businessDay: false,
          tradingDay: false,
          openDay: false,
          settlementDay: false,
        },
      ]);
    }
  });
});

describe('inquireDailyCcld', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('주문체결 조회 응답을 정규화한다', async () => {
    const pool = agent.get(BASE);
    pool.intercept({ path: /inquire-daily-ccld/, method: 'GET' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OK',
      msg1: 'success',
      output1: [
        {
          odno: '0001',
          pdno: '005930',
          prdt_name: '삼성전자',
          sll_buy_dvsn_cd: '02',
          ord_qty: '10',
          ord_unpr: '70000',
          ord_tmd: '093000',
          tot_ccld_qty: '10',
          avg_prvs: '69900',
          rmn_qty: '0',
          cncl_yn: 'N',
          rjct_qty: '0',
        },
      ],
    });

    const r = await inquireDailyCcld(baseDeps(agent), {
      from: new Date('2026-04-22T09:00:00+09:00'),
      to: new Date('2026-04-22T09:05:00+09:00'),
      orderNo: '0001',
      side: 'BUY',
    });

    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual([
        {
          odno: '0001',
          pdno: '005930',
          name: '삼성전자',
          side: 'BUY',
          orderQty: 10,
          orderPrice: 70000,
          orderedAt: '093000',
          totalFilledQty: 10,
          remainingQty: 0,
          avgFillPrice: 69900,
          cancelled: false,
          rejectedQty: 0,
        },
      ]);
    }
  });
});
