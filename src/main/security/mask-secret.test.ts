import { describe, expect, it } from 'vitest';
import { maskFields, maskSecret } from './mask-secret';

describe('maskSecret', () => {
  it('빈 값은 빈 문자열', () => {
    expect(maskSecret(null)).toBe('');
    expect(maskSecret(undefined)).toBe('');
    expect(maskSecret('')).toBe('');
  });

  it('8자 미만은 전체 마스킹', () => {
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('1234567')).toBe('*******');
  });

  it('8자 이상은 마지막 4자리만 남김', () => {
    expect(maskSecret('1234567890')).toBe('******7890');
    expect(maskSecret('abcdefghXXXX')).toBe('********XXXX');
  });
});

describe('maskFields', () => {
  it('지정한 키만 마스킹하고 원본은 불변', () => {
    const src = { appKey: 'ABCDEFGHIJKL', env: 'MOCK', other: 42 };
    const out = maskFields(src, ['appKey'] as const);
    expect(out.appKey).toBe('********IJKL');
    expect(out.env).toBe('MOCK');
    expect(out.other).toBe(42);
    expect(src.appKey).toBe('ABCDEFGHIJKL');
  });
});
