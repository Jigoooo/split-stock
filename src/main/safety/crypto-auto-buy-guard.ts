import {
  applyCryptoStrategyAutoMode,
  type CryptoKrwMarketCode,
  CryptoKrwMarketCodeSchema,
  type CryptoStrategyProfile,
} from '@shared/contracts';
import type { EventLogger } from '../logging/event-logger';
import { AutoOrderBlockedError } from '../trading/auto-order-errors';
import type { CryptoProtectionGuard } from './crypto-protection-guard';
import type { ProtectionGuardError } from './protection-guard';
import type { RateGuardRepo } from './rate-guard';

export interface CryptoAutoBuyGuardInput {
  accountId: number;
  market: string;
  amountKrw: number;
  source: 'STRATEGY' | 'BOOSTER';
}

export interface CryptoAutoBuyGuardPort {
  assertAutoBuyAllowed(input: CryptoAutoBuyGuardInput): void;
}

export interface CryptoStrategyRepo {
  getStrategy(accountId: number, market: CryptoKrwMarketCode): CryptoStrategyProfile;
  upsertStrategy(
    accountId: number,
    market: CryptoKrwMarketCode,
    profile: CryptoStrategyProfile,
  ): CryptoStrategyProfile;
}

export interface CryptoAutoBuyGuardOptions {
  logger: EventLogger;
  protectionGuard: CryptoProtectionGuard;
  rateGuardRepo: RateGuardRepo;
  repo: CryptoStrategyRepo;
  now?: () => Date;
}

interface RateAttemptHistory {
  timestamps: number[];
}

export class CryptoAutoBuyGuard implements CryptoAutoBuyGuardPort {
  private readonly histories = new Map<string, RateAttemptHistory>();
  private readonly now: () => Date;

  constructor(private readonly opts: CryptoAutoBuyGuardOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  assertAutoBuyAllowed(input: CryptoAutoBuyGuardInput): void {
    this.assertProtectionLimits(input);
    this.assertRateGuard(input);
  }

  private assertProtectionLimits(input: CryptoAutoBuyGuardInput): void {
    const result = this.opts.protectionGuard.canBuyToday(
      input.accountId,
      input.market,
      input.amountKrw,
    );
    if (result.isOk()) return;

    const message = protectionErrorMessage(result.error);
    this.opts.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'crypto.auto-buy.protection.blocked',
      payload: {
        accountId: input.accountId,
        amountKrw: input.amountKrw,
        kind: result.error.kind,
        market: input.market,
        source: input.source,
      },
    });
    throw new AutoOrderBlockedError('AUTO_BUY_PROTECTION_LIMIT', message);
  }

  private assertRateGuard(input: CryptoAutoBuyGuardInput): void {
    const settings = this.opts.rateGuardRepo.getSettings(input.accountId);
    if (!settings.enabled) return;

    const now = this.now().getTime();
    const key = `${input.accountId}:${input.market}`;
    const windowMs = settings.windowSeconds * 1000;
    const cutoff = now - windowMs;
    const history = this.histories.get(key) ?? { timestamps: [] };
    const recent = history.timestamps.filter((ts) => ts >= cutoff);

    if (recent.length >= settings.maxCount) {
      this.switchMarketToSellOnly(input, recent.length + 1, settings.windowSeconds);
      this.histories.set(key, { timestamps: recent });
      throw new AutoOrderBlockedError(
        'AUTO_BUY_RATE_GUARD',
        `자동매수 차단: ${settings.windowSeconds}초 안에 자동매수 시도 ${recent.length + 1}회가 감지되었습니다.`,
      );
    }

    recent.push(now);
    this.histories.set(key, { timestamps: recent });
  }

  private switchMarketToSellOnly(
    input: CryptoAutoBuyGuardInput,
    count: number,
    windowSeconds: number,
  ): void {
    const parsed = CryptoKrwMarketCodeSchema.safeParse(input.market);
    if (!parsed.success) {
      this.opts.logger.log({
        level: 'ERROR',
        category: 'FSM',
        message: 'crypto.auto-buy.rate-guard.sell-only-failed',
        payload: {
          accountId: input.accountId,
          count,
          market: input.market,
          reason: 'invalid-market-code',
          source: input.source,
          windowSeconds,
        },
      });
      return;
    }
    try {
      const profile = this.opts.repo.getStrategy(input.accountId, parsed.data);
      const nextProfile = applyCryptoStrategyAutoMode(profile, 'SELL_ONLY');
      this.opts.repo.upsertStrategy(input.accountId, parsed.data, nextProfile);
      this.opts.logger.log({
        level: 'WARN',
        category: 'FSM',
        message: 'crypto.auto-buy.rate-guard.sell-only',
        payload: {
          accountId: input.accountId,
          count,
          market: input.market,
          source: input.source,
          windowSeconds,
        },
      });
    } catch (cause) {
      this.opts.logger.log({
        level: 'ERROR',
        category: 'FSM',
        message: 'crypto.auto-buy.rate-guard.sell-only-failed',
        payload: {
          accountId: input.accountId,
          count,
          market: input.market,
          reason: String(cause),
          source: input.source,
          windowSeconds,
        },
      });
    }
  }
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
