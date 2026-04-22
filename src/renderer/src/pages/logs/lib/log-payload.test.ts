import { describe, expect, it } from 'vitest';
import { buildLogPayloadPreview, buildLogPayloadView } from './log-payload';

describe('buildLogPayloadView', () => {
  it('object payload를 칩 요약 + pretty JSON으로 변환한다', () => {
    const result = buildLogPayloadView(
      '{"pdno":"005930","attempt":3,"reason":"token_failed","accountId":7}',
    );

    expect(result.chips).toEqual([
      { key: 'pdno', value: '005930' },
      { key: 'attempt', value: '3' },
      { key: 'reason', value: 'token_failed' },
    ]);
    expect(result.hiddenCount).toBe(1);
    expect(result.pretty).toContain('"accountId": 7');
  });

  it('invalid payload는 원문을 그대로 유지한다', () => {
    const result = buildLogPayloadView('{not-json');

    expect(result.chips).toHaveLength(0);
    expect(result.summary).toContain('{not-json');
    expect(result.pretty).toBe('{not-json');
  });

  it('빈 payload는 대시로 표시한다', () => {
    const result = buildLogPayloadView(null);

    expect(result.isEmpty).toBe(true);
    expect(result.summary).toBe('-');
    expect(result.pretty).toBe('-');
  });

  it('preview 결과를 캐시해서 같은 payload에서 재사용한다', () => {
    const first = buildLogPayloadPreview('{"pdno":"005930","attempt":3}');
    const second = buildLogPayloadPreview('{"pdno":"005930","attempt":3}');

    expect(first).toBe(second);
    expect(first.summary).toContain('pdno=005930');
  });
});
