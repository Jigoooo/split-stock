import type { AppEnv } from '@shared/contracts';
import type { AuthService } from '../kis/auth';
import { inquireBalance } from '../kis/domestic-stock';
import type { KisHttpClient } from '../kis/http-client';
import type { Timer } from '../kis/ws-client';
import { realTimer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';
import type { CredentialsRepo } from '../security/credentials-repo';
import type { LotsRepo } from './lots-repo';

export interface BalanceSyncOptions {
  /** 현재 활성 env를 lazy하게 얻는 getter. null이면 credentials 없으므로 skip. */
  getEnv: () => AppEnv | null;
  /** 현재 활성 accountId를 lazy하게 얻는 getter. null이면 skip. */
  getAccountId: () => number | null;
  credentialsRepo: CredentialsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  lotsRepo: LotsRepo;
  logger: EventLogger;
  timer?: Timer;
  /** 주기적 polling 간격 ms (기본 30초). */
  intervalMs?: number;
}

/**
 * KIS 잔고 주기 polling + 체결통보(CNI) 즉시 갱신 지원 클래스.
 *
 * 역할:
 * - 30초(기본) 주기로 inquireBalance를 호출하여 KIS 서버 잔고를 pull.
 * - lots-repo의 OPEN 차수 qty 합과 KIS 응답 qty 간 괴리 발생 시 WARN 로그.
 *   (자동 조정은 하지 않음 — 관측만. 조정은 비즈니스 판단이 필요.)
 * - `refresh()` 메서드로 즉시 갱신 강제 가능.
 *   (W1-7 Phase B: CNI AES 복호화 구현 이후 체결통보 수신 시 호출 예정.)
 * - per-account 격리: getAccountId()가 null이면 동작 건너뜀.
 *
 * 주의: env/credentials를 생성 시점이 아니라 매 poll 마다 lazy하게 읽음.
 * env 전환 후에도 인스턴스 재생성 없이 자동으로 새 환경 사용.
 */
export class BalanceSync {
  private readonly timer: Timer;
  private readonly intervalMs: number;
  private pollHandle: { clear: () => void } | null = null;
  private disposed = false;
  /** 현재 폴링 중인지 여부 — 중복 실행 방지. */
  private running = false;

  constructor(private readonly opts: BalanceSyncOptions) {
    this.timer = opts.timer ?? realTimer;
    this.intervalMs = opts.intervalMs ?? 30_000;
  }

  /** 주기 polling 시작. 이미 시작됐으면 no-op. */
  start(): void {
    if (this.disposed || this.pollHandle !== null) return;
    this.schedulePoll();
  }

  /** 주기 polling 중단. */
  stop(): void {
    if (this.pollHandle) {
      this.pollHandle.clear();
      this.pollHandle = null;
    }
  }

  /** dispose — stop + 이후 모든 동작 비활성화. */
  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  /**
   * 즉시 잔고 갱신 — 폴링 사이클과 무관하게 강제 pull.
   * CNI 체결통보 수신 시 호출 예정 (W1-7 Phase B: AES 복호화 구현 후).
   */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    await this.poll();
  }

  private schedulePoll(): void {
    if (this.disposed) return;
    this.pollHandle = this.timer.setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.running) return;
    this.running = true;
    try {
      await this.doPoll();
    } finally {
      this.running = false;
    }
  }

  private async doPoll(): Promise<void> {
    const env = this.opts.getEnv();
    if (!env) return; // env 미선택 시 조용히 skip

    const accountId = this.opts.getAccountId();
    if (accountId === null) return; // 활성 계좌 없으면 skip

    const credResult = this.opts.credentialsRepo.loadCredentialsByEnv(env);
    if (credResult.isErr() || !credResult.value) return; // credentials 없으면 skip
    const cred = credResult.value;

    const tokenResult = await this.opts.auth.getValidToken(env, cred.appKey, cred.appSecret);
    if (tokenResult.isErr()) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'BALANCE',
        message: 'balance-sync.token_error',
        payload: { accountId, env, kind: tokenResult.error.kind },
      });
      return;
    }

    const balanceResult = await inquireBalance({
      http: this.opts.httpByEnv[env],
      env,
      token: tokenResult.value.token,
      appKey: cred.appKey,
      appSecret: cred.appSecret,
      accountNo8: cred.accountNo8,
      accountProdCd: cred.accountProdCd,
    });

    if (balanceResult.isErr()) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'BALANCE',
        message: 'balance-sync.fetch_error',
        payload: { accountId, env, kind: balanceResult.error.kind, msg: balanceResult.error.msg },
      });
      return;
    }

    this.opts.logger.log({
      level: 'INFO',
      category: 'BALANCE',
      message: 'balance-sync.fetched',
      payload: {
        accountId,
        env,
        positionCount: balanceResult.value.positions.length,
        // 보안: 정확 금액 대신 bucket 마스킹 — 잔고 노출 최소화 (Wave 1 verifier H2).
        depositBucket: bucketAmount(balanceResult.value.deposit),
        totalEvalBucket: bucketAmount(balanceResult.value.totalEval),
      },
    });

    // lots-repo OPEN 차수와 KIS 잔고 qty 괴리 감지
    this.detectDrift(accountId, balanceResult.value.positions);
  }

  /**
   * lots-repo의 OPEN 차수 qty 합과 KIS 잔고 qty 비교.
   * 차이가 있으면 WARN 로그. 자동 조정은 하지 않음.
   */
  private detectDrift(accountId: number, kisPositions: Array<{ code: string; qty: number }>): void {
    // KIS 잔고 기준 pdno → qty 맵
    const kisQtyByPdno = new Map<string, number>();
    for (const pos of kisPositions) {
      if (pos.qty > 0) kisQtyByPdno.set(pos.code, pos.qty);
    }

    // lots-repo에서 KIS 보유 종목의 OPEN 차수 qty 합 조회
    for (const [pdno, kisQty] of kisQtyByPdno) {
      const snapResult = this.opts.lotsRepo.snapshot(accountId, pdno);
      if (snapResult.isErr()) continue;

      const lotsQty = snapResult.value.lots
        .filter((l) => l.status === 'OPEN' || l.status === 'BUYING')
        .reduce((sum, l) => sum + l.qty, 0);

      if (lotsQty !== kisQty) {
        this.opts.logger.log({
          level: 'WARN',
          category: 'BALANCE',
          message: 'balance-sync.drift_detected',
          payload: { accountId, pdno, lotsQty, kisQty, diff: kisQty - lotsQty },
        });
      }
    }

    // lots-repo에는 있지만 KIS 잔고에 없는 종목 (0주 / 매도 완료 후 미반영 케이스)
    // → 현재 구현에서는 별도 처리 없음 (SOLD 상태 lot은 정상이므로 노이즈 발생 가능)
  }
}

/**
 * 보안: 잔고 정확 금액 대신 자릿수 bucket으로 마스킹.
 * 운영 로그/Sentry에 평문 자산 규모가 흘러가는 것을 방지하면서도 자릿수 추세는 관측 가능.
 *
 * - 0~99,999원 → '<10만'
 * - ~999,999 → '<100만'
 * - ~9,999,999 → '<1천만'
 * - ~99,999,999 → '<1억'
 * - ~999,999,999 → '<10억'
 * - 1,000,000,000+ → '>=10억'
 */
function bucketAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return 'unknown';
  if (amount < 100_000) return '<10만';
  if (amount < 1_000_000) return '<100만';
  if (amount < 10_000_000) return '<1천만';
  if (amount < 100_000_000) return '<1억';
  if (amount < 1_000_000_000) return '<10억';
  return '>=10억';
}
