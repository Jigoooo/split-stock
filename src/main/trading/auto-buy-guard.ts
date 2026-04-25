import { applyStrategyAutoMode } from '@shared/contracts';
import type { EventLogger } from '../logging/event-logger';
import type { ProtectionGuard, ProtectionGuardError } from '../safety/protection-guard';
import type { RateGuardRepo } from '../safety/rate-guard';
import { isTradeAllowedAt, type TimeWindowRepo } from '../safety/time-window';
import { AutoOrderBlockedError } from './auto-order-errors';
import type { StrategyRepo } from './strategy-repo';

export interface AutoBuyGuardInput {
  accountId: number;
  amountKrw: number;
  pdno: string;
  source: 'STRATEGY' | 'WATCH';
}

export interface AutoBuyGuardOptions {
  logger: EventLogger;
  protectionGuard: ProtectionGuard;
  rateGuardRepo: RateGuardRepo;
  strategyRepo: StrategyRepo;
  timeWindowRepo: TimeWindowRepo;
  now?: () => Date;
}

interface RateAttemptHistory {
  timestamps: number[];
}

export interface AutoBuyGuardPort {
  assertAutoBuyAllowed(input: AutoBuyGuardInput): Promise<void> | void;
}

export class AutoBuyGuard implements AutoBuyGuardPort {
  private readonly histories = new Map<string, RateAttemptHistory>();
  private readonly now: () => Date;

  constructor(private readonly opts: AutoBuyGuardOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  assertAutoBuyAllowed(input: AutoBuyGuardInput): void {
    this.assertProtectionLimits(input);
    this.assertTimeWindow(input);
    this.assertRateGuard(input);
  }

  private assertProtectionLimits(input: AutoBuyGuardInput): void {
    const result = this.opts.protectionGuard.canBuyToday(
      input.accountId,
      input.pdno,
      input.amountKrw,
    );
    if (result.isOk()) return;

    const message = protectionErrorMessage(result.error);
    this.opts.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'auto-buy.protection.blocked',
      payload: {
        accountId: input.accountId,
        amountKrw: input.amountKrw,
        kind: result.error.kind,
        pdno: input.pdno,
        source: input.source,
      },
    });
    throw new AutoOrderBlockedError('AUTO_BUY_PROTECTION_LIMIT', message);
  }

  private assertTimeWindow(input: AutoBuyGuardInput): void {
    const minute = kstMinuteOfDay(this.now());
    if (isTradeAllowedAt(input.accountId, 'BUY', minute, this.opts.timeWindowRepo)) return;

    this.opts.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'auto-buy.time-window.blocked',
      payload: {
        accountId: input.accountId,
        minute,
        pdno: input.pdno,
        source: input.source,
      },
    });
    throw new AutoOrderBlockedError(
      'AUTO_BUY_TIME_WINDOW',
      `자동매수 차단: 매수 허용 시간대가 아닙니다. minute=${minute}`,
    );
  }

  private assertRateGuard(input: AutoBuyGuardInput): void {
    const settings = this.opts.rateGuardRepo.getSettings(input.accountId);
    if (!settings.enabled) return;

    const now = this.now().getTime();
    const key = `${input.accountId}:${input.pdno}`;
    const windowMs = settings.windowSeconds * 1000;
    const cutoff = now - windowMs;
    const history = this.histories.get(key) ?? { timestamps: [] };
    const recent = history.timestamps.filter((ts) => ts >= cutoff);

    if (recent.length >= settings.maxCount) {
      this.switchSymbolToSellOnly(input, recent.length + 1, settings.windowSeconds);
      this.histories.set(key, { timestamps: recent });
      throw new AutoOrderBlockedError(
        'AUTO_BUY_RATE_GUARD',
        `자동매수 차단: ${settings.windowSeconds}초 안에 자동매수 시도 ${recent.length + 1}회가 감지되었습니다.`,
      );
    }

    recent.push(now);
    this.histories.set(key, { timestamps: recent });
  }

  private switchSymbolToSellOnly(
    input: AutoBuyGuardInput,
    count: number,
    windowSeconds: number,
  ): void {
    const seeded = this.opts.strategyRepo.ensureSeededActive(input.accountId, input.pdno);
    if (seeded.isErr()) {
      this.opts.logger.log({
        level: 'ERROR',
        category: 'FSM',
        message: 'auto-buy.rate-guard.sell-only-failed',
        payload: {
          accountId: input.accountId,
          count,
          pdno: input.pdno,
          reason: seeded.error.kind,
          source: input.source,
          windowSeconds,
        },
      });
      return;
    }

    const nextProfile = applyStrategyAutoMode(seeded.value.profile, 'SELL_ONLY');
    const saved = this.opts.strategyRepo.setActive(input.accountId, input.pdno, nextProfile);
    this.opts.logger.log({
      level: saved.isOk() ? 'WARN' : 'ERROR',
      category: 'FSM',
      message: saved.isOk()
        ? 'auto-buy.rate-guard.sell-only'
        : 'auto-buy.rate-guard.sell-only-failed',
      payload: {
        accountId: input.accountId,
        count,
        pdno: input.pdno,
        reason: saved.isErr() ? saved.error.kind : undefined,
        source: input.source,
        windowSeconds,
      },
    });
  }
}

function kstMinuteOfDay(now: Date): number {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

function protectionErrorMessage(error: ProtectionGuardError): string {
  switch (error.kind) {
    case 'LIMIT_PER_SYMBOL_DAILY_BUYS':
      return `자동매수 차단: 종목별 1일 최대 매수 횟수(${error.max}회)에 도달했습니다.`;
    case 'LIMIT_DAILY_TOTAL_COUNT':
      return `자동매수 차단: 1일 총 최대 매수 건수(${error.max}회)에 도달했습니다.`;
    case 'LIMIT_DAILY_TOTAL_AMOUNT':
      return `자동매수 차단: 1일 총 최대 매수 금액(${error.maxKrw.toLocaleString('ko-KR')}원)을 초과합니다.`;
    case 'LIMIT_ACCOUNT_TOTAL_AMOUNT':
      return `자동매수 차단: 계좌 총 최대 매수 금액(${error.maxKrw.toLocaleString('ko-KR')}원)을 초과합니다.`;
    case 'DB_ERROR':
      return '자동매수 차단: 보호 한도 확인 중 오류가 발생했습니다.';
  }
}
