# Brokers — Hexagonal Port-Adapter

증권사(KIS, Kiwoom 등) 통합을 위한 헥사고날 port-adapter 레이어. 트레이딩 엔진/
tRPC 라우터/AI 모듈은 `BrokerPort` 추상에만 의존하고, 각 broker 의 wire-format
변환은 `kis/`, `kiwoom/` 등 namespace 안에 격리된다.

## 디렉터리 구조

```
src/main/brokers/
├── core/                          # broker-agnostic 인프라
│   ├── result.ts                  # neverthrow Result/ok/err 재export
│   ├── types.ts                   # Timer, WsFactory 등 (현재 kis/ws-client thin re-export)
│   ├── retry.ts                   # withExponentialBackoff (full jitter)
│   └── __tests__/retry.test.ts
├── ports/                         # 트레이딩/라우터가 의존하는 추상 인터페이스
│   ├── auth-port.ts               # ensureSession / invalidateSession
│   ├── order-port.ts              # placeOrder / cancelOrder / amendOrder / listDailyExecutions
│   ├── balance-port.ts            # inquireBalance
│   ├── market-port.ts             # getQuote / getOrderbook / getDailyOhlcv / isTradingDay
│   ├── realtime-port.ts           # start/stop/subscribe/subscribeExecutions
│   ├── broker-port.ts             # composite (Auth + Order + Balance + Market + realtime())
│   └── index.ts
├── kis/                           # KIS 구현
│   ├── adapter.ts                 # KisAdapter implements BrokerPort
│   ├── errors.ts                  # KisError → BrokerError 매핑
│   ├── mappers/                   # KIS wire → 도메인 모델
│   │   ├── balance.ts             # Position → Holding
│   │   ├── order.ts               # NormalizedOrderAck → OrderAck
│   │   ├── quote.ts               # QuoteResult → Quote
│   │   ├── orderbook.ts           # KIS OrderbookSnapshot → 도메인 OrderbookSnapshot
│   │   ├── candle.ts              # DailyCandle → Candle
│   │   └── executions.ts          # DailyCcldOrder → DailyExecution
│   └── __tests__/
│       ├── mappers.test.ts
│       └── errors.test.ts
├── kiwoom/                        # Stage 6 에서 신설 (현재 비어있음)
├── factory.ts                     # createBrokerPort(brokerId, deps) 분기
└── __tests__/
    ├── fake-broker-adapter.ts     # 결정론 in-memory adapter (trading 단위테스트용)
    └── fake-broker-adapter.test.ts
```

## 도메인 모델

`src/shared/contracts/broker.ts` — broker-agnostic Zod schemas:

| 타입 | 용도 |
|---|---|
| `BrokerId` | `'KIS' \| 'KIWOOM'` |
| `StockSymbol` | KRX 6자리 (글로벌 `Symbol` shadow 방지 위해 prefix) |
| `OrderIntent` | placeOrder 입력 (side, symbol, qty, price, kind, clientOrderId?) |
| `OrderAmendIntent` | cancel/amend 입력 (brokerOrderId, brokerOrgNo?, qty?, price?, ...) |
| `OrderAck` | 주문 접수 응답 (brokerOrderId, brokerOrgNo?, acceptedAt?) |
| `Holding` | 보유 종목 (symbol, name, qty, avgPrice, currentPrice, ...) |
| `Balance` | 잔고 (positions, deposit, d2Deposit, totalEval, estimatedAsset) |
| `Quote` | 현재가 (symbol, price, dayChange, accumVolume, open/high/low, ...) |
| `OrderbookSnapshot` | 호가 (symbol, time, asks, bids, totalAskQty, ...) |
| `Candle` | OHLCV (date, open, high, low, close, volume) |
| `DailyExecution` | 일별 주문/체결 |
| `RealtimeEvent` | discriminated union (TICK / ORDERBOOK / EXEC_NOTICE) |
| `BrokerError` | broker-agnostic 에러 ({brokerId, kind, msg, raw?, cause?}) |

## 사용 패턴

### tRPC 라우터/trading 모듈에서

