import type { BrokerError, BrokerErrorKind } from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';

/**
 * Kiwoom 응답 공통 헤더 (return_code / return_msg) → BrokerError 변환.
 *
 * Kiwoom 비즈니스 에러는 `return_code` 가 0 이외 (보통 1) 이고 `return_msg` 에
 * 사람이 읽을 수 있는 메시지가 들어있다. status 별 공식 매핑은 부족하므로
 * status 기반 분류 + return_code 보존 정책.
 */
export function classifyKiwoomBody(
  status: number,
  body: { return_code?: number | string; return_msg?: string } | null,
): BrokerError | null {
  const code = body?.return_code !== undefined ? String(body.return_code) : undefined;
  const msg = body?.return_msg ?? '';

  // return_code === 0 이면 정상 — 호출측이 알아서 처리 (이 함수는 호출되지 않음)
  if (code === undefined || code === '0') return null;

  // 공식 가이드는 8005 등 일부 코드만 명시 — 알려진 토큰 만료 코드를 AUTH_FAILED 로
  const isAuth = /토큰|만료|인증|권한/.test(msg) || code === '8005';
  const isRate = status === 429 || /과도|초과|limit/i.test(msg);

  let kind: BrokerErrorKind;
  if (isAuth) kind = 'AUTH_FAILED';
  else if (isRate) kind = 'RATE_LIMITED';
  else if (status >= 500) kind = 'NETWORK';
  else kind = 'BUSINESS';

  return makeBrokerError({
    brokerId: 'KIWOOM',
    kind,
    msg: msg || `Kiwoom HTTP ${status}`,
    raw: { code, ...(status >= 100 && { subCode: String(status) }) },
  });
}

/** HTTP transport-level 에러를 BrokerError 로 변환 (네트워크/타임아웃). */
export function classifyKiwoomTransport(cause: unknown): BrokerError {
  const msg = cause instanceof Error ? cause.message : 'unknown transport error';
  return makeBrokerError({
    brokerId: 'KIWOOM',
    kind: 'NETWORK',
    msg,
    cause,
  });
}
