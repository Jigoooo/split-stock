import type { KisError, KisErrorKind } from '@shared/contracts';

export function makeKisError(
  kind: KisErrorKind,
  msg: string,
  extra: Partial<KisError> = {},
): KisError {
  return { kind, msg, ...extra };
}

export function isRetryable(err: KisError): boolean {
  return err.kind === 'NETWORK' || err.kind === 'RATE_LIMITED';
}

/**
 * KIS 응답 rt_cd를 에러로 매핑 — 성공 '0', 그 외 실패.
 */
export function interpretRtCd(rt_cd: string, msg_cd: string, msg1: string): KisError | null {
  if (rt_cd === '0') return null;
  // 자주 보이는 msg_cd 매핑 (정확한 코드표는 KIS 공지 참고)
  if (msg_cd === 'EGW00123' || /토큰/.test(msg1) || /접근/.test(msg1)) {
    return makeKisError('AUTH_FAILED', msg1, { rt_cd, msg_cd });
  }
  if (/한도|초과|빈도|유량/.test(msg1)) {
    return makeKisError('RATE_LIMITED', msg1, { rt_cd, msg_cd });
  }
  if (/입력|필수|형식|파라미터/.test(msg1)) {
    return makeKisError('VALIDATION', msg1, { rt_cd, msg_cd });
  }
  return makeKisError('API_BUSINESS', msg1 || `rt_cd=${rt_cd}`, { rt_cd, msg_cd });
}
