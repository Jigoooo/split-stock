import type { TradingDayVerdict } from '@shared/contracts';
import { getRegularMarketSessionKst } from '@shared/trading/market-session';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { EventLogger } from '../logging/event-logger';
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
  verdict: TradingDayVerdict;
  checkedAt: number;
}

export interface MarketSessionGuardOptions {
  /**
   * 활성 broker 를 lazy 로 얻는 getter. 미준비 시 null →
   * MARKET_SESSION_UNKNOWN 으로 차단.
   */
  getBroker: () => BrokerPort | null;
  logger: EventLogger;
  now?: () => Date;
}

/**
 * 자동주문(전략/감시) 시 정규장 시간 + KRX 개장일 가드.
 *
 * KIS/Kiwoom 모두 BrokerPort.getTradingDayStatus 의 공통 KRX verdict 를 사용한다.
 * 휴장/시간외/확인불가면 broker 주문 API 호출 전에 차단한다.
 */
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

    const broker = this.opts.getBroker();
    if (!broker) {
      throw new AutoOrderBlockedError(
        'MARKET_SESSION_UNKNOWN',
        '자동주문 차단: broker 미준비 (env/자격증명/계좌 미설정)',
      );
    }

    const verdict = await this.getTradingDayVerdict(broker, {
      accountId: input.accountId,
      date: session.date,
      pdno: input.pdno,
    });
    if (verdict.source === 'UNKNOWN' || verdict.stale) {
      throw new AutoOrderBlockedError(
        'MARKET_SESSION_UNKNOWN',
        `자동주문 차단: 거래일 확인 불가(${verdict.reason})`,
      );
    }
    if (!verdict.openDay) {
      throw new AutoOrderBlockedError(
        'MARKET_CLOSED_DAY',
        `자동주문 차단: 거래일 확인 결과 개장일이 아닙니다. date=${session.date}`,
      );
    }
    if (!isWithinTradingWindow(verdict, session.minutes)) {
      throw new AutoOrderBlockedError(
        'MARKET_TIME_CLOSED',
        `자동주문 차단: 국내 정규장 시간이 아닙니다. date=${session.date}`,
      );
    }
  }

  private async getTradingDayVerdict(
    broker: BrokerPort,
    input: { accountId: number; date: string; pdno: string },
  ): Promise<TradingDayVerdict> {
    const cacheKey = `${broker.brokerId}:${broker.env}:${input.date}`;
    const cached = this.holidayCache.get(cacheKey);
    if (cached) return cached.verdict;

    const dateAsDate = parseYyyymmdd(input.date);
    const result = await broker.getTradingDayStatus(dateAsDate);
    if (result.isErr()) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'auto-order.market-session.unknown',
        payload: {
          accountId: input.accountId,
          date: input.date,
          brokerId: broker.brokerId,
          env: broker.env,
          kind: result.error.kind,
          msg: result.error.msg,
          pdno: input.pdno,
        },
      });
      throw new AutoOrderBlockedError(
        'MARKET_SESSION_UNKNOWN',
        `자동주문 차단: 거래일 확인 실패(${result.error.kind})`,
      );
    }

    const entry: HolidayCacheEntry = {
      date: input.date,
      verdict: result.value,
      checkedAt: Date.now(),
    };
    this.holidayCache.set(cacheKey, entry);
    this.opts.logger.log({
      level: 'INFO',
      category: 'ORDER',
      message: 'auto-order.market-session.cached',
      payload: {
        date: entry.date,
        brokerId: broker.brokerId,
        env: broker.env,
        openDay: entry.verdict.openDay,
        source: entry.verdict.source,
        reason: entry.verdict.reason,
        stale: entry.verdict.stale,
        kisVerified: entry.verdict.kisVerified ?? null,
      },
    });
    return entry.verdict;
  }
}

function parseYyyymmdd(yyyymmdd: string): Date {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(y, m, d);
}

function isWithinTradingWindow(verdict: TradingDayVerdict, minutes: number): boolean {
  if (!verdict.openDay) return false;
  if (verdict.openMinute === null || verdict.closeMinute === null) return false;
  return minutes >= verdict.openMinute && minutes <= verdict.closeMinute;
}
