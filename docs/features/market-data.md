# 시세 데이터 · 종목 검색 · 차트

US-007 / US-011 / NM-003 / NM-011 / NM-013. 현재가 / 잔고 / 일봉 차트 / 실시간 WebSocket / 티어드 시세 감시 / 종목 마스터 / 검색 UI 를 묶습니다.

상위 인덱스: [../README.md](../README.md)

## 1. 잔고 조회 (US-007)

### 사용 방법

```ts
const { positions, deposit, totalEval } = await trpc.account.getBalance.query();
```

내부적으로 [`inquireBalance`](../../src/main/kis/domestic-stock.ts) 가 `/uapi/domestic-stock/v1/trading/inquire-balance` 를 호출하고 응답을 `Position[]` + 예수금/총평가로 정규화합니다.

라우터: [src/main/trpc/routers/account-router.ts](../../src/main/trpc/routers/account-router.ts) — `authedProcedure`.

### TR_ID 분기

| 기능 | PROD | MOCK |
| --- | --- | --- |
| 잔고 | `TTTC8434R` | `VTTC8434R` |
| 매수 | `TTTC0012U` | `VTTC0012U` |
| 매도 | `TTTC0011U` | `VTTC0011U` |
| 정정/취소 | `TTTC0013U` | `VTTC0013U` |
| 현재가 | `FHKST01010100` (공용) | 동일 |
| 일봉 | `FHKST03010100` (공용) | 동일 |

정의: [src/main/kis/endpoints.ts](../../src/main/kis/endpoints.ts)

### 인증 필요 여부

- 필요. `ctx.currentEnv` + `credentials` + 발급된 토큰 필요. 토큰이 없거나 만료 6h 이내면 [AuthService](../../src/main/kis/auth.ts) 가 자동 갱신.

### 테스트 방법

- 단위: [src/main/kis/domestic-stock.test.ts](../../src/main/kis/domestic-stock.test.ts) — `undici MockAgent` 로 응답 정규화 / `rt_cd` 에러 / 토큰 만료 감지 / 현재가 파싱.
- 통합: `pnpm dev` 로 실 MOCK 서버에 잔고 조회.

### 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| `output1` 빈 배열 | `positions: []` 반환, UI 는 "보유 종목이 없습니다" |
| `output2` 누락 | deposit=0, totalEval=0 (옵셔널 처리) |
| 문자열 숫자 파싱 실패 | `parseNum` 이 `0` 반환하여 안전 |
| `rt_cd !== '0'` | `interpretRtCd` 로 `AUTH_FAILED`/`API_BUSINESS`/`VALIDATION`/`UNKNOWN` 분류 후 에러 반환 |

## 2. 현재가 (스팟)

### 사용 방법

```ts
const { price, dayChange, dayChangeRate, accumVolume } =
  await trpc.market.getPrice.query({ code: '005930' });
```

- TR_ID `FHKST01010100` (조회성, 실전/모의 공통).
- Bottleneck(초당 ~15건) 레이트리밋 공통 적용: [src/main/kis/http-client.ts](../../src/main/kis/http-client.ts).

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 상장폐지/미존재 코드 | `rt_cd` 비-0 → `API_BUSINESS` 에러 |
| 장 마감 후 조회 | 마지막 체결가가 반환, `acml_vol` 은 당일 누적 |

## 3. 일봉 차트 (NM-011)

### 사용 방법

```ts
const { candles } = await trpc.market.getDailyChart.query({
  code: '005930',
  months: 3,
});
```

- 엔진: [`inquireDailyChart`](../../src/main/kis/domestic-stock.ts) + Zod [`KisDailyChartResponseSchema`](../../src/shared/contracts/kis.ts).
- KIS 응답 `output2` 는 최신 날짜부터 역순이므로 **오래된 순으로 재정렬** 후 반환.
- 비거래일 / 상폐 후 빈 행은 `close > 0` 필터로 제거.

### 차수 오버레이 (UI)

- [`buildLotOverlay`](../../src/shared/trading/lot-overlay.ts) 는 `OPEN` 차수에서 `buy` 라인과 `sell-target = buyPrice * (1 + profitPct)` 라인을 생성.
- tRPC: `trpc.account.getPositionOverlay.query({ pdno })` 가 `strategyRepo` 에서 해당 종목 / 글로벌 순으로 `profitPct` fallback 후 `{ lines, profitPct }` 반환.
- 렌더: [PositionChart](../../src/renderer/src/pages/dashboard/ui/position-chart.tsx) 가 `lightweight-charts` v5 의 `CandlestickSeries` 에 `priceLine` 을 얹음 (buy=빨강 실선 / sell-target=파랑 점선).
- 대시보드 행 클릭 시 `selected` state 변경 → overlay 쿼리 enabled 되고 차트 패널 확장.

