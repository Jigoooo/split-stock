import { describe, expect, it } from 'vitest';
import { koreanFuzzyMatch } from './korean-search';

describe('koreanFuzzyMatch', () => {
  it('초성 검색: ㅅㅅ → 삼성, 서승 매칭', () => {
    expect(koreanFuzzyMatch('삼성전자', 'ㅅㅅ')).toBe(true);
    expect(koreanFuzzyMatch('SK하이닉스', 'ㅅㅅ')).toBe(false);
  });

  it('부분 자모: 삼ㅅ → 삼성 (연속 음절의 초성 매칭)', () => {
    expect(koreanFuzzyMatch('삼성전자', '삼ㅅ')).toBe(true);
    expect(koreanFuzzyMatch('현대차', '삼ㅅ')).toBe(false);
  });

  it('영문 대소문자 무시', () => {
    expect(koreanFuzzyMatch('SK하이닉스', 'sk')).toBe(true);
    expect(koreanFuzzyMatch('SK하이닉스', 'Sk')).toBe(true);
  });

  it('띄어쓰기/언더스코어/하이픈 무시', () => {
    expect(koreanFuzzyMatch('삼성 전자', '삼성전자')).toBe(true);
    expect(koreanFuzzyMatch('삼성전자', '삼성 전자')).toBe(true);
  });

  it('빈 쿼리는 항상 true', () => {
    expect(koreanFuzzyMatch('어떤것', '')).toBe(true);
  });

  it('빈 타깃은 비-빈 쿼리에 false', () => {
    expect(koreanFuzzyMatch('', '삼성')).toBe(false);
  });
});
