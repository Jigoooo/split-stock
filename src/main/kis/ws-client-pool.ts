/**
 * KisWsClientPool — 다계좌 KIS WebSocket 세션 관리.
 *
 * KIS 스펙 제약:
 *   - 한 approval_key 로 동시 두 WS 세션 연결 불가
 *   - 다계좌 환경: 계좌별 별도 (appKey, appSecret) → 별도 approval_key → 별도 WS 세션
 *   - 체결가/호가 합산 세션당 20개 (향후 60 확장 예정)
 *   - 체결통보(H0STCNI0/9): 계좌당 1개, AES256 암호화 (별도 task)
 *
 * 책임:
 *   - 계좌별 KisWsClient 인스턴스 lazy 생성·캐싱
 *   - approval_key 중복 사용 방지 (같은 appKey/appSecret 페어를 다른 계좌에 재할당 금지)
 *   - dispose 시 모든 세션 stop
 *
 * 비책임:
 *   - per-account 자격증명 조회 — 호출측이 (accountId, appKey, appSecret) 를 주입
 *   - approval_key 만료 갱신 — KisWsClient 가 reconnect 시 호출측이 재시도
 */
import type { AppEnv, KisError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { EventLogger } from '../logging/event-logger';
import { makeKisError } from './errors';
import type { KisHttpClient } from './http-client';
import { KisWsClient, type KisWsClientOptions, realTimer, type Timer } from './ws-client';

export interface KisWsClientPoolOptions {
  env: AppEnv;
  http: KisHttpClient;
  factory: KisWsClientOptions['factory'];
  logger: EventLogger;
  timer?: Timer;
  /** 계좌별 KisWsClient 추가 옵션 (heartbeat/backoff/maxSubs 등). */
  clientOptions?: Omit<KisWsClientOptions, 'env' | 'http' | 'factory' | 'logger' | 'timer'>;
}

export interface KisWsClientPool {
  /** accountId 의 KisWsClient 가 없으면 생성 후 start, 있으면 그대로 반환. */
  getOrCreate(
    accountId: number,
    appKey: string,
    appSecret: string,
  ): Promise<Result<KisWsClient, KisError>>;
  /** 이미 등록된 계좌 클라이언트 조회 (없으면 null). */
  get(accountId: number): KisWsClient | null;
  /** 계좌 단일 세션 종료 + 풀에서 제거. */
  remove(accountId: number): void;
  /** 모든 세션 stop + 풀 비우기. */
  dispose(): void;
  /** 등록된 계좌 목록 — 디버깅/모니터링용. */
  listAccounts(): number[];
}

interface PoolEntry {
  client: KisWsClient;
  appKey: string;
}

/**
 * 다계좌 WS 세션 풀의 기본 구현.
 *
 * 동시성:
 *   - getOrCreate 동시 호출 시 같은 accountId 에 대해 1번만 client 생성
 *   - approval_key 중복 사용 방지: 같은 appKey 가 다른 accountId 로 등록되어 있으면 VALIDATION 에러
 */
export function createKisWsClientPool(opts: KisWsClientPoolOptions): KisWsClientPool {
  const entries = new Map<number, PoolEntry>();
  /** appKey → accountId 역인덱스 — 같은 appKey 중복 사용 검출. */
  const appKeyOwner = new Map<string, number>();
  /** accountId → in-flight start Promise — getOrCreate 의 동시 호출 직렬화. */
  const inFlight = new Map<number, Promise<Result<KisWsClient, KisError>>>();

  const baseOptions = opts.clientOptions ?? {};

  function buildOptions(): KisWsClientOptions {
    const merged: KisWsClientOptions = {
      env: opts.env,
      http: opts.http,
      factory: opts.factory,
      logger: opts.logger,
      timer: opts.timer ?? realTimer,
      ...baseOptions,
    };
    return merged;
  }

  async function getOrCreate(
    accountId: number,
    appKey: string,
    appSecret: string,
  ): Promise<Result<KisWsClient, KisError>> {
    const cached = entries.get(accountId);
    if (cached) {
      // 같은 계좌 — appKey 일치 확인. 변경됐으면 VALIDATION (호출측이 remove 후 재시도).
      if (cached.appKey !== appKey) {
        return err(
          makeKisError('VALIDATION', 'ws-pool: appKey 변경 감지 — remove 후 재등록 필요', {
            cause: { accountId },
          }),
        );
      }
      return ok(cached.client);
    }

    const ownedBy = appKeyOwner.get(appKey);
    if (ownedBy !== undefined && ownedBy !== accountId) {
      return err(
        makeKisError('VALIDATION', 'ws-pool: 같은 appKey 가 다른 계좌에 이미 사용 중', {
          cause: { conflictAccountId: ownedBy, requestedAccountId: accountId },
        }),
      );
    }

    const existingFlight = inFlight.get(accountId);
    if (existingFlight) return existingFlight;

    const flight = (async (): Promise<Result<KisWsClient, KisError>> => {
      const client = new KisWsClient(buildOptions());
      const r = await client.start(appKey, appSecret);
      if (r.isErr()) {
        opts.logger.log({
          level: 'ERROR',
          category: 'WS',
          message: 'ws-pool.start_failed',
          payload: { accountId, kind: r.error.kind, msg: r.error.msg },
        });
        return err(r.error);
      }
      entries.set(accountId, { client, appKey });
      appKeyOwner.set(appKey, accountId);
      opts.logger.log({
        level: 'INFO',
        category: 'WS',
        message: 'ws-pool.client_created',
        payload: { accountId },
      });
      return ok(client);
    })();

    inFlight.set(accountId, flight);
    try {
      return await flight;
    } finally {
      inFlight.delete(accountId);
    }
  }

  function get(accountId: number): KisWsClient | null {
    return entries.get(accountId)?.client ?? null;
  }

  function remove(accountId: number): void {
    const entry = entries.get(accountId);
    if (!entry) return;
    try {
      entry.client.stop();
    } catch {
      // swallow — stop 은 보통 안전하지만 방어적으로
    }
    entries.delete(accountId);
    appKeyOwner.delete(entry.appKey);
    opts.logger.log({
      level: 'INFO',
      category: 'WS',
      message: 'ws-pool.client_removed',
      payload: { accountId },
    });
  }

  function dispose(): void {
    for (const [accountId] of Array.from(entries)) remove(accountId);
  }

  function listAccounts(): number[] {
    return Array.from(entries.keys());
  }

  return { getOrCreate, get, remove, dispose, listAccounts };
}
