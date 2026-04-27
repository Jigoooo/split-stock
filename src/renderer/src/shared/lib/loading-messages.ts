/**
 * 한국어 로딩/대기 메시지 공용 상수.
 *
 * 같은 의미를 "로드 중…", "로딩 중…", "조회 중…" 등으로 다르게 적던 표면 편차를
 * 메인 흐름(앱 셸, 라우트 진입, 헤더 셀렉터, 메인 페이지) 위주로 통일하기 위한 모음이다.
 * 설정 패널 같은 깊은 영역은 점진적으로 정리한다 — 강제 일괄 치환은 피한다.
 */
export const LOADING_MESSAGES = {
  /** 일반 데이터 fetch 중 — 가장 흔한 표현. */
  GENERAL: '로드 중…',
  /** 앱 부트스트랩 / 셸 초기화 중. */
  INITIALIZING: '초기화 중…',
  /** 비동기 환경 전환 진행 중. */
  SWITCHING_ENV: '환경 전환 중…',
  /** Suspense fallback 등 lazy 모듈 로드 중. */
  ROUTE_LOADING: '로드 중…',
  /** 활성 계좌 목록 조회 중. */
  ACCOUNTS_LOADING: '계좌 로드 중…',
  /** 활성 계좌 메타 단건 확인 중. */
  ACCOUNT_CHECKING: '계좌 확인 중…',
  /** 거래 내역, 과거 사이클 등 조회성 작업. */
  FETCHING: '조회 중…',
} as const;

export type LoadingMessageKey = keyof typeof LOADING_MESSAGES;