### 테스트 방법

- 단위: [src/main/kis/daily-chart.test.ts](../../src/main/kis/daily-chart.test.ts) (3 cases), [src/shared/trading/lot-overlay.test.ts](../../src/shared/trading/lot-overlay.test.ts) (6 cases — OPEN only, 오름차순, 익절가 계산, BUYING/SELLING 제외, includeSold 토글 등).

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| months > 24 | Zod 검증 실패 (`BAD_REQUEST`) |
| 주말 / 공휴일만 포함된 기간 | candles 빈 배열 반환, 차트는 "데이터 없음" |
| 차수 없음 (position 비어있음) | lines=[], 차트는 캔들만 |
| `BUYING`/`SELLING` 상태 차수 | 오버레이 제외 — 미확정 가격은 표시하지 않음 |
| 전략 미설정 | `profitPct=0.05` 기본값 |

## 4. 실시간 WebSocket (US-011) + Frame Parser (NM-014)

> 실시간 프레임을 파싱하고 UI 까지 전달하는 전체 파이프라인은 [realtime-trading.md](./realtime-trading.md) 를 참고하세요. 여기서는 KIS WS 클라이언트 계층만 다룹니다.


### 사용 방법

```ts
const client = new KisWsClient({
  env: 'MOCK',
  http: httpByEnv.MOCK,
  factory: (url) => new WebSocket(url) as unknown as WsLike,
  logger,
  onMessage: (msg) => { /* pipe-delimited 체결/호가 */ },
});
await client.start(appKey, appSecret);
client.subscribe({ tr: 'H0STCNT0', code: '005930' }); // 체결가
client.subscribe({ tr: 'H0STASP0', code: '005930' }); // 호가
```

엔진: [src/main/kis/ws-client.ts](../../src/main/kis/ws-client.ts).

### 보장

- `approval_key` 자동 발급 (`POST /oauth2/Approval`).
- `PINGPONG` 주기 하트비트(기본 30s) — 프레임 전송 실패 시 `ws.heartbeat.send_failed` WARN 로그 후 다음 주기 재시도.
- 연결 끊김 시 지수백오프 `1s → 2s → 4s → ... → max(30s)` 로 재연결. 기존 구독은 `onOpen` 에서 자동 재전송(`tr_type='1'`).
- `(tr_id, code, seq)` 튜플 기반 LRU dedup (크기 2048).
- 총 구독 합산 **20종목 상한** (`H0STCNT0` + `H0STASP0` 포함). 초과 시 `VALIDATION` 에러.
- `stop()` 은 `phase='closed'` 로 고정하고 heartbeat / reconnect timer / ws close(1000) 모두 정리.

### 테스트 방법

- [src/main/kis/ws-client.test.ts](../../src/main/kis/ws-client.test.ts) 9 cases:
  - approval 성공/실패
  - heartbeat 3회 발송 (FakeTimer 전진)
  - 재연결 + 재구독 자동 복원
  - 지수백오프 수열 100 → 200 → 400 → 800 → 1000 (max clamp 검증)
  - dedup (같은 seq 두 번 오면 1회만)
  - 20 slots 초과 시 VALIDATION
  - unsubscribe `tr_type='2'` 프레임 전송
  - stop() 후 추가 이벤트 무시

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| approval_key 만료 | 호출측이 새 `start(...)` 호출 (KisWsClient 내부 자동 재발급 없음 — 의도적으로 호출측 책임) |
| 비-JSON 프레임 `0|H0STCNT0|...` | `handleFrame` 이 `|` 분할 후 payload 첫 레코드에서 `code/seq` 추출, onMessage 호출 |
| JSON 제어 프레임 (`{header:{tr_id:'PINGPONG'}}`) | ACK 처리 — onMessage 호출하지 않음 |
| 중복 구독 (이미 등록된 key) | 두 번째는 `ok(undefined)` 반환, 구독 프레임 재전송하지 않음 |
| 20개 중 5개 해지 후 새 5개 추가 | 정상 (합산 20 이하) |

## 5. 티어드 시세 감시 (NM-003)

### 사용 방법

```ts
const feed = new TieredQuoteFeed({
  timer: realTimer,
  logger,
  poller: { fetch: async (pdno) => ({ price: await getRestPrice(pdno) }) },
  maxWsSlots: 20,
  restIntervalMs: 5_000,
  wsSubscribe: (pdno) => kisWs.subscribe({ tr: 'H0STCNT0', code: pdno }),
  wsUnsubscribe: (pdno) => kisWs.unsubscribe({ tr: 'H0STCNT0', code: pdno }),
  onUpdate: (u) => pushToEngines(u), // FSM / booster / prebuy 등
});
feed.watch({ pdno: '005930', tier: 'ws' });
```

