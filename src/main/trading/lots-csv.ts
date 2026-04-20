import { err, ok, type Result } from 'neverthrow';
import type { LotStatus } from './fsm';
import type { LotRow, ManualInsertInput } from './lots-repo';

/**
 * 차수 수동편집(A7) 의 CSV/XLS-호환 import/export.
 *
 * 포맷 (RFC 4180 단순화 — escape 없는 단순 콤마 구분):
 *   nth,buyPrice,qty,amountKrw,status,boughtAt,soldAt,sellPrice
 *
 * - 1행은 헤더 (정확히 위 컬럼명).
 * - 빈 행은 건너뜀.
 * - amountKrw 미기입 시 buyPrice*qty 로 자동 계산.
 * - status: 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING'.
 * - boughtAt: ISO8601 (예: 2026-04-01T00:00:00.000Z) 또는 YYYY-MM-DD.
 * - soldAt/sellPrice 는 SOLD 상태에서만 의미. 비우면 빈 문자열.
 *
 * 보안 불변식: pdno/accountId 는 CSV 가 아니라 호출측에서 결정.
 *              CSV 가 다른 종목/계좌를 가로질러 주입하는 것을 차단.
 */

export const CSV_HEADER = [
  'nth',
  'buyPrice',
  'qty',
  'amountKrw',
  'status',
  'boughtAt',
  'soldAt',
  'sellPrice',
] as const;

export interface ParsedRow {
  rowIndex: number; // 1-based (헤더 제외, 데이터 첫 행 = 1)
  raw: string;
  ok: boolean;
  error?: string;
  parsed?: Omit<ManualInsertInput, 'accountId' | 'pdno'>;
}

export interface ParseResult {
  header: readonly string[];
  rows: ParsedRow[];
  validCount: number;
  errorCount: number;
}

const STATUS_SET: ReadonlySet<LotStatus> = new Set(['OPEN', 'SOLD', 'BUYING', 'SELLING']);

function parseDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // YYYY-MM-DD → 자정 UTC 로 가정
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/**
 * 단순 CSV 파서 — quote/escape 미지원 (split-stock 자체 포맷).
 * 사용자가 Excel 등에서 export 할 때는 quote 가 들어갈 수 있음 → 향후 보강 가능.
 */
export function parseLotsCsv(csvText: string): Result<ParseResult, string> {
  if (typeof csvText !== 'string' || csvText.trim() === '') {
    return err('빈 CSV 입력');
  }
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return err('빈 CSV 입력');
  const headerLine = lines[0];
  if (!headerLine) return err('헤더 누락');
  const header = headerLine.split(',').map((s) => s.trim());
  if (header.length !== CSV_HEADER.length || header.some((h, i) => h !== CSV_HEADER[i])) {
    return err(`헤더 형식 오류 — 기대: ${CSV_HEADER.join(',')}, 실제: ${header.join(',')}`);
  }

  const rows: ParsedRow[] = [];
  let validCount = 0;
  let errorCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const cells = raw.split(',').map((s) => s.trim());
    const rowIndex = i;
    if (cells.length !== CSV_HEADER.length) {
      rows.push({
        rowIndex,
        raw,
        ok: false,
        error: `컬럼 수 불일치 (기대 ${CSV_HEADER.length}, 실제 ${cells.length})`,
      });
      errorCount++;
      continue;
    }
    const [nthStr, priceStr, qtyStr, amountStr, statusStr, boughtStr, soldStr, sellPriceStr] =
      cells as [string, string, string, string, string, string, string, string];
    const nth = parseInteger(nthStr);
    const buyPrice = parseInteger(priceStr);
    const qty = parseInteger(qtyStr);
    if (nth === null || nth < 1) {
      rows.push({ rowIndex, raw, ok: false, error: `nth 값 오류: ${nthStr}` });
      errorCount++;
      continue;
    }
    if (buyPrice === null || buyPrice < 1) {
      rows.push({ rowIndex, raw, ok: false, error: `buyPrice 값 오류: ${priceStr}` });
      errorCount++;
      continue;
    }
    if (qty === null || qty < 1) {
      rows.push({ rowIndex, raw, ok: false, error: `qty 값 오류: ${qtyStr}` });
      errorCount++;
      continue;
    }
    const status = statusStr as LotStatus;
    if (!STATUS_SET.has(status)) {
      rows.push({ rowIndex, raw, ok: false, error: `status 값 오류: ${statusStr}` });
      errorCount++;
      continue;
    }
    const boughtAt = parseDate(boughtStr);
    if (boughtAt === null) {
      rows.push({ rowIndex, raw, ok: false, error: `boughtAt 값 오류: ${boughtStr}` });
      errorCount++;
      continue;
    }
    const explicitAmount = parseInteger(amountStr);
    const amountKrw = explicitAmount ?? buyPrice * qty;
    const parsed: Omit<ManualInsertInput, 'accountId' | 'pdno'> = {
      nth,
      buyPrice,
      qty,
      amountKrw,
      status,
      boughtAt,
    };
    rows.push({ rowIndex, raw, ok: true, parsed });
    validCount++;
    // soldAt / sellPrice 는 현재 ManualInsertInput 에 없음 — manualInsert 후 manualUpdate 로 적용.
    // 호출측이 SOLD 상태로 import 할 때만 별도 처리 (향후 확장).
    void soldStr;
    void sellPriceStr;
  }

  return ok({ header, rows, validCount, errorCount });
}

function csvEscape(v: string): string {
  // 단순 — 콤마/줄바꿈 포함 시 큰따옴표로 감싸고 내부 ""로 escape.
  if (v.includes(',') || v.includes('\n') || v.includes('"')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/**
 * LotRow[] → CSV 텍스트.
 * 헤더는 CSV_HEADER 와 동일 — import 와 라운드트립.
 */
export function lotsToCsv(rows: readonly LotRow[]): string {
  const lines: string[] = [CSV_HEADER.join(',')];
  for (const r of rows) {
    const boughtAtIso = new Date(r.boughtAt).toISOString();
    const soldAtIso = r.soldAt === null ? '' : new Date(r.soldAt).toISOString();
    const cells = [
      String(r.nth),
      String(r.buyPrice),
      String(r.qty),
      String(r.amountKrw),
      r.status,
      boughtAtIso,
      soldAtIso,
      r.sellPrice === null ? '' : String(r.sellPrice),
    ].map(csvEscape);
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}
