import { describe, expect, it } from 'vitest';
import { CSV_HEADER, lotsToCsv, parseLotsCsv } from './lots-csv';
import type { LotRow } from './lots-repo';

describe('lots-csv', () => {
  describe('parseLotsCsv', () => {
    it('헤더 + 정상 행 1건 파싱', () => {
      const csv = `${CSV_HEADER.join(',')}
1,70000,10,700000,OPEN,2026-04-01,,
`;
      const r = parseLotsCsv(csv);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.validCount).toBe(1);
        expect(r.value.errorCount).toBe(0);
        const parsed = r.value.rows[0]?.parsed;
        expect(parsed?.nth).toBe(1);
        expect(parsed?.buyPrice).toBe(70000);
        expect(parsed?.qty).toBe(10);
        expect(parsed?.amountKrw).toBe(700000);
        expect(parsed?.status).toBe('OPEN');
      }
    });

    it('amountKrw 미기입 시 buyPrice*qty 자동 계산', () => {
      const csv = `${CSV_HEADER.join(',')}
1,70000,10,,OPEN,2026-04-01,,
`;
      const r = parseLotsCsv(csv);
      if (r.isOk()) {
        expect(r.value.rows[0]?.parsed?.amountKrw).toBe(700000);
      }
    });

    it('헤더 형식 오류 → err', () => {
      const r = parseLotsCsv('wrong,header\n1,2');
      expect(r.isErr()).toBe(true);
    });

    it('스키마 위반 행 보고 (errorCount)', () => {
      const csv = `${CSV_HEADER.join(',')}
0,70000,10,,OPEN,2026-04-01,,
1,abc,10,,OPEN,2026-04-01,,
1,70000,10,,UNKNOWN,2026-04-01,,
1,70000,10,,OPEN,not-a-date,,
`;
      const r = parseLotsCsv(csv);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.errorCount).toBe(4);
        expect(r.value.validCount).toBe(0);
      }
    });

    it('빈 입력 거부', () => {
      expect(parseLotsCsv('').isErr()).toBe(true);
      expect(parseLotsCsv('   ').isErr()).toBe(true);
    });
  });

  describe('lotsToCsv', () => {
    it('LotRow[] → CSV 라운드트립 (재파싱)', () => {
      const rows: LotRow[] = [
        {
          id: 1,
          accountId: 1,
          pdno: '005930',
          nth: 1,
          buyPrice: 70000,
          qty: 10,
          amountKrw: 700_000,
          status: 'OPEN',
          boughtAt: Date.UTC(2026, 3, 1),
          soldAt: null,
          sellPrice: null,
        },
      ];
      const csv = lotsToCsv(rows);
      expect(csv).toContain(CSV_HEADER.join(','));
      const parsed = parseLotsCsv(csv);
      expect(parsed.isOk()).toBe(true);
      if (parsed.isOk()) {
        expect(parsed.value.validCount).toBe(1);
        expect(parsed.value.rows[0]?.parsed?.buyPrice).toBe(70000);
      }
    });

    it('빈 lots → 헤더만 출력', () => {
      const csv = lotsToCsv([]);
      const lines = csv.split('\n').filter((l) => l !== '');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(CSV_HEADER.join(','));
    });
  });
});
