import type { AppEnv } from '@shared/contracts';
import { getRegularMarketSessionKst } from '@shared/trading/market-session';
import type { AuthService } from '../kis/auth';
import { inquireDomesticHoliday } from '../kis/domestic-stock';
import type { KisHttpClient } from '../kis/http-client';
import type { EventLogger } from '../logging/event-logger';
import type { CredentialsRepo } from '../security/credentials-repo';
import { AutoOrderBlockedError } from './auto-order-errors';

export interface AutoOrderGuardInput {
  accountId: number;
  pdno: string;
  side: 'BUY' | 'SELL';
  source: 'STRATEGY' | 'WATCH';
}

export interface AutoOrderMarketGuard {
  assertAutoOrderAllowed(input: AutoOrderGuardInput): Promise<void>;
}

interface HolidayCacheEntry {
  date: string;
  env: AppEnv;
  openDay: boolean;
  checkedAt: number;
}

export interface MarketSessionGuardOptions {
  auth: AuthService;
  credentialsRepo: CredentialsRepo;
  getCurrentEnv: () => AppEnv | null;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  logger: EventLogger;
  now?: () => Date;
}

export class MarketSessionGuard implements AutoOrderMarketGuard {
  private readonly holidayCache = new Map<string, HolidayCacheEntry>();
  private readonly now: () => Date;

  constructor(private readonly opts: MarketSessionGuardOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  async assertAutoOrderAllowed(input: AutoOrderGuardInput): Promise<void> {
    const session = getRegularMarketSessionKst(this.now());
    if (session.isWeekend) {
      throw new AutoOrderBlockedError(
        'MARKET_WEEKEND',
        `자동주문 차단: 주말은 국내 정규장 개장일이 아닙니다. date=${session.date}`,
      );
    }
    if (!session.isRegularHours) {
      throw new AutoOrderBlockedError(
        'MARKET_TIME_CLOSED',
        `자동주문 차단: 국내 정규장 시간이 아닙니다. date=${session.date}`,
      );
    }

    const env = this.opts.getCurrentEnv();
    if (!env) {
      throw new AutoOrderBlockedError('MARKET_SESSION_UNKNOWN', '자동주문 차단: 환경 미선택');
    }

    const openDay = await this.isOpenDay({
      accountId: input.accountId,
      date: session.date,
      env,
      pdno: input.pdno,
    });
    if (!openDay) {
      throw new AutoOrderBlockedError(
        'MARKET_CLOSED_DAY',
        `자동주문 차단: KIS 국내휴장일조회 기준 개장일이 아닙니다. date=${session.date}`,
      );
    }
  }

  private async isOpenDay(input: {
    accountId: number;
    date: string;
    env: AppEnv;
    pdno: string;
  }): Promise<boolean> {
    const cacheKey = `${input.env}:${input.date}`;
    const cached = this.holidayCache.get(cacheKey);
    if (cached) return cached.openDay;

    const credResult = this.opts.credentialsRepo.loadCredentials(input.accountId);
    if (credResult.isErr() || !credResult.value) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'auto-order.market-session.unknown',
        payload: {
          accountId: input.accountId,
          date: input.date,
          env: input.env,
          pdno: input.pdno,
          reason: credResult.isErr() ? credResult.error.kind : 'CREDENTIALS_MISSING',
        },
      });
      throw new AutoOrderBlockedError(
        'MARKET_SESSION_UNKNOWN',
        '자동주문 차단: 국내 개장일 확인을 위한 자격증명이 없습니다.',
      );
    }

    const cred = credResult.value;
    const tokenResult = await this.opts.auth.getValidToken(input.env, cred.appKey, cred.appSecret);
    if (tokenResult.isErr()) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'auto-order.market-session.unknown',
        payload: {
          accountId: input.accountId,
          date: input.date,
          env: input.env,
          kind: tokenResult.error.kind,
          msg: tokenResult.error.msg,
          pdno: input.pdno,
        },
      });
      throw new AutoOrderBlockedError(
        'MARKET_SESSION_UNKNOWN',
        `자동주문 차단: 국내 개장일 확인 실패(${tokenResult.error.kind})`,
      );
    }

    const holidayResult = await inquireDomesticHoliday(
      {
        http: this.opts.httpByEnv[input.env],
        env: input.env,
        token: tokenResult.value.token,
        appKey: cred.appKey,
        appSecret: cred.appSecret,
      },
      input.date,
    );
    if (holidayResult.isErr()) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'auto-order.market-session.unknown',
        payload: {
          accountId: input.accountId,
          date: input.date,
          env: input.env,
          kind: holidayResult.error.kind,
          msg: holidayResult.error.msg,
          pdno: input.pdno,
        },
      });
      throw new AutoOrderBlockedError(
        'MARKET_SESSION_UNKNOWN',
        `자동주문 차단: 국내 개장일 확인 실패(${holidayResult.error.kind})`,
      );
    }

    const row =
      holidayResult.value.find((item) => item.date === input.date) ?? holidayResult.value[0];
    if (!row) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'auto-order.market-session.unknown',
        payload: {
          accountId: input.accountId,
          date: input.date,
          env: input.env,
          pdno: input.pdno,
          reason: 'HOLIDAY_ROW_MISSING',
        },
      });
      throw new AutoOrderBlockedError(
        'MARKET_SESSION_UNKNOWN',
        `자동주문 차단: 국내 개장일 응답이 비어 있습니다. date=${input.date}`,
      );
    }

    const entry: HolidayCacheEntry = {
      date: input.date,
      env: input.env,
      openDay: row.openDay,
      checkedAt: Date.now(),
    };
    this.holidayCache.set(cacheKey, entry);
    this.opts.logger.log({
      level: 'INFO',
      category: 'ORDER',
      message: 'auto-order.market-session.cached',
      payload: {
        date: entry.date,
        env: entry.env,
        openDay: entry.openDay,
      },
    });
    return entry.openDay;
  }
}