엔진: [src/main/trading/tiered-quote-feed.ts](../../src/main/trading/tiered-quote-feed.ts).

### 동작 규약

- WS 슬롯 여유 → 요청 tier 로 배정. 슬롯 초과 → `rest` 로 **자동 강등**.
- `unwatch()` 로 여유 슬롯이 생기면 `rest` 중 `preferredTier==='ws'` 인 항목을 차례로 `ws` 로 **승격** (`tiered.promoted` INFO 로그).
- REST polling 은 단일 `setInterval(restIntervalMs)` 로 현재 `rest` 배정 전체를 순회. Bottleneck 과는 별개이지만 실제 `poller.fetch` 가 `KisHttpClient` 를 쓰므로 자동으로 레이트리밋 적용.
- WS 업데이트는 `feed.acceptWsUpdate({ pdno, price, at })` 로 외부에서 주입. 현재 배정 tier 가 `ws` 일 때만 `onUpdate` 호출.

### 테스트 방법

- [src/main/trading/tiered-quote-feed.test.ts](../../src/main/trading/tiered-quote-feed.test.ts):
  - maxWsSlots=2 에서 3개 watch → 3번째가 rest 배정
  - unwatch 시 rest → ws 승격 (wsSubscribe 호출 횟수 검증)
  - rest polling 이 `restIntervalMs` 마다 `poller.fetch` 호출
  - `acceptWsUpdate` 는 rest tier 항목에 대해서는 drop

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 이미 `rest` 로 감시 중인 pdno 를 `ws` 로 다시 watch | `preferredTier` 만 `ws` 로 업그레이드 요청, rebalance 트리거 |
| 모든 슬롯이 rest 뿐 | `wsSlotsUsed()=0` 이어도 `preferredTier==='rest'` 는 승격 대상이 아님 |
| REST fetch 실패 | `WARN WS/tiered.rest.fetch_failed` 로그 후 다음 주기 재시도 |
| dispose() 호출 | restInterval 정리 + 모든 ws 구독 해지 + 내부 맵 비움 |

## 6. 종목 마스터 (NM-003)

- 테이블: `stock_master { pdno PK, name, sector?, updatedAt }`
- 레포: [`StockMasterRepo`](../../src/main/trading/stock-master-repo.ts)
  - `upsertMany(entries)` — 트랜잭션 일괄 업서트
  - `find(pdno)` / `search(keyword, limit=20)` — `name` 또는 `pdno` LIKE `%kw%`, `name` 오름차순
- 주간 갱신을 권장하나 현재 버전은 수동 seed (KIS `search-stock-info` 또는 KRX 공시 CSV).

### 테스트 방법

- [src/main/trading/stock-master-repo.test.ts](../../src/main/trading/stock-master-repo.test.ts) — upsert (신규/업데이트), search 한글/코드, 공백 keyword, limit.

## 7. 종목 검색 UI (NM-013)

### 사용 방법

```tsx
<SearchStockInput onSelect={({ pdno, name }) => setSelected({ pdno, name })} />
```

- [features/search-stock](../../src/renderer/src/features/search-stock/)
- [`useStockSearch(term)`](../../src/renderer/src/features/search-stock/model/use-stock-search.ts): 400 ms debounce → `trpc.market.searchStock.query({ term, limit })` (publicProcedure)
- 드롭다운: 빈 결과 / 로딩 / 에러 / 결과 상태 구분, `ArrowUp/Down` 으로 `activeIndex` 이동, `Enter` 로 선택, `Escape` 로 닫기.

### 테스트 방법

- [src/renderer/src/features/search-stock/ui/search-stock-input.test.tsx](../../src/renderer/src/features/search-stock/ui/search-stock-input.test.tsx):
  - 빠른 연속 입력 중 쿼리 1회만 발생 (debounce)
  - 키보드 Arrow/Enter 로 선택 → `onSelect` 호출
  - 마우스 클릭 선택 (`onMouseDown` + `preventDefault` 로 `onBlur` 경쟁 방지)
  - 빈 term → 드롭다운 닫힘
  - 결과 0건 → "결과 없음" 표시

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 공백만 입력 | 빈 배열 반환 (`stock-master-repo.search` 내부 `trimmed` 빈 체크) |
| 한글 일부 (예: `삼성`) | `name` 부분일치 |
| 숫자 일부 (예: `0059`) | `pdno` 부분일치 |
| focus 잃은 직후 option 클릭 | `onMouseDown` 가 blur보다 먼저 실행되어 선택 유지 |
| 에러 (서버 장애) | 드롭다운에 `chip--down` 으로 에러 메시지 노출 |
