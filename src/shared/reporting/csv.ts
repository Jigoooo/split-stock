/**
 * RFC 4180 준수 CSV 생성기 (cross-process 순수 함수).
 * - 콤마/따옴표/줄바꿈 포함 셀은 따옴표로 감싸고 내부 따옴표는 2배로 이스케이프
 * - null/undefined는 빈 셀
 * - number/boolean은 String() 변환, Date는 ISO 문자열
 * - BOM은 옵션 (Excel 한글 호환)
 */

export type CsvCell = string | number | boolean | Date | null | undefined;

export interface CsvColumn<T> {
  key: string;
  header: string;
  accessor: (row: T) => CsvCell;
}

export interface ToCsvOptions {
  /** UTF-8 BOM prepend — Excel 한글 정상 표시용. */
  bom?: boolean;
  /** 줄 종료자 — 기본 CRLF(RFC 4180). */
  eol?: '\r\n' | '\n';
}

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const raw =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'boolean' || typeof value === 'number'
        ? String(value)
        : value;
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  options: ToCsvOptions = {},
): string {
  const eol = options.eol ?? '\r\n';
  const headerLine = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.accessor(row))).join(','))
    .join(eol);
  const out = rows.length === 0 ? headerLine : `${headerLine}${eol}${body}`;
  return options.bom ? `\uFEFF${out}` : out;
}
