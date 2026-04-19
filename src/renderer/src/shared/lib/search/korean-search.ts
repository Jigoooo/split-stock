const CHOSEONG = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
] as const;

const JONGSEONG = [
  '',
  'ㄱ',
  'ㄲ',
  'ㄳ',
  'ㄴ',
  'ㄵ',
  'ㄶ',
  'ㄷ',
  'ㄹ',
  'ㄺ',
  'ㄻ',
  'ㄼ',
  'ㄽ',
  'ㄾ',
  'ㄿ',
  'ㅀ',
  'ㅁ',
  'ㅂ',
  'ㅄ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
] as const;

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;

function isHangulSyllable(code: number): boolean {
  return code >= HANGUL_BASE && code <= HANGUL_END;
}

function isConsonantJamo(code: number): boolean {
  return code >= 0x3131 && code <= 0x314e;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAllChoseong(str: string): boolean {
  return [...str].every((ch) => CHOSEONG.includes(ch as (typeof CHOSEONG)[number]));
}

function buildChosungRegex(query: string, spacer: string): string {
  return [...query]
    .map((ch) => {
      const idx = CHOSEONG.indexOf(ch as (typeof CHOSEONG)[number]);
      if (idx === -1) return escapeRegex(ch);
      const start = String.fromCharCode(HANGUL_BASE + idx * 21 * 28);
      const end = String.fromCharCode(HANGUL_BASE + (idx + 1) * 21 * 28 - 1);
      return `[${start}-${end}]`;
    })
    .join(spacer);
}

function buildLastSyllablePattern(code: number): string {
  const offset = code - HANGUL_BASE;
  const jongseongIndex = offset % 28;
  const char = String.fromCharCode(code);

  if (jongseongIndex === 0) {
    const rangeEnd = String.fromCharCode(code + 27);
    return `[${escapeRegex(char)}-${rangeEnd}]`;
  }

  const jongseong = JONGSEONG[jongseongIndex];
  const jongseongAsChoseong = CHOSEONG.indexOf(jongseong as (typeof CHOSEONG)[number]);

  if (jongseongAsChoseong !== -1) {
    const withoutJongseong = String.fromCharCode(code - jongseongIndex);
    const nextStart = String.fromCharCode(HANGUL_BASE + jongseongAsChoseong * 21 * 28);
    const nextEnd = String.fromCharCode(HANGUL_BASE + (jongseongAsChoseong + 1) * 21 * 28 - 1);
    return `(?:${escapeRegex(char)}|${escapeRegex(withoutJongseong)}[${nextStart}-${nextEnd}])`;
  }

  return escapeRegex(char);
}

/**
 * 검색어를 한글 퍼지 매칭 RegExp로 변환.
 *
 * 지원:
 * - 초성 검색 ("ㅅㅅ" → 삼성, 서승)
 * - 미완성 글자 ("사ㄹ" → 사람, "개바" → 개발)
 * - 종성→초성 분리 ("갈" → 갈 or 가+[라~맇])
 * - 띄어쓰기/구분자 무시 (_ - 공백)
 * - 영문 대소문자 무시
 */
export function createKoreanSearchRegex(query: string): RegExp {
  if (!query) return /(?:)/i;

  const normalized = query.replace(/[\s_-]+/g, '');
  if (!normalized) return /(?:)/i;

  const spacer = '[\\s_-]*';

  if (isAllChoseong(normalized)) {
    return new RegExp(buildChosungRegex(normalized, spacer), 'i');
  }

  const chars = [...normalized];
  const parts: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (!char) continue;
    const code = char.charCodeAt(0);
    const isLast = i === chars.length - 1;

    if (isConsonantJamo(code)) {
      const choseongIdx = CHOSEONG.indexOf(char as (typeof CHOSEONG)[number]);
      if (choseongIdx !== -1) {
        const start = String.fromCharCode(HANGUL_BASE + choseongIdx * 21 * 28);
        const end = String.fromCharCode(HANGUL_BASE + (choseongIdx + 1) * 21 * 28 - 1);
        parts.push(`[${escapeRegex(char)}${start}-${end}]`);
      } else {
        parts.push(escapeRegex(char));
      }
    } else if (isHangulSyllable(code) && isLast) {
      parts.push(buildLastSyllablePattern(code));
    } else {
      parts.push(escapeRegex(char));
    }

    if (!isLast) {
      parts.push(spacer);
    }
  }

  return new RegExp(parts.join(''), 'i');
}

/**
 * target 문자열이 query에 한글 퍼지 매칭되는지 확인
 */
export function koreanFuzzyMatch(target: string, query: string): boolean {
  if (!query) return true;
  if (!target) return false;
  return createKoreanSearchRegex(query).test(target);
}