```ts
// ctx.brokerForAccount(accountId) 로 활성 broker 획득
const broker = ctx.brokerForAccount(accountId);
if (!broker) throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });

const r = await broker.placeOrder({
  side: 'BUY', symbol: '005930', qty: 1, price: 70_000, kind: 'LIMIT',
});
if (r.isErr()) {
  // r.error.kind: 'NETWORK' | 'AUTH_FAILED' | 'BUSINESS' | ...
  // r.error.brokerId: 'KIS' | 'KIWOOM'
  // r.error.raw: { code?, subCode? } — broker 별 raw 코드 (디버깅용)
}
```

### 백그라운드 모듈에서

`createContextFactory` 의 반환값에 `getBroker(): BrokerPort | null` 헬퍼가 있다.
env/account 전환 시 자동 캐시 무효화.

```ts
const balanceSync = new BalanceSync({
  getBroker: () => factory.getBroker(),  // lazy, env 전환 자동 반응
  getAccountId: () => factory.getActiveAccountId(),
  lotsRepo,
  logger,
});
```

### 단위 테스트

```ts
import { FakeBrokerAdapter } from '@main/brokers/__tests__/fake-broker-adapter';

const broker = new FakeBrokerAdapter({
  balance: { positions: [...], deposit: 1_000_000, ... },
  forceError: { brokerId: 'KIS', kind: 'NETWORK', msg: 'down' },  // optional
});

// 호출 검증:
expect(broker.callCount.placeOrder).toBe(1);
expect(broker.placedOrders[0]).toEqual({ side: 'BUY', ... });
```

## 신규 broker 추가 (Stage 6 — Kiwoom)

