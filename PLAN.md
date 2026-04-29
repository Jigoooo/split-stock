# AI 종목추천/차수추천 근거 통합 고도화 계획

## Summary
- 종목추천과 차수추천은 같은 원천 분석 계층인 `MagicSplitFacts`를 공유한다.
- 종목추천은 “후보 선별/랭킹”, 차수추천은 “선택 종목의 매수 단계 설계”로 최종 판단만 분리한다.
- 차수추천은 완전 수동 실행으로 바꾼다. 개별매매설정 진입 시 자동 요청하지 않고, 사용자가 분석 버튼을 누를 때마다 뉴스/공시/시장지표까지 포함한 전체 분석을 새로 실행한다.
- AI 결과는 미리보기/추천만 제공한다. 자동저장/자동주문은 범위에서 제외한다.
- 근거가 약하면 억지 추천하지 않고, 보류 사유와 부족한 데이터를 보여준다.

## Key Decisions
- 새 의존성은 처음부터 추가한다.
  - `string-similarity-js`: 뉴스 제목/요약 유사도 기반 중복 제거와 클러스터링.
  - `html-entities`: Naver 뉴스 제목/요약의 HTML entity 정리.
  - 기존 `bottleneck`은 뉴스/공시/시장 API 호출 rate limit에 재사용한다.
- 무거운 NLP 라이브러리(`wink-nlp`, `compromise`)는 v1에 넣지 않는다. 한국어 금융뉴스에서 비용 대비 이득이 불확실하고, 이번 목표는 “설명 가능한 evidence pack”이다.
- `30~59봉`은 `limited`, `60봉 이상`은 `normal`, `<30봉`은 `blocked`로 고정한다.
- `stageRationales`, `globalRisks`, `evidenceRefs`, `analysisConfidence`, `dataQuality`는 AI suggestion DTO와 preview state에만 둔다. persisted `StrategyProfile`에는 저장하지 않는다.

## Implementation
- 공통 분석 계층:
  - `computeAlgoSignals` 결과를 감싸는 `MagicSplitFacts`를 추가한다.
  - 포함 항목: 기술지표 요약, consensus/conflicts, support/resistance, volatility/liquidity/range, news/disclosure/market evidence, data quality.
  - 종목추천과 차수추천은 이 facts를 입력받는 adapter를 각각 둔다.

- 데이터 품질 정책:
  - `<30봉 blocked`: 종목 자동 추천 제외, 차수추천 생성 금지, “데이터 부족” 보류 결과 표시.
  - `30~59봉 limited`: 종목 점수 최대 60, tier 최대 `moderate`, `confidence=low`.
  - `30~59봉 limited` 차수추천: `maxStages <= 3`, 추가매수 간격 `2.0%~3.5%`, 목표수익 `1.5%~4.0%`, 금액 증가는 최대 1.5배.
  - `60봉 이상 normal`: 기존 지표 전체 사용.

- 뉴스 확장:
  - `NewsFetcher`는 `query/display/start/sort` 옵션을 받도록 확장한다.
  - 별도 `news-evidence` helper에서 query variant 생성, 중복 제거, 클러스터링, 요약 pack 생성을 담당한다.
  - 종목당 최대 6개 query variant, `sort=date|sim`, `display=30`, `start=1`, 최대 12회 호출.
  - 종목당 최대 8개 뉴스 클러스터, 클러스터당 대표 기사 2개.
  - LLM 입력은 종목추천 1,800자, 차수추천 2,400자 이내로 압축한다.

- KRX/ECOS/DART 확장:
  - KRX: 기존 일별시세/기본정보에 더해 투자자별 거래실적, 공매도 관련 데이터 후보를 검토한다.
  - ECOS: 기존 환율/콜금리에 시장금리, 소비심리, 물가/유동성 계열을 추가 후보로 둔다.
  - OpenDART: 기존 최근 공시에 단일회사 주요계정, 주요 재무지표, 배당, 증자/감자, 주요사항보고서 정보를 추가 후보로 둔다.
  - 무료 공공데이터는 구현 후보에 포함한다. 유료/서드파티 뉴스·재무 데이터는 가격 검토용 추천 목록만 만든다.

- 차수추천 UX:
  - 진입 자동 요청 제거.
  - “AI 차수 분석” 버튼 클릭 시 전체 분석 실행.
  - 분석 중에는 넓은 preview modal을 열고 진행 상태를 보여준다.
  - 추천이 없을 때도 모달에 보류 사유, 부족 데이터, 충돌 근거를 표시한다.

- 모달 UI:
  - 종목추천 모달: `min(96rem, calc(100vw - 3.2rem))`.
  - 왼쪽 22rem 리스트, 오른쪽 상세 패널. 선택 종목의 추천 이유, 기술지표, 뉴스 클러스터, 공시, 시장지표, 리스크를 구역별로 표시한다.
  - 차수추천 모달: `min(92rem, calc(100vw - 3.2rem))`.
  - 왼쪽 18rem 차수 리스트, 오른쪽 차수별 근거/가격/수량/리스크/전제 조건 표시.
  - 860px 이하에서는 상하 스택으로 전환한다.

## References
- Naver 뉴스 API: https://developers.naver.com/docs/serviceapi/search/news/news.md
- KRX Open API/Data Marketplace: https://openapi.krx.co.kr/ , https://data.krx.co.kr/
- ECOS Open API: https://ecos.bok.or.kr/api/
- OpenDART: https://opendart.fss.or.kr/guide/main.do
- List/details UI pattern: https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details
- Backtest overfitting 참고: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253

## Test Plan
- `MagicSplitFacts` 테스트:
  - `<30`, `30~59`, `60+` data quality 분기.
  - 종목추천/차수추천이 같은 facts를 공유하는지 검증.

- 뉴스 테스트:
  - 여러 query/sort에서 들어온 유사 뉴스가 하나의 클러스터로 묶이는지 검증.
  - query 수, cluster 수, 대표 기사 수, LLM 입력 길이 제한 검증.

- 종목추천 테스트:
  - limited 종목의 score/tier/confidence cap 검증.
  - blocked 종목이 자동 추천에서 제외되고 보류 사유가 표시되는지 검증.

- 차수추천 테스트:
  - 버튼 클릭 전에는 요청이 나가지 않는지 검증.
  - 클릭할 때마다 full fresh analysis가 실행되는지 검증.
  - limited 종목의 `maxStages`, trigger/profit/amount 제한 검증.
  - preview metadata가 `StrategyProfile`에 저장되지 않는지 검증.

- UI 테스트:
  - 종목추천 master-detail 선택 동작.
  - 차수추천 차수 리스트/상세 패널 동작.
  - 860px 이하 반응형 스택 확인.

## Acceptance Criteria
- 종목추천과 차수추천의 주요 판단 근거가 같은 `MagicSplitFacts`에서 나온다.
- 추천/보류 결과마다 기술지표, 뉴스, 공시, 시장지표 중 어떤 근거가 쓰였는지 추적 가능하다.
- 차수추천은 자동 실행되지 않고, 버튼 클릭 시에만 매번 새 분석을 수행한다.
- 데이터 부족/충돌 상황에서 AI가 무리한 추천을 만들지 않는다.
- 추천 적용 전에는 어떤 전략 설정도 저장되지 않는다.
