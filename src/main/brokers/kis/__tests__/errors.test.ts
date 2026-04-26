import type { KisError } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { kisErrorToBrokerError } from '../errors';

describe('kisErrorToBrokerError', () => {
  it('NETWORK 매핑', () => {
    const e: KisError = { kind: 'NETWORK', msg: 'timeout' };
    const r = kisErrorToBrokerError(e);
    expect(r.brokerId).toBe('KIS');
    expect(r.kind).toBe('NETWORK');
    expect(r.msg).toBe('timeout');
    expect(r.raw).toBeUndefined();
  });

  it('API_BUSINESS → BUSINESS, raw 보존 (rt_cd, msg_cd)', () => {
    const e: KisError = {
      kind: 'API_BUSINESS',
      msg: '주문 가능 시간 외',
      rt_cd: '1',
      msg_cd: 'EGW00121',
    };
    const r = kisErrorToBrokerError(e);
    expect(r.kind).toBe('BUSINESS');
    expect(r.raw).toEqual({ code: '1', subCode: 'EGW00121' });
  });

  it('AUTH_FAILED → AUTH_FAILED + cause 보존', () => {
    const cause = new Error('token expired');
    const e: KisError = { kind: 'AUTH_FAILED', msg: '인증 실패', cause };
    const r = kisErrorToBrokerError(e);
    expect(r.kind).toBe('AUTH_FAILED');
    expect(r.cause).toBe(cause);
  });

  it('rt_cd/msg_cd 없으면 raw 키 자체 생략', () => {
    const e: KisError = { kind: 'VALIDATION', msg: 'invalid' };
    const r = kisErrorToBrokerError(e);
    expect(r).not.toHaveProperty('raw');
  });

  it('UNKNOWN → UNKNOWN', () => {
    const e: KisError = { kind: 'UNKNOWN', msg: '?' };
    const r = kisErrorToBrokerError(e);
    expect(r.kind).toBe('UNKNOWN');
  });
});
