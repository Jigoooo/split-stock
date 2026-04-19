import type { LotEntry, SnapshotRow } from './use-lots-log';

function krw(n: number): string {
  return n.toLocaleString('ko-KR');
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '0.00%';
  return ((numerator / denominator) * 100).toFixed(2) + '%';
}

/**
 * 종목 1개에 대한 텍스트 블록.
 * ASIS "잔고(차수) 로그" 형식:
 *   ■■■ 종목명 (코드)
 *   현재가: N원
 *   차수  수량   매입단가    평가손익    수익률
 *   1차   N주   N원        +N원        +N%
 *   ...
 */
export function formatSnapshotBlock(row: SnapshotRow): string {
  const lines: string[] = [];
  lines.push(`■■■ ${row.name} (${row.pdno})`);
  lines.push(`현재가: ${krw(row.currentPrice)}원`);
  lines.push('차수\t수량\t매입단가\t평가손익\t수익률');

  const sorted = [...row.lots].sort((a, b) => a.nth - b.nth);
  for (const lot of sorted) {
    const evalAmount = (row.currentPrice - lot.buyPrice) * lot.qty;
    const evalPct = pct(row.currentPrice - lot.buyPrice, lot.buyPrice);
    const sign = evalAmount >= 0 ? '+' : '';
    lines.push(
      `${lot.nth}차\t${lot.qty}주\t${krw(lot.buyPrice)}원\t${sign}${krw(evalAmount)}원\t${sign}${evalPct}`,
    );
  }
  return lines.join('\n');
}

/**
 * 전체 스냅샷 목록을 클립보드 복사용 텍스트로 변환.
 */
export function formatSnapshotsText(date: string, rows: SnapshotRow[]): string {
  if (rows.length === 0) return `[${date}] 스냅샷 데이터 없음`;
  const header = `=== 잔고(차수) 로그 — ${date} ===\n`;
  return header + rows.map(formatSnapshotBlock).join('\n\n');
}
