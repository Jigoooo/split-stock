import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

interface Row {
  code: string;
  name: string;
  qty: number;
  executedAt: Date;
  note: string | null;
}

const columns = [
  { key: 'code', header: '종목코드', accessor: (r: Row) => r.code },
  { key: 'name', header: '종목명', accessor: (r: Row) => r.name },
  { key: 'qty', header: '수량', accessor: (r: Row) => r.qty },
  { key: 'executedAt', header: '체결시각', accessor: (r: Row) => r.executedAt },
  { key: 'note', header: '비고', accessor: (r: Row) => r.note },
];

describe('toCsv', () => {
  it('헤더 + 행 출력 (CRLF 기본)', () => {
    const rows: Row[] = [
      {
        code: '005930',
        name: '삼성전자',
        qty: 10,
        executedAt: new Date('2026-04-18T09:30:15Z'),
        note: null,
      },
    ];
    const csv = toCsv(rows, columns);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('종목코드,종목명,수량,체결시각,비고');
    expect(lines[1]).toBe('005930,삼성전자,10,2026-04-18T09:30:15.000Z,');
  });

  it('콤마/따옴표/줄바꿈 포함 셀은 따옴표로 감싸고 " → ""', () => {
    const rows: Row[] = [
      {
        code: '005930',
        name: '삼성전자,주',
        qty: 1,
        executedAt: new Date(0),
        note: 'a"b\nc',
      },
    ];
    const csv = toCsv(rows, columns);
    expect(csv).toContain('"삼성전자,주"');
    expect(csv).toContain('"a""b\nc"');
  });

  it('빈 배열 → 헤더만 출력', () => {
    const csv = toCsv([], columns);
    expect(csv).toBe('종목코드,종목명,수량,체결시각,비고');
  });

  it('BOM 옵션: UTF-8 BOM(0xFEFF) prepend', () => {
    const csv = toCsv([], columns, { bom: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('eol 옵션 LF', () => {
    const rows: Row[] = [
      {
        code: '1',
        name: 'a',
        qty: 1,
        executedAt: new Date('2026-01-01T00:00:00Z'),
        note: null,
      },
      {
        code: '2',
        name: 'b',
        qty: 2,
        executedAt: new Date('2026-01-02T00:00:00Z'),
        note: null,
      },
    ];
    const csv = toCsv(rows, columns, { eol: '\n' });
    expect(csv.split('\n')).toHaveLength(3);
    expect(csv).not.toContain('\r\n');
  });

  it('null/undefined/false는 빈/"false" 셀', () => {
    const rows = [{ a: null as unknown as string, b: undefined, c: false }];
    const csv = toCsv(rows, [
      { key: 'a', header: 'A', accessor: (r) => r.a },
      { key: 'b', header: 'B', accessor: (r) => r.b },
      { key: 'c', header: 'C', accessor: (r) => r.c },
    ]);
    expect(csv.split('\r\n')[1]).toBe(',,false');
  });
});
