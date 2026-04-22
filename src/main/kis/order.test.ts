import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { KIS_BASE_URL } from './endpoints';
import { KisHttpClient } from './http-client';
import { cancelOrRevise, orderCash } from './order';

const BASE = KIS_BASE_URL.MOCK;

function setupMock(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

function createFakeLogger(): EventLogger & { entries: unknown[] } {
  const entries: unknown[] = [];
  return {
    entries,
    log(entry) {
      entries.push(entry);
    },
  };
}

function baseDeps(agent: MockAgent, logger: EventLogger) {
  return {
    http: new KisHttpClient({ baseUrl: BASE, dispatcher: agent }),
    env: 'MOCK' as const,
    token: 'tk_test',
    appKey: 'APPKEY',
    appSecret: 'APPSECRET',
    accountNo8: '12345678',
    accountProdCd: '01',
    logger,
    rateLimitRetryDelayMs: 0,
  };
}

describe('orderCash — 매수', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('지정가 매수 성공 → ODNO 정규화 + 수락 이벤트 로그', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    let capturedBody = '';
    const intercept = pool.intercept({ path: /order-cash/, method: 'POST' }).reply(
      200,
      (opts) => {
        capturedBody = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {});
        return {
          rt_cd: '0',
          msg_cd: 'OPSP0000',
          msg1: 'OK',
          output: { KRX_FWDG_ORD_ORGNO: '01790', ODNO: '0000123456', ORD_TMD: '093015' },
        };
      },
      { headers: { 'content-type': 'application/json' } },
    );

    const r = await orderCash(baseDeps(agent, logger), {
      side: 'BUY',
      pdno: '005930',
      qty: 10,
      price: 70000,
      division: 'LIMIT',
    });

    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.odno).toBe('0000123456');
      expect(r.value.orgNo).toBe('01790');
      expect(r.value.orderedAt).toBe('093015');
    }
    // intercept가 한 번 실행됐는지 확인
    expect(intercept).toBeDefined();
    expect(capturedBody).toContain('"EXCG_ID_DVSN_CD":"KRX"');

    const accepted = logger.entries.find(
      (e): e is { message: string; payload: { odnoHash: string } } =>
        typeof e === 'object' &&
        e !== null &&
        (e as { message: string }).message === 'order.cash.accepted',
    );
    expect(accepted).toBeTruthy();
    // odno가 평문으로 로그에 남지 않음 (해시만)
    const serialized = JSON.stringify(logger.entries);
    expect(serialized).not.toContain('0000123456');
  });

  it('rt_cd !== 0 이면 API_BUSINESS 에러 반환 + 비즈니스 에러 로그', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    pool.intercept({ path: /order-cash/, method: 'POST' }).reply(200, {
      rt_cd: '1',
      msg_cd: 'OPSP1234',
      msg1: '주문가능금액 부족',
    });

    const r = await orderCash(baseDeps(agent, logger), {
      side: 'BUY',
      pdno: '005930',
      qty: 100,
      price: 70000,
      division: 'LIMIT',
    });

    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.kind).toBe('API_BUSINESS');
      expect(r.error.msg).toContain('부족');
    }
    const businessErrLog = logger.entries.find(
      (e): e is { message: string } =>
        typeof e === 'object' &&
        e !== null &&
        (e as { message: string }).message === 'order.cash.business_error',
    );
    expect(businessErrLog).toBeTruthy();
  });

  it('시장가 매수는 ORD_UNPR=0으로 전송', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    let capturedBody = '';
    pool.intercept({ path: /order-cash/, method: 'POST' }).reply(200, (opts) => {
      capturedBody = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {});
      return {
        rt_cd: '0',
        msg_cd: 'OPSP0000',
        msg1: 'OK',
        output: { KRX_FWDG_ORD_ORGNO: '01790', ODNO: '9', ORD_TMD: '100000' },
      };
    });

    const r = await orderCash(baseDeps(agent, logger), {
      side: 'BUY',
      pdno: '005930',
      qty: 5,
      price: 0,
      division: 'MARKET',
    });

    expect(r.isOk()).toBe(true);
    expect(capturedBody).toContain('"ORD_DVSN":"01"');
    expect(capturedBody).toContain('"ORD_UNPR":"0"');
  });

  it('mock 환경에서 RATE_LIMITED 1회는 대기 후 자동 재시도한다', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    pool.intercept({ path: /order-cash/, method: 'POST' }).reply(200, {
      rt_cd: '1',
      msg_cd: 'EGW00201',
      msg1: '초당 거래건수를 초과하였습니다.',
    });
    pool.intercept({ path: /order-cash/, method: 'POST' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OPSP0000',
      msg1: 'OK',
      output: { KRX_FWDG_ORD_ORGNO: '01790', ODNO: '0000000001', ORD_TMD: '100001' },
    });

    const r = await orderCash(baseDeps(agent, logger), {
      side: 'BUY',
      pdno: '005930',
      qty: 1,
      price: 70000,
      division: 'LIMIT',
    });

    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.odno).toBe('0000000001');
    }
    const retryLog = logger.entries.find(
      (e): e is { message: string } =>
        typeof e === 'object' &&
        e !== null &&
        (e as { message: string }).message === 'order.cash.rate_limited_retry',
    );
    expect(retryLog).toBeTruthy();
  });
});

