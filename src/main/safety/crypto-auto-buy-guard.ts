import {
  applyCryptoStrategyAutoMode,
  type CryptoKrwMarketCode,
  CryptoKrwMarketCodeSchema,
  type CryptoStrategyProfile,
} from '@shared/contracts';
import type { EventLogger } from '../logging/event-logger';
import { AutoOrderBlockedError } from '../trading/auto-order-errors';
import type { CryptoProtectionGuard } from './crypto-protection-guard';
import { protectionErrorMessage } from './protection-error-message';
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

/**
 * RateGuard 가 마켓을 SELL_ONLY 로 자동 전환했을 때 호출되는 알림 sink.
 * bootstrap-deps 에서 OS Notification + IPC broadcast 로 연결.
 */
export interface CryptoAutoBuyGuardSellOnlySink {
  notify(input: {
    accountId: number;
    market: CryptoKrwMarketCode;
    count: number;
    windowSeconds: number;
  }): void;
}

export interface CryptoAutoBuyGuardOptions {
  logger: EventLogger;
  protectionGuard: CryptoProtectionGuard;
  rateGuardRepo: RateGuardRepo;
  repo: CryptoStrategyRepo;
  now?: () => Date;
  /** SELL_ONLY 자동 전환 성공 시 호출 — OS notification + renderer broadcast. */
  onSellOnly?: CryptoAutoBuyGuardSellOnlySink;
}

interface RateAttemptHistory {
  timestamps: number[];
}

export class CryptoAutoBuyGuard implements CryptoAutoBuyGuardPort {
  /**
   * 시도 직전(pre-attempt) 연속매수 카운터. 키: `${accountId}:${market}`.
   *
   * 역할이 다른 두 레이어가 공존한다:
   *  - 이 Map: 매수 시도 직전에 카운트하며, 임계 초과 시 해당 market 만 SELL_ONLY 로 전환 (surgical).
   *  - createRateGuard 의 history: 주문 체결 성공 후 recordBuy 로 카운트하며, 임계 초과 시
   *    account 전체의 master=false (nuclear). broker-agnostic 이라 도메스틱 HTS 와도 공유.
   *
   * 두 Map 은 시점·키·액션·blast-radius 가 모두 달라 중복이 아니다.
   */
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
      // OS Notification + renderer broadcast — log only 였던 회귀 차단.
      this.opts.onSellOnly?.notify({
        accountId: input.accountId,
        market: parsed.data,
        count,
        windowSeconds,
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
