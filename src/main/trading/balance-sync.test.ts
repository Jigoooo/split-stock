import type { AppEnv } from '@shared/contracts';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { KIS_BASE_URL, KIS_PATH } from '../kis/endpoints';
import { KisHttpClient } from '../kis/http-client';
import type { Timer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';
import { BalanceSync } from './balance-sync';
import { LotsRepo } from './lots-repo';

// ── helpers ──────────────────────────────────────────────────────────────────

function createFakeLogger(): EventLogger & {
  entries: Array<{ level: string; message: string; payload?: unknown }>;
} {
  const entries: Array<{ level: string; message: string; payload?: unknown }> = [];
  return {
    entries,
    log(entry) {
      entries.push({ level: entry.level, message: entry.message, payload: entry.payload });
    },
  };
}

/** 수동으로 tick하는 FakeTimer. setInterval 콜백을 즉시 호출하지 않음. */
function createFakeTimer(): Timer & { tickInterval(): void } {
  let intervalCb: (() => void) | null = null;
  return {
    tickInterval() {
      if (intervalCb) intervalCb();
    },
    setTimeout(cb, _ms) {
      const h = setTimeout(cb, 0); // 테스트에서는 즉시 실행
      return { clear: () => clearTimeout(h) };
    },
    setInterval(cb, _ms) {
      intervalCb = cb;
      return {
        clear: () => {
          intervalCb = null;
        },
      };
    },
    now: () => Date.now(),
  };
}

function installMockAgent(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

/** KIS inquire-balance mock 응답 생성. */
function makeBalanceReply(positions: Array<{ pdno: string; qty: number }>) {
  return {
    rt_cd: '0',
    msg_cd: 'KIOK',
    msg1: 'OK',
    output1: positions.map((p) => ({
      pdno: p.pdno,
      prdt_name: `종목_${p.pdno}`,
      hldg_qty: String(p.qty),
      pchs_avg_pric: '70000',
      prpr: '72000',
      evlu_amt: String(p.qty * 72000),
      evlu_pfls_amt: String(p.qty * 2000),
      evlu_pfls_rt: '2.86',
    })),
    output2: [
      {
        dnca_tot_amt: '5000000',
        tot_evlu_amt: '10000000',
      },
    ],
  };
}

function makeAuthDeps(env: AppEnv, BASE: string) {
  const httpByEnv: Record<AppEnv, KisHttpClient> = {
    MOCK: new KisHttpClient({ baseUrl: BASE }),
    PROD: new KisHttpClient({ baseUrl: BASE }),
  };
  const credentialsRepo = {
    loadCredentialsByEnv: () => ({
      isOk: () => true,
      isErr: () => false,
      value: {
        accountNo8: '12345678',
        accountProdCd: '01',
        appKey: 'APPKEY',
        appSecret: 'APPSECRET',
      },
    }),
  } as unknown as import('../security/credentials-repo').CredentialsRepo;

  const auth = {
    getValidToken: vi.fn().mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: { token: 'FAKE_TOKEN' },
    }),
  } as unknown as import('../kis/auth').AuthService;

  return { httpByEnv, credentialsRepo, auth, env };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('BalanceSync', () => {
  let agent: MockAgent;
  const BASE = KIS_BASE_URL.MOCK;

  beforeEach(() => {
    agent = installMockAgent();
  });

  it('start() → setInterval 등록, stop() → 해제', () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const db = createTestDb();
    bootstrapSchema(db);
    const lotsRepo = new LotsRepo(db);
    const { httpByEnv, credentialsRepo, auth } = makeAuthDeps('MOCK', BASE);

    const sync = new BalanceSync({
      getEnv: () => 'MOCK',
      getAccountId: () => 1,
      credentialsRepo,
      auth,
      httpByEnv,
      lotsRepo,
      logger,
      timer,
      intervalMs: 1000,
    });

    sync.start();
    sync.stop();
    // stop 후 추가 tick은 poll을 호출하지 않음
    timer.tickInterval();
    // auth.getValidToken이 호출되지 않아야 함 (폴링 중단됨)
    expect(auth.getValidToken).not.toHaveBeenCalled();
  });

  it('refresh() → 즉시 inquireBalance 호출', async () => {
    const pool = agent.get(BASE);
    pool
      .intercept({ path: new RegExp(KIS_PATH.INQUIRE_BALANCE.replace('/', '\\/')), method: 'GET' })
      .reply(200, makeBalanceReply([{ pdno: '005930', qty: 14 }]));
    // token endpoint (Approval)은 mock하지 않음 — getValidToken이 mock됨

    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const db = createTestDb();
    bootstrapSchema(db);
    const lotsRepo = new LotsRepo(db);
    // lots-repo에 14주 OPEN 차수 삽입
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });

    const { httpByEnv, credentialsRepo, auth } = makeAuthDeps('MOCK', BASE);
    const sync = new BalanceSync({
      getEnv: () => 'MOCK',
      getAccountId: () => 1,
      credentialsRepo,
      auth,
      httpByEnv,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    // balance-sync.fetched 로그가 찍혀야 함
    const fetchedLog = logger.entries.find((e) => e.message === 'balance-sync.fetched');
    expect(fetchedLog).toBeDefined();
    expect((fetchedLog?.payload as { positionCount: number }).positionCount).toBe(1);
  });

  it('lots qty === KIS qty → drift 로그 없음', async () => {
    const pool = agent.get(BASE);
    pool
      .intercept({ path: new RegExp(KIS_PATH.INQUIRE_BALANCE.replace('/', '\\/')), method: 'GET' })
      .reply(200, makeBalanceReply([{ pdno: '005930', qty: 14 }]));

    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const db = createTestDb();
    bootstrapSchema(db);
    const lotsRepo = new LotsRepo(db);
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });

    const { httpByEnv, credentialsRepo, auth } = makeAuthDeps('MOCK', BASE);
    const sync = new BalanceSync({
      getEnv: () => 'MOCK',
      getAccountId: () => 1,
      credentialsRepo,
      auth,
      httpByEnv,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    const driftLog = logger.entries.find((e) => e.message === 'balance-sync.drift_detected');
    expect(driftLog).toBeUndefined();
  });

  it('lots qty !== KIS qty → drift WARN 로그 발생', async () => {
    const pool = agent.get(BASE);
    // KIS는 20주, lots-repo는 14주 → 괴리 6주
    pool
      .intercept({ path: new RegExp(KIS_PATH.INQUIRE_BALANCE.replace('/', '\\/')), method: 'GET' })
      .reply(200, makeBalanceReply([{ pdno: '005930', qty: 20 }]));

    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const db = createTestDb();
    bootstrapSchema(db);
    const lotsRepo = new LotsRepo(db);
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });

    const { httpByEnv, credentialsRepo, auth } = makeAuthDeps('MOCK', BASE);
    const sync = new BalanceSync({
      getEnv: () => 'MOCK',
      getAccountId: () => 1,
      credentialsRepo,
      auth,
      httpByEnv,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    const driftLog = logger.entries.find((e) => e.message === 'balance-sync.drift_detected');
    expect(driftLog).toBeDefined();
    expect(driftLog?.level).toBe('WARN');
    const payload = driftLog?.payload as {
      pdno: string;
      lotsQty: number;
      kisQty: number;
      diff: number;
    };
    expect(payload.pdno).toBe('005930');
    expect(payload.lotsQty).toBe(14);
    expect(payload.kisQty).toBe(20);
    expect(payload.diff).toBe(6);
  });

  it('KIS 보유는 있는데 lot row가 없으면 OPEN 1차를 자동 복구한다', async () => {
    const pool = agent.get(BASE);
    pool
      .intercept({ path: new RegExp(KIS_PATH.INQUIRE_BALANCE.replace('/', '\\/')), method: 'GET' })
      .reply(200, makeBalanceReply([{ pdno: '452450', qty: 6 }]));

    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const db = createTestDb();
    bootstrapSchema(db);
    const lotsRepo = new LotsRepo(db);
    const { httpByEnv, credentialsRepo, auth } = makeAuthDeps('MOCK', BASE);
    const sync = new BalanceSync({
      getEnv: () => 'MOCK',
      getAccountId: () => 1,
      credentialsRepo,
      auth,
      httpByEnv,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    const recovered = lotsRepo.listRows(1, '452450');
    expect(recovered.isOk()).toBe(true);
    if (recovered.isErr()) throw new Error('rows failed');
    expect(recovered.value).toHaveLength(1);
    expect(recovered.value[0]).toMatchObject({
      nth: 1,
      pdno: '452450',
      qty: 6,
      status: 'OPEN',
    });
    expect(logger.entries.some((entry) => entry.message === 'balance-sync.orphan_recovered')).toBe(
      true,
    );
  });

  it('env null → poll skip (auth 호출 없음)', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const db = createTestDb();
    bootstrapSchema(db);
    const lotsRepo = new LotsRepo(db);
    const { httpByEnv, credentialsRepo, auth } = makeAuthDeps('MOCK', BASE);

    const sync = new BalanceSync({
      getEnv: () => null, // env 없음
      getAccountId: () => 1,
      credentialsRepo,
      auth,
      httpByEnv,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    expect(auth.getValidToken).not.toHaveBeenCalled();
    expect(logger.entries).toHaveLength(0);
  });

  it('accountId null → poll skip', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const db = createTestDb();
    bootstrapSchema(db);
    const lotsRepo = new LotsRepo(db);
    const { httpByEnv, credentialsRepo, auth } = makeAuthDeps('MOCK', BASE);

    const sync = new BalanceSync({
      getEnv: () => 'MOCK',
      getAccountId: () => null, // 계좌 없음
      credentialsRepo,
      auth,
      httpByEnv,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    expect(auth.getValidToken).not.toHaveBeenCalled();
  });

  it('dispose() 후 refresh() 호출 → no-op', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const db = createTestDb();
    bootstrapSchema(db);
    const lotsRepo = new LotsRepo(db);
    const { httpByEnv, credentialsRepo, auth } = makeAuthDeps('MOCK', BASE);

    const sync = new BalanceSync({
      getEnv: () => 'MOCK',
      getAccountId: () => 1,
      credentialsRepo,
      auth,
      httpByEnv,
      lotsRepo,
      logger,
      timer,
    });

    sync.dispose();
    await sync.refresh();

    expect(auth.getValidToken).not.toHaveBeenCalled();
  });
});
