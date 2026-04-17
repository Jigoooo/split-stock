/**
 * 민감 문자열을 로그에 남기기 전에 마스킹.
 * - 길이 8 미만: 전체 '*'
 * - 그 외: 마지막 4자리만 남기고 나머지 '*'
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length < 8) return '*'.repeat(value.length);
  const tail = value.slice(-4);
  return `${'*'.repeat(value.length - 4)}${tail}`;
}

/**
 * 객체의 특정 키들을 마스킹한 얕은 복제본을 반환.
 */
export function maskFields<T extends Record<string, unknown>>(
  obj: T,
  keys: readonly (keyof T)[],
): T {
  const result: Record<string, unknown> = { ...obj };
  for (const key of keys) {
    const v = result[key as string];
    if (typeof v === 'string') result[key as string] = maskSecret(v);
  }
  return result as T;
}
