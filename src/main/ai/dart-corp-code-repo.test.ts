import { describe, expect, it } from 'vitest';
import { parseDartCorpXml } from './dart-corp-code-repo';

describe('parseDartCorpXml', () => {
  it('flat XML 에서 상장 종목만 추출', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list>
    <corp_code>00126380</corp_code>
    <corp_name>삼성전자</corp_name>
    <stock_code>005930</stock_code>
    <modify_date>20240605</modify_date>
  </list>
  <list>
    <corp_code>00164742</corp_code>
    <corp_name>SK하이닉스</corp_name>
    <stock_code>000660</stock_code>
    <modify_date>20240501</modify_date>
  </list>
  <list>
    <corp_code>00999999</corp_code>
    <corp_name>비상장 회사</corp_name>
    <stock_code> </stock_code>
    <modify_date>20240301</modify_date>
  </list>
</result>`;
    const result = parseDartCorpXml(xml);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      stockCode: '005930',
      corpCode: '00126380',
      corpName: '삼성전자',
      modifyDate: '20240605',
    });
    expect(result[1]?.corpName).toBe('SK하이닉스');
  });

  it('stock_code 가 5자리이면 6자리로 padStart', () => {
    const xml = `<result>
  <list>
    <corp_code>00126380</corp_code>
    <corp_name>테스트</corp_name>
    <stock_code>56789</stock_code>
  </list>
</result>`;
    const result = parseDartCorpXml(xml);
    expect(result).toHaveLength(1);
    expect(result[0]?.stockCode).toBe('056789');
  });

  it('필수 필드 누락 시 silently skip', () => {
    const xml = `<result>
  <list>
    <corp_name>코드없음</corp_name>
    <stock_code>123456</stock_code>
  </list>
  <list>
    <corp_code>00111111</corp_code>
    <stock_code>234567</stock_code>
  </list>
</result>`;
    const result = parseDartCorpXml(xml);
    expect(result).toHaveLength(0);
  });

  it('빈 XML 처리', () => {
    expect(parseDartCorpXml('<result></result>')).toEqual([]);
    expect(parseDartCorpXml('')).toEqual([]);
  });

  it('modify_date 누락은 null', () => {
    const xml = `<result>
  <list>
    <corp_code>00111111</corp_code>
    <corp_name>테스트</corp_name>
    <stock_code>111111</stock_code>
  </list>
</result>`;
    const result = parseDartCorpXml(xml);
    expect(result[0]?.modifyDate).toBeNull();
  });
});
