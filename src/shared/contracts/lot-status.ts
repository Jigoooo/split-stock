import { type Broker, isCryptoBroker } from './broker';

/**
 * Lot 상태 정규화 — broker 별 raw 값을 단일 표준 enum 으로 흡수.
 *
 * 배경:
 * - KIS: lots.status = 대문자 ('OPEN' | 'BUYING' | 'SOLD' | 'SELLING')
 * - UPBIT: lots.status = 소문자 ('open' | 'reducing' | 'closed')
 *
 * 같은 lots 테이블(broker 컬럼으로 분리)에 두 케이스가 공존하므로 read 시점에
 * `normalizeLotStatus(broker, raw)` 로 표준 LotStatus 로 변환해 UI/필터/요약 로직을
 * 한 형태로 유지한다.
 *
 * DB migration 으로 통일하지 않은 이유:
 * - rollback 위험 + 기존 KIS row 다수 + UPBIT 소문자가 별도 핸들러에서 직접 read
 * - 변환 layer 는 추가 cost 가 미미하고 회귀 위험이 낮다 (advisor 권고).
 */

export const LOT_STATUS = {
  OPEN: 'OPEN',
  BUYING: 'BUYING',
  SOLD: 'SOLD',
  SELLING: 'SELLING',
} as const;

export type LotStatus = (typeof LOT_STATUS)[keyof typeof LOT_STATUS];

/**
 * broker 별 lots.status raw 값 → 표준 LotStatus.
 *
 * 알 수 없는 raw 값은 가장 안전한 'OPEN' 으로 fallback (기존 fromOpen 동작과 동일).
 *
 * @param broker - 'KIS' / 'KIWOOM' / 'UPBIT' 등
 * @param raw - DB lots.status 컬럼 값
 */
export function normalizeLotStatus(broker: Broker | string, raw: string): LotStatus {
  if (isCryptoBroker(broker)) {
    if (raw === 'closed') return LOT_STATUS.SOLD;
    if (raw === 'reducing') return LOT_STATUS.SELLING;
    return LOT_STATUS.OPEN;
  }
  // KIS / KIWOOM 등 국내주식: 이미 대문자 LotStatus 와 동일.
  if (
    raw === LOT_STATUS.OPEN ||
    raw === LOT_STATUS.BUYING ||
    raw === LOT_STATUS.SOLD ||
    raw === LOT_STATUS.SELLING
  ) {
    return raw;
  }
  return LOT_STATUS.OPEN;
}

/** 종료(매도 완결) 차수 판별. status='SOLD'. */
export function isClosedLotStatus(status: LotStatus): boolean {
  return status === LOT_STATUS.SOLD;
}

/** 진행중(보유 또는 매수 중) 차수 판별. status='OPEN' | 'BUYING'. */
export function isOpenLotStatus(status: LotStatus): boolean {
  return status === LOT_STATUS.OPEN || status === LOT_STATUS.BUYING;
}
