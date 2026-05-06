import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cryptoOrders, lots } from '../db/schema';
import type { ProtectionLimitsRepo } from './protection-limits-repo';

const UPBIT_BROKER = 'UPBIT';

/**
 * 코인 자동매매 보호 한도 가드 — placeOrder 진입 전 검사. (RALPLAN P6 A3)
 *
 * stock ProtectionGuard 와 동일 정책을 cryptoOrders/cryptoAutoLots 테이블 기반으로 적용.
 * protection_limits 테이블은 broker-agnostic (계좌 단위 1행) 이므로 그대로 재사용.
 *
 * 검사 순서:
 *   1. perSymbolDailyMaxBuys  — 오늘 해당 market 매수 주문 수 (state in 'wait','watch','done')
 *   2. dailyTotalMaxCount     — 오늘 전체 KRW 마켓 매수 주문 수
 *   3. dailyTotalMaxAmount    — 오늘 전체 매수 금액 합산 (price * volume 또는 price)
 *   4. accountTotalMaxAmount  — 현재 open lot 의 allocated_krw 총합
 *
 * NULL 한도는 "무제한" 처리 (skip).
 */
export interface CryptoProtectionGuardVerdict {
  ok: boolean;
  reason?: string;
}

export class CryptoProtectionGuard {
  constructor(
    private readonly db: Db,
    private readonly limitsRepo: ProtectionLimitsRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  canBuyToday(accountId: number, market: string, amountKrw: number): CryptoProtectionGuardVerdict {
    const limitsResult = this.limitsRepo.get(accountId);
    if (limitsResult.isErr()) {
      return { ok: false, reason: '보호 한도 조회 실패' };
    }
    const limits = limitsResult.value;
    if (!limits) return { ok: true };

    const today = kstMidnightUtc(this.now());

    try {
      if (limits.perSymbolDailyMaxBuysEnabled && limits.perSymbolDailyMaxBuys !== null) {
        const rows = this.db
          .select({ id: cryptoOrders.id })
          .from(cryptoOrders)
          .where(
            and(
              eq(cryptoOrders.accountId, accountId),
              eq(cryptoOrders.market, market),
              eq(cryptoOrders.side, 'bid'),
              gte(cryptoOrders.placedAt, today),
              inArray(cryptoOrders.state, ['wait', 'watch', 'done']),
            ),
          )
          .all();
        if (rows.length >= limits.perSymbolDailyMaxBuys) {
          return {
            ok: false,
            reason: `종목 일일 매수 횟수 한도 초과 (${rows.length}/${limits.perSymbolDailyMaxBuys})`,
          };
        }
      }

      if (limits.dailyTotalMaxCountEnabled && limits.dailyTotalMaxCount !== null) {
        const rows = this.db
          .select({ id: cryptoOrders.id })
          .from(cryptoOrders)
          .where(
            and(
              eq(cryptoOrders.accountId, accountId),
              eq(cryptoOrders.side, 'bid'),
              gte(cryptoOrders.placedAt, today),
              inArray(cryptoOrders.state, ['wait', 'watch', 'done']),
            ),
          )
          .all();
        if (rows.length >= limits.dailyTotalMaxCount) {
          return {
            ok: false,
            reason: `일일 전체 매수 횟수 한도 초과 (${rows.length}/${limits.dailyTotalMaxCount})`,
          };
        }
      }

      if (limits.dailyTotalMaxAmountEnabled && limits.dailyTotalMaxAmount !== null) {
        const rows = this.db
          .select({
            ordType: cryptoOrders.ordType,
            price: cryptoOrders.price,
            volume: cryptoOrders.volume,
          })
          .from(cryptoOrders)
          .where(
            and(
              eq(cryptoOrders.accountId, accountId),
              eq(cryptoOrders.side, 'bid'),
              gte(cryptoOrders.placedAt, today),
              inArray(cryptoOrders.state, ['wait', 'watch', 'done']),
            ),
          )
          .all();
        const todaysKrw = rows.reduce((acc, row) => acc + sumOrderKrw(row), 0);
        if (todaysKrw + amountKrw > limits.dailyTotalMaxAmount) {
          return {
            ok: false,
            reason: `일일 매수 금액 한도 초과 (${todaysKrw + amountKrw}/${limits.dailyTotalMaxAmount} KRW)`,
          };
        }
      }

      if (limits.accountTotalMaxAmountEnabled && limits.accountTotalMaxAmount !== null) {
        // Phase R3-3 후속: cryptoAutoLots → lots (broker='UPBIT', status='open') 로 read 전환.
        // status 는 R3-3 매핑 그대로 lowercase ('open'/'closed'). amountKrwDecimal 은 nullable —
        // 코인 row 만 들어가므로 항상 값 있음. NULL 가드는 안전망.
        const rows = this.db
          .select({ amountKrwDecimal: lots.amountKrwDecimal })
          .from(lots)
          .where(
            and(
              eq(lots.broker, UPBIT_BROKER),
              eq(lots.accountId, accountId),
              eq(lots.status, 'open'),
            ),
          )
          .all();
        const exposureKrw = rows.reduce((acc, row) => acc + Number(row.amountKrwDecimal || '0'), 0);
        if (exposureKrw + amountKrw > limits.accountTotalMaxAmount) {
          return {
            ok: false,
            reason: `계좌 총 노출 한도 초과 (${exposureKrw + amountKrw}/${limits.accountTotalMaxAmount} KRW)`,
          };
        }
      }

      return { ok: true };
    } catch (cause) {
      return {
        ok: false,
        reason: cause instanceof Error ? `DB 오류: ${cause.message}` : 'DB 오류',
      };
    }
  }
}

function sumOrderKrw(row: {
  ordType: string;
  price: string | null;
  volume: string | null;
}): number {
  // UPBIT 주문 타입별 매수 KRW 환산:
  // - ord_type='price': price 자체가 KRW 금액
  // - ord_type='limit': price * volume = KRW 금액
  // - ord_type='market' (매도) → 매수 측 집계에서 발생하지 않으므로 0
  if (row.ordType === 'price') return Number(row.price || '0');
  if (row.ordType === 'limit') return Number(row.price || '0') * Number(row.volume || '0');
  return 0;
}

function kstMidnightUtc(now: Date): Date {
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const kstDateStr = kstNow.toISOString().slice(0, 10);
  return new Date(`${kstDateStr}T00:00:00.000Z`);
}