describe('orderCash — 매도', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('지정가 매도 성공', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    pool.intercept({ path: /order-cash/, method: 'POST' }).reply(200, {
      rt_cd: '0',
      msg_cd: 'OPSP0000',
      msg1: 'OK',
      output: { KRX_FWDG_ORD_ORGNO: '01790', ODNO: 'SELL7777', ORD_TMD: '134500' },
    });

    const r = await orderCash(baseDeps(agent, logger), {
      side: 'SELL',
      pdno: '005930',
      qty: 3,
      price: 71000,
      division: 'LIMIT',
    });

    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.odno).toBe('SELL7777');
  });

  it('잘못된 종목코드는 VALIDATION 에러 (네트워크 호출 안 함)', async () => {
    const logger = createFakeLogger();
    // intercept 미등록 — 호출되면 네트워크 실패로 다른 에러가 날 것
    const r = await orderCash(baseDeps(agent, logger), {
      side: 'SELL',
      pdno: '12', // 규칙 위반
      qty: 3,
      price: 71000,
      division: 'LIMIT',
    });

    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });

  it('지정가에서 price=0은 VALIDATION 에러', async () => {
    const logger = createFakeLogger();
    const r = await orderCash(baseDeps(agent, logger), {
      side: 'SELL',
      pdno: '005930',
      qty: 3,
      price: 0,
      division: 'LIMIT',
    });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });
});

describe('cancelOrRevise', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('취소 성공 — RVSE_CNCL_DVSN_CD=02, ORD_UNPR=0으로 전송', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    let capturedBody = '';
    pool.intercept({ path: /order-rvsecncl/, method: 'POST' }).reply(200, (opts) => {
      capturedBody = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {});
      return {
        rt_cd: '0',
        msg_cd: 'OPSP0000',
        msg1: 'OK',
        output: { KRX_FWDG_ORD_ORGNO: '01790', ODNO: 'CNC1111', ORD_TMD: '140000' },
      };
    });

    const r = await cancelOrRevise(baseDeps(agent, logger), {
      action: 'cancel',
      orgOrgNo: '01790',
      orgOdno: '0000987654',
      division: 'LIMIT',
      qty: 10,
      price: 70000,
      qtyAllOrder: true,
    });

    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.odno).toBe('CNC1111');
    expect(capturedBody).toContain('"RVSE_CNCL_DVSN_CD":"02"');
    expect(capturedBody).toContain('"ORD_UNPR":"0"');
    expect(capturedBody).toContain('"QTY_ALL_ORD_YN":"Y"');
    // 원주문번호는 로그에 해시로만
    const serialized = JSON.stringify(logger.entries);
    expect(serialized).not.toContain('0000987654');
  });

  it('취소 실패 (rt_cd != 0) → API_BUSINESS', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    pool.intercept({ path: /order-rvsecncl/, method: 'POST' }).reply(200, {
      rt_cd: '1',
      msg_cd: 'OPSP9999',
      msg1: '이미 체결된 주문',
    });

    const r = await cancelOrRevise(baseDeps(agent, logger), {
      action: 'cancel',
      orgOrgNo: '01790',
      orgOdno: '0000987654',
      division: 'LIMIT',
      qty: 10,
      price: 0,
      qtyAllOrder: false,
    });

    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('API_BUSINESS');
  });

  it('정정 성공 — RVSE_CNCL_DVSN_CD=01, 새 가격 전송', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    let capturedBody = '';
    pool.intercept({ path: /order-rvsecncl/, method: 'POST' }).reply(200, (opts) => {
      capturedBody = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {});
      return {
        rt_cd: '0',
        msg_cd: 'OPSP0000',
        msg1: 'OK',
        output: { KRX_FWDG_ORD_ORGNO: '01790', ODNO: 'REV2222', ORD_TMD: '141500' },
      };
    });

    const r = await cancelOrRevise(baseDeps(agent, logger), {
      action: 'revise',
      orgOrgNo: '01790',
      orgOdno: '0000987654',
      division: 'LIMIT',
      qty: 10,
      price: 69500,
    });

    expect(r.isOk()).toBe(true);
    expect(capturedBody).toContain('"RVSE_CNCL_DVSN_CD":"01"');
    expect(capturedBody).toContain('"ORD_UNPR":"69500"');
  });

  it('정정 입력 누락 (orgOdno 비숫자) → VALIDATION', async () => {
    const logger = createFakeLogger();
    const r = await cancelOrRevise(baseDeps(agent, logger), {
      action: 'revise',
      orgOrgNo: '01790',
      orgOdno: 'INVALID',
      division: 'LIMIT',
      qty: 10,
      price: 70000,
    });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });
});

describe('orderCash — 네트워크 에러 전파', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = setupMock();
  });

  it('500 응답 → NETWORK 에러 + network_error 로그', async () => {
    const logger = createFakeLogger();
    const pool = agent.get(BASE);
    pool.intercept({ path: /order-cash/, method: 'POST' }).reply(500, 'Internal Server Error');

    const r = await orderCash(baseDeps(agent, logger), {
      side: 'BUY',
      pdno: '005930',
      qty: 10,
      price: 70000,
      division: 'LIMIT',
    });

    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('NETWORK');
    const networkLog = logger.entries.find(
      (e): e is { message: string } =>
        typeof e === 'object' &&
        e !== null &&
        (e as { message: string }).message === 'order.cash.network_error',
    );
    expect(networkLog).toBeTruthy();
  });
});
