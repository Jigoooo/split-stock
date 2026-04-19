import { describe, expect, it } from 'vitest';
import { formatSnapshotBlock, formatSnapshotsText } from './format-snapshot-text';
import type { SnapshotRow } from './use-lots-log';

const makeRow = (overrides: Partial<SnapshotRow> = {}): SnapshotRow => ({
  pdno: '005930',
  name: '삼성전자',
  currentPrice: 72000,
  lots: [
    { nth: 1, buyPrice: 70000, qty: 14, amountKrw: 980_000, status: 'OPEN' },
    { nth: 2, buyPrice: 67000, qty: 15, amountKrw: 1_005_000, status: 'OPEN' },
  ],
  ...overrides,
});

describe('formatSnapshotBlock', () => {
  it('헤더 라인에 종목명과 종목코드가 포함된다', () => {
    const text = formatSnapshotBlock(makeRow());
    expect(text).toContain('■■■ 삼성전자 (005930)');
  });

  it('현재가 라인이 포함된다', () => {
    const text = formatSnapshotBlock(makeRow());
    expect(text).toContain('현재가: 72,000원');
  });

  it('차수별 row가 nth 오름차순으로 출력된다', () => {
    const text = formatSnapshotBlock(makeRow());
    const lines = text.split('\n');
    const nth1Idx = lines.findIndex((l) => l.startsWith('1차'));
    const nth2Idx = lines.findIndex((l) => l.startsWith('2차'));
    expect(nth1Idx).toBeGreaterThan(-1);
    expect(nth2Idx).toBeGreaterThan(nth1Idx);
  });

  it('1차: 매입단가 70,000원, 평가손익 +28,000원 (+2.86%)', () => {
    const text = formatSnapshotBlock(makeRow());
    // currentPrice=72000, buyPrice=70000, qty=14 → evalAmount=(72000-70000)*14=28000
    expect(text).toContain('70,000원');
    expect(text).toContain('+28,000원');
  });

  it('매입단가보다 현재가가 낮으면 음수 손익', () => {
    const row = makeRow({ currentPrice: 65000 });
    const text = formatSnapshotBlock(row);
    // (65000-70000)*14 = -70000
    expect(text).toContain('-70,000원');
  });

  it('lots가 없는 종목도 헤더만 출력', () => {
    const row = makeRow({ lots: [] });
    const text = formatSnapshotBlock(row);
    expect(text).toContain('■■■ 삼성전자 (005930)');
  });
});

describe('formatSnapshotsText', () => {
  it('날짜 헤더가 포함된다', () => {
    const text = formatSnapshotsText('2025-04-01', [makeRow()]);
    expect(text).toContain('2025-04-01');
  });

  it('스냅샷이 없으면 "데이터 없음" 메시지', () => {
    const text = formatSnapshotsText('2025-04-01', []);
    expect(text).toContain('데이터 없음');
  });

  it('여러 종목은 개행으로 구분된다', () => {
    const rows = [
      makeRow({ pdno: '005930', name: '삼성전자' }),
      makeRow({ pdno: '000660', name: 'SK하이닉스' }),
    ];
    const text = formatSnapshotsText('2025-04-01', rows);
    expect(text).toContain('삼성전자');
    expect(text).toContain('SK하이닉스');
  });
});