cluefin (https://github.com/kgcrom/cluefin/tree/main/packages/cluefin-openapi-ts/src/kiwoom)
를 참조하여 다음 파일을 추가:

```
brokers/kiwoom/
├── auth.ts                        # KiwoomAuth (POST /oauth2/token)
├── http-client.ts                 # core/http 사용, Authorization Bearer + api-id 헤더
├── socket-client.ts               # JSON WS 프로토콜 (LOGIN/REG/REMOVE/REAL)
├── adapter.ts                     # KiwoomAdapter implements BrokerPort
├── errors.ts                      # Kiwoom return_code → BrokerError 매핑
├── metadata/endpoints.ts          # api-id 매핑 (kt10000~kt10003 주문, ka10004/06/75/76 등)
├── schemas/                       # Zod wire-format
└── mappers/                       # Kiwoom wire → 도메인
```

`factory.ts` 의 분기에 KiwoomAdapter 추가 (현재 `NOT_IMPLEMENTED` 에러 throw).

### Kiwoom REST endpoint 매핑

**Base URL** (공식 https://openapi.kiwoom.com 가이드 + KiwoomRestApi.Net 검증):
- PROD: `https://api.kiwoom.com`
- MOCK: `https://mockapi.kiwoom.com` (KRX 만 지원)

**OAuth**: `POST /oauth2/token` body `{grant_type:'client_credentials', appkey, secretkey}` →
`{token_type, token, expires_dt:'YYYYMMDDHHMMSS', return_code:0, return_msg:'정상...'}`

**공통 헤더**:
- `authorization: Bearer <token>`
- `api-id: <kt/ka prefix>`
- `cont-yn: 'N'|'Y'` (페이지네이션)
- `next-key: ''|<key>` (페이지네이션)

**도메인 ↔ api-id 매핑** (KiwoomRestApi.Net 검증):

| Domain 메서드 | api-id | path | body 필드 | 비고 |
|---|---|---|---|---|
| `placeOrder(BUY)` | `kt10000` | `/api/dostk/ordr` | `dmst_stex_tp`, `stk_cd`, `ord_qty`, `trde_tp`, `ord_uv`, `cond_uv?` | KRX/NXT/SOR |
| `placeOrder(SELL)` | `kt10001` | `/api/dostk/ordr` | 동일 | |
| `amendOrder` | `kt10002` | `/api/dostk/ordr` | `dmst_stex_tp`, `orig_ord_no`, `stk_cd`, `mdfy_qty`, `mdfy_uv`, `mdfy_cond_uv?` | |
| `cancelOrder` | `kt10003` | `/api/dostk/ordr` | `dmst_stex_tp`, `orig_ord_no`, `stk_cd`, `cncl_qty` (`0`=전량) | |
| `inquireBalance` (계좌평가잔고내역) | `kt00018` | `/api/dostk/acnt` | `qry_tp`, `dmst_stex_tp` | 보유종목 + 평가금액 |
| (예수금) | `kt00001` | `/api/dostk/acnt` | — | 예수금/D+2 분리 조회용 |
| (계좌평가현황) | `kt00004` | `/api/dostk/acnt` | — | totalEval 보강 |
| `listDailyExecutions(filledOnly=false)` | `ka10075` | `/api/dostk/acnt` | `all_stk_tp`, `trde_tp`, `stex_tp`, `stk_cd?` | 미체결요청 |
| `listDailyExecutions(filledOnly=true)` | `ka10076` | `/api/dostk/acnt` | `qry_tp`, `sell_tp`, `stex_tp`, `stk_cd?`, `ord_no?` | 체결요청 |
| `getQuote` | `ka10006` | `/api/dostk/mrkcond` | `stk_cd` | 현재가 |
| `getOrderbook` | `ka10004` | `/api/dostk/mrkcond` | `stk_cd` | 10단계 호가 |
| `getDailyOhlcv(D)` | `ka10081` | `/api/dostk/chart` | `stk_cd`, `base_dt`, `upd_stkpc_tp` | 일봉 |
| `getDailyOhlcv(W)` | `ka10082` | `/api/dostk/chart` | 동일 | 주봉 |
| `getDailyOhlcv(M)` | `ka10083` | `/api/dostk/chart` | 동일 | 월봉 |
| `isTradingDay` | (Kiwoom 미제공) | — | — | shared/market-rules KRX 휴장일 폴백 |

**참고 (필요 시 추가 활용 가능한 endpoint)**:
- `ka10072`/`ka10073`/`ka10074` — 일자별/기간별 실현손익 (회고 use-case 활용)
- `kt00007`/`kt00009` — 계좌별 주문체결 상세 / 현황 (manual reconciler 보강)

**페이지네이션**: 응답 헤더 `cont-yn === 'Y'` 면 다음 페이지 존재. 다음 요청에
`cont-yn: 'Y'`, `next-key: <응답 헤더값>` 보냄. mapper 안에서 loop until `cont-yn === 'N'`.

### Kiwoom WebSocket

**Endpoint** (KiwoomRestApi.Net 검증):
- PROD: `wss://api.kiwoom.com:10000/api/dostk/websocket`
- MOCK: `wss://mockapi.kiwoom.com:10000/api/dostk/websocket`

**프로토콜** (JSON):

```jsonc
// 1. Login
{ "trnm": "LOGIN", "token": "<access_token>" }
// 2. Subscribe (REG)
{
  "trnm": "REG",
  "grp_no": "1",
  "refresh": "1",
  "data": [{ "item": ["005930"], "type": ["0B", "0D"] }]
}
// 3. Unsubscribe (REMOVE)
{ "trnm": "REMOVE", "grp_no": "1", "data": [{ "item": ["005930"], "type": ["0B"] }] }
// 4. 실시간 데이터 (REAL)
{ "trnm": "REAL", "data": [{ "type": "0B", "name": "주식체결", "item": "005930", "values": {...} }] }
```

**서비스 type 코드** (전체 — KiwoomRestApi.Net `KiwoomWebSocketServiceName`):

| code | 이름 | 도메인 매핑 |
|---|---|---|
| `00` | 주문체결 | `RealtimeEvent.EXEC_NOTICE` |
| `04` | 잔고 | (잔고 변경 자동 트리거 — `BalanceSync.refresh()` 연계 가능) |
| `0A` | 주식기세 | (옵션 — 사용 안 함) |
| `0B` | 주식체결 | `RealtimeEvent.TICK` |
| `0C` | 주식우선호가 | (옵션) |
| `0D` | 주식호가잔량 | `RealtimeEvent.ORDERBOOK` |
| `0E` | 주식시간외호가 | (장외 — 옵션) |
| `0F` | 주식당일거래원 | (옵션) |
| `0G` | ETF NAV | (옵션) |
| `0H` | 주식예상체결 | (옵션 — 동시호가 시간) |

**조건검색** (선택 기능, kt10000-3 이외 별도):
- `ka10171` 조건검색 목록 (`{trnm: 'CNSRLST'}`)
- `ka10172` 조건검색 일반 (`{trnm: 'CNSRREQ', seq, search_type:'0', stex_tp:'K', cont_yn, next_key}`)
- `ka10173` 조건검색 실시간 (`search_type:'1'`)

**용량/제약**:
- WS 동시 구독 한도: 미공개 (KIS 의 20 종목 보다 큰 것으로 알려짐). Stage 6.5 라이브 검증 시 confirm
- Mock 환경 KRX 만 지원 (NXT/SOR 라우팅은 PROD 만)
- Rate limit: 공식 가이드 미공개. KiwoomRestApi.Net 은 별도 limiter 없이 동작 — 보수적 추정 5-10 rps

## 마이그레이션 진행 (commit hash)

| Stage | Commit | 내용 |
|---|---|---|
| 0 | 1ee313f | 도메인 모델 + KRX 호가 규칙 분리 |
| 1 | 092b0fe | brokers/core + ports 인터페이스 |
| 2 | 5c28c0b | KisAdapter + 6개 mappers |
| 3 | 0f17428 | ctx.brokerForAccount + getBroker() |
| 4a | 67871bc | Timer/realTimer 경로 정리 (8 파일) |
| 4b | fc6b05e | ai/ensure-candles → BrokerPort.getDailyOhlcv |
| 4c | c5b94a0 | market-router.getDailyChart → BrokerPort |
| 4d | 84185fb | RotatingQuoteFeed/env-aware-price-poller → BrokerPort |
| 4e | 6cdfd8e | FakeBrokerAdapter + FakeRealtimePort |
| 4f | c96aa96 | BalanceSync → BrokerPort.inquireBalance |
| 4g | f4f1b39 | MarketSessionGuard → BrokerPort.isTradingDay |
| 4h | 602e54c | correctLimitPrice import → @shared/market-rules |
| 4i | e3bd372 | brokers/AGENTS.md 아키텍처 가이드 |
| 4j | a5ef92f | ManualOrderReconciler → BrokerPort.listDailyExecutions |
| 4k | a866955 | watch-order-executor (executeWatch/StrategyOrder) → BrokerPort.placeOrder |
| 4l | 8f84b06 | account-router (getBalance + getBalanceWithLots) → BrokerPort + 백컨버터 |
| 4m | c2c3e22 | market-router (getOrderbook + getPrice) → BrokerPort + 백컨버터 |
| 4n | 6894923 | order-router (placeCash + amend + cancelMany) → BrokerPort + 백컨버터 |

## 잔여 stage

- **Stage 4 잔여**:
  - `trading/manual-order-reconciler.ts` (inquireDailyCcld → listDailyExecutions)
  - `trading/watch-order-executor.ts` (orderCash → BrokerPort.placeOrder)
  - `realtime/realtime-service.ts` (RealtimePort 본문 — KisAdapter 의 H0STCNT0/H0STASP0
    프레임 파싱 + WS 풀 통합)
  - `account-router` / `order-router` / `market-router.getOrderbook`/`getPrice` —
    renderer wire-shape compat helper (KIS 응답 구조 ↔ 도메인 모델 양방향) 필요
- **Stage 5a**: DB 스키마 — `credentials.broker` 컬럼 + `(env, broker)` UNIQUE,
  `access_tokens` PK `(broker, env)` 마이그레이션
- **Stage 5b**: UI Wizard — Step1 broker 선택 / Step2 환경 / Step3 broker 별 키
  입력 form. List 화면에 broker chip
- **Stage 6**: Kiwoom REST/WS adapter 본문 구현
- **Stage 6.5**: Kiwoom 라이브 e2e (사용자 키 발급 후)
- **Stage 6.6**: Kiwoom 탭 활성화
- **Stage 7**: 물리 파일 이동 — `src/main/kis/*` → `src/main/brokers/kis/*`,
  deprecation shim(`kis/price-correction.ts`, `kis/price-tick.ts`) 삭제
- **Stage 8**: renderer `KisError` 사용처를 `BrokerError` 로 전환

## 검증

각 stage PR 머지 게이트:

```bash
pnpm typecheck                    # tsc -b — 0 errors
pnpm test                         # vitest projects: main + renderer
pnpm lint                         # biome — 0 violations
pnpm build                        # electron-vite — success
```

수동 e2e (Stage 4 잔여/Stage 5/6.5 시):
1. 모의 계좌: 잔고 / 주문 / 취소 / 시세 / 호가 / 일봉 / 실시간 5tick
2. PROD/MOCK 토글 후 재검증
3. AI 추천 + 전략 추천
4. 자동매매 모의 1세션 (BUY → 미체결 자동취소 → 재주문)
