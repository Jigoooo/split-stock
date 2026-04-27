/**
 * 한국어 UI 마이크로카피 공용 상수.
 *
 * 같은 의미를 "로드 중…" / "로딩 중…" / "조회 중…" 등으로 다르게 적던 표면 편차,
 * 그리고 빈 상태("결과 없음" / "데이터 없음" / "히스토리 없음") 등도 통일한다.
 * 메인 흐름(앱 셸, 라우트 진입, 헤더 셀렉터, 메인 페이지) 위주로 적용하고
 * 설정 패널 같은 깊은 영역은 점진적으로 정리한다 — 강제 일괄 치환은 피한다.
 */
export const LOADING_MESSAGES = {
  /** 일반 데이터 fetch 중 — 가장 흔한 표현. */
  GENERAL: '로드 중…',
  /** 앱 부트스트랩 / 셸 초기화 중. */
  INITIALIZING: '앱을 준비 중입니다',
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

/**
 * 빈 상태 메시지 — 데이터가 0건일 때 사용자에게 보여주는 메시지.
 * 표가 비었음을 알리는 단순 메시지부터 도메인별 빈 상태(거래/사이클/리포트)까지 포함.
 */
export const EMPTY_MESSAGES = {
  /** 일반: 결과/데이터 없음. */
  GENERAL: '데이터가 없습니다',
  /** 거래 내역 비었음 (오늘 + 과거). */
  TRADE_HISTORY: '거래 내역이 없습니다',
  /** 사이클(매매 차수) 진행 없음. */
  CYCLE: '사이클이 없습니다',
  /** 자동감시 결과 없음. */
  WATCH_HISTORY: '자동감시 기록이 없습니다',
  /** 리포트 기간 내 데이터 없음. */
  REPORT_RANGE: '선택한 기간에 데이터가 없습니다',
  /** 검색 결과 없음 — 검색어 안내와 함께 사용. */
  SEARCH: '결과가 없습니다',
  /** 활성 계좌 없음. */
  NO_ACCOUNT: '활성 계좌가 없습니다',
} as const;

export type EmptyMessageKey = keyof typeof EMPTY_MESSAGES;
