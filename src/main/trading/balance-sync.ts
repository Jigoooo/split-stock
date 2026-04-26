import type { Holding } from '@shared/contracts';
import type { Timer } from '../brokers/core/types';
import { realTimer } from '../brokers/core/types';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { EventLogger } from '../logging/event-logger';
import type { LotsRepo } from './lots-repo';

export interface BalanceSyncOptions {
  /**
   * 현재 활성 BrokerPort 를 lazy 로 얻는 getter. null 이면 broker 미준비
   * (env/credentials/account 미설정 등) → poll skip.
   */
  getBroker: () => BrokerPort | null;
  /** 현재 활성 accountId를 lazy하게 얻는 getter. null이면 skip. */
  getAccountId: () => number | null;
  lotsRepo: LotsRepo;
  logger: EventLogger;
  timer?: Timer;
  /** 주기적 polling 간격 ms (기본 30초). */
  intervalMs?: number;
}

/**
 * Broker 잔고 주기 polling + 체결통보(CNI) 즉시 갱신 지원 클래스.
 *
 * 역할:
 * - 30초(기본) 주기로 BrokerPort.inquireBalance 를 호출.
 * - lots-repo의 OPEN 차수 qty 합과 broker 응답 qty 간 괴리 발생 시 WARN 로그.
 *   (자동 조정은 하지 않음 — 관측만. 조정은 비즈니스 판단이 필요.)
 * - `refresh()` 메서드로 즉시 갱신 강제 가능.
 *   (Phase B: CNI AES 복호화 구현 이후 체결통보 수신 시 호출 예정.)
 * - per-account 격리: getAccountId()가 null이면 동작 건너뜀.
 *
 * 주의: broker 를 생성 시점이 아니라 매 poll 마다 lazy 하게 읽음.
 * env/계좌 전환 후에도 인스턴스 재생성 없이 자동으로 새 broker 사용.
 *
 * Stage 4f: KIS 직접 의존(httpByEnv/auth/credentialsRepo/inquireBalance) →
 * BrokerPort.inquireBalance 추상. Kiwoom 활성 시에도 동일 polling 로직 재사용.
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
    const accountId = this.opts.getAccountId();
    if (accountId === null) return;

    const broker = this.opts.getBroker();
    if (!broker) return;

    const balanceResult = await broker.inquireBalance();

    if (balanceResult.isErr()) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'BALANCE',
        message: 'balance-sync.fetch_error',
        payload: {
          accountId,
          brokerId: broker.brokerId,
          env: broker.env,
          kind: balanceResult.error.kind,
          msg: balanceResult.error.msg,
        },
      });
      return;
    }

    this.opts.logger.log({
      level: 'INFO',
      category: 'BALANCE',
      message: 'balance-sync.fetched',
      payload: {
        accountId,
        brokerId: broker.brokerId,
        env: broker.env,
        positionCount: balanceResult.value.positions.length,
        depositBucket: bucketAmount(balanceResult.value.deposit),
        totalEvalBucket: bucketAmount(balanceResult.value.totalEval),
      },
    });

    this.detectDrift(accountId, balanceResult.value.positions);
  }

  private detectDrift(accountId: number, holdings: Holding[]): void {
    const positionBySymbol = new Map<string, { qty: number; avgPrice: number }>();
    for (const h of holdings) {
      if (h.qty > 0) positionBySymbol.set(h.symbol, { qty: h.qty, avgPrice: h.avgPrice });
    }

    for (const [pdno, position] of positionBySymbol) {
      const snapResult = this.opts.lotsRepo.snapshot(accountId, pdno);
      if (snapResult.isErr()) continue;

      const lotsQty = snapResult.value.lots
        .filter((l) => l.status === 'OPEN' || l.status === 'BUYING')
        .reduce((sum, l) => sum + l.qty, 0);

      if (lotsQty === 0) {
        const rows = this.opts.lotsRepo.listRows(accountId, pdno);
        if (rows.isOk() && rows.value.length === 0) {
          const price = Math.max(1, position.avgPrice);
          const inserted = this.opts.lotsRepo.insertLot({
            accountId,
            pdno,
            nth: 1,
            buyPrice: price,
            qty: position.qty,
            amountKrw: price * position.qty,
            status: 'OPEN',
            boughtAt: new Date(),
          });
          if (inserted.isOk()) {
            this.opts.logger.log({
              level: 'WARN',
              category: 'BALANCE',
              message: 'balance-sync.orphan_recovered',
              payload: {
                accountId,
                pdno,
                qty: position.qty,
                avgPrice: price,
                nth: 1,
              },
            });
            continue;
          }
        }
      }

      const kisQty = position.qty;
      if (lotsQty !== kisQty) {
        this.opts.logger.log({
          level: 'WARN',
          category: 'BALANCE',
          message: 'balance-sync.drift_detected',
          payload: { accountId, pdno, lotsQty, kisQty, diff: kisQty - lotsQty },
        });
      }
    }
  }
}

function bucketAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return 'unknown';
  if (amount < 100_000) return '<10만';
  if (amount < 1_000_000) return '<100만';
  if (amount < 10_000_000) return '<1천만';
  if (amount < 100_000_000) return '<1억';
  if (amount < 1_000_000_000) return '<10억';
  return '>=10억';
}
