import type { BrokerError, BrokerErrorKind, KisError } from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';

/**
 * KIS 고유 에러를 broker-agnostic BrokerError 로 변환.
 *
 * KIS 의 rt_cd / msg_cd 는 raw 필드에 보존하여 디버깅 가능. brokerId 는 항상 'KIS'.
 *
 * Mapping:
 *  KisError.kind=NETWORK       → BrokerError.kind=NETWORK
 *  KisError.kind=RATE_LIMITED  → BrokerError.kind=RATE_LIMITED
 *  KisError.kind=AUTH_FAILED   → BrokerError.kind=AUTH_FAILED
 *  KisError.kind=VALIDATION    → BrokerError.kind=VALIDATION
 *  KisError.kind=API_BUSINESS  → BrokerError.kind=BUSINESS
 *  KisError.kind=UNKNOWN       → BrokerError.kind=UNKNOWN
 */
const KIND_MAP: Record<KisError['kind'], BrokerErrorKind> = {
  NETWORK: 'NETWORK',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_FAILED: 'AUTH_FAILED',
  VALIDATION: 'VALIDATION',
  API_BUSINESS: 'BUSINESS',
  UNKNOWN: 'UNKNOWN',
};

export function kisErrorToBrokerError(err: KisError): BrokerError {
  const raw: { code?: string; subCode?: string } = {};
  if (err.rt_cd !== undefined) raw.code = err.rt_cd;
  if (err.msg_cd !== undefined) raw.subCode = err.msg_cd;
  const hasRaw = raw.code !== undefined || raw.subCode !== undefined;
  return makeBrokerError({
    brokerId: 'KIS',
    kind: KIND_MAP[err.kind],
    msg: err.msg,
    ...(hasRaw && { raw }),
    ...(err.cause !== undefined && { cause: err.cause }),
  });
}
