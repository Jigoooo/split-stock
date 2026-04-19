import { describe, expect, it } from 'vitest';
import { parseKosdaqMst, parseKospiMst } from './stock-master-downloader';

function mkKospiLine(pdno: string, name: string, groupCode = 'ST'): string {
  const paddedPdno = pdno.padEnd(9, ' ');
  const paddedStd = `KR7${pdno}003`.padEnd(12, ' ');
  const paddedName = name.padEnd(20, ' ');
  // 고정부 227 chars: groupCode(2) + 나머지(225)
  const fixed = groupCode.padEnd(2, ' ') + ' '.repeat(225);
  return `${paddedPdno}${paddedStd}${paddedName}${fixed}`;
}

function mkKosdaqLine(pdno: string, name: string, groupCode = 'ST'): string {
  const paddedPdno = pdno.padEnd(9, ' ');
  const paddedStd = `KR7${pdno}003`.padEnd(12, ' ');
  const paddedName = name.padEnd(20, ' ');
  const fixed = groupCode.padEnd(2, ' ') + ' '.repeat(219);
  return `${paddedPdno}${paddedStd}${paddedName}${fixed}`;
}

describe('parseKospiMst', () => {
  it('단축코드/한글명/그룹코드 추출', () => {
    const text = [
      mkKospiLine('005930', '삼성전자', 'ST'),
      mkKospiLine('000660', 'SK하이닉스', 'ST'),
    ].join('\n');
    const entries = parseKospiMst(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      pdno: '005930',
      name: '삼성전자',
      market: 'KOSPI',
      groupCode: 'ST',
    });
    expect(entries[1]).toEqual({
      pdno: '000660',
      name: 'SK하이닉스',
      market: 'KOSPI',
      groupCode: 'ST',
    });
  });

  it('allowGroupCodes 필터로 ETF 제외', () => {
    const text = [
      mkKospiLine('005930', '삼성전자', 'ST'),
      mkKospiLine('069500', 'KODEX200', 'EF'),
    ].join('\n');
    const entries = parseKospiMst(text, { allowGroupCodes: ['ST'] });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.pdno).toBe('005930');
  });

  it('짧은 라인/빈 라인 스킵', () => {
    const text = ['', 'short', mkKospiLine('005930', '삼성전자')].join('\n');
    const entries = parseKospiMst(text);
    expect(entries).toHaveLength(1);
  });

  it('CRLF 라인 종결자 허용', () => {
    const text = [mkKospiLine('005930', '삼성전자'), mkKospiLine('000660', 'SK하이닉스')].join(
      '\r\n',
    );
    const entries = parseKospiMst(text);
    expect(entries).toHaveLength(2);
  });
});

describe('parseKosdaqMst', () => {
  it('market=KOSDAQ 태깅', () => {
    const text = mkKosdaqLine('035720', '카카오', 'ST');
    const entries = parseKosdaqMst(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      pdno: '035720',
      name: '카카오',
      market: 'KOSDAQ',
      groupCode: 'ST',
    });
  });
});
