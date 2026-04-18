# 실시간 트레이딩 패널 — 호가 · 체결 · 주문 · 단축키

NM-014. HTS 스타일 3분할 패널(호가창 / 주문 티켓+미체결 / 체결창) + WS 프레임 파이프라인 + 즉시 주문 라우터를 다룹니다.

상위 인덱스: [../README.md](../README.md)

## 1. 전체 구조

```
                ┌──────────────────────────┐
                │  KIS WS (H0STCNT0/ASP0)  │
                └────────────┬─────────────┘
                             ▼
        ┌─────────────────────────────────────┐
        │ KisWsClient.onMessage(raw) —────────┤
        │   → ws-frame-parser.parseH0STCNT0() │
        │   → ws-frame-parser.parseH0STASP0() │
        └────────────┬────────────────────────┘
                     ▼
        ┌─────────────────────────────────────┐
        │ RealtimeService.dispatchFrame()     │
        │   → FeedBus.emitTick / emitOrderbook│
        └────────────┬────────────────────────┘
                     ▼
        ┌─────────────────────────────────────┐
        │ FeedBus (in-process pub/sub)        │
        │   • latestTick Map, latestOrderbook │
        │   • subscribeTick / subscribeOrderbook│
        └────────────┬────────────────────────┘
                     ▼
        ┌─────────────────────────────────────┐
        │ realtimeRouter.getLatestTick/…       │
        │  ← useLiveTick / useLiveOrderbook   │
        │  ← OrderbookPanel / TradeFeedPanel   │
        └─────────────────────────────────────┘
```

Renderer는 HTTP 스트리밍을 사용하지 않고 **main 메모리의 latest 스냅샷을 짧은 주기로 polling** (tick=1s, orderbook=500ms). 그 사이 실제 WS 프레임은 main에서 FeedBus로 push되어 다음 polling에 반영됩니다.

## 2. WS Frame Parser

[src/main/kis/ws-frame-parser.ts](../../src/main/kis/ws-frame-parser.ts)

### Frame 구조

```
"{암호화구분}|{tr_id}|{데이터건수}|{payload}"
payload = 필드1^필드2^…^필드N   (복수 레코드 지원 — N * fieldsPerRecord)
```

- `parseEnvelope(frame, fieldsPerRecord)` — 공용 헤더 파서. 잘못된 count나 부족한 필드는 `null`.
- `parseH0STCNT0(frame)` — 체결가 46필드 → `TickUpdate[]`
- `parseH0STASP0(frame)` — 호가 59필드 → `OrderbookUpdate[]` (매도/매수 10단 price[3..22] + qty[23..42])

### TickDirection 코드 매핑

| KIS 코드 | 의미 |
| --- | --- |
| `1` | `UPPER_LIMIT` (상한가) |
| `2` | `UP` |
| `3` | `FLAT` |
| `4` | `DOWN` |
| `5` | `LOWER_LIMIT` (하한가) |

### 테스트 방법

[src/main/kis/ws-frame-parser.test.ts](../../src/main/kis/ws-frame-parser.test.ts) — 실제 KIS 샘플 프레임 기반 parseEnvelope 경계/부족필드/복수 레코드 chunk, H0STCNT0 46필드 파싱, H0STASP0 asks/bids 10단 쌍 결합 커버.

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 필드 수 부족 | `parseEnvelope` 가 `null` 반환, 파서가 빈 배열 |
| 알려지지 않은 `tr_id` | `parseH0STCNT0` / `parseH0STASP0` 가 각자 `trId` mismatch 로 빈 배열 |
| 복수 레코드 (`count > 1`) | fieldsPerRecord 단위 chunk 로 N 개 업데이트 모두 emit |
| 숫자 파싱 불가 | `toNum` 이 `0` 반환 |

## 3. FeedBus

[src/main/realtime/feed-bus.ts](../../src/main/realtime/feed-bus.ts)

### API

```ts
class FeedBus {
  emitTick(update: TickUpdate): void;
  emitOrderbook(update: OrderbookUpdate): void;
  subscribeTick(pdno, listener): () => void;  // unsubscribe 반환
  subscribeOrderbook(pdno, listener): () => void;
  getSubscriberCount(pdno): { tick: number; orderbook: number };
  getLatestTick(pdno): TickUpdate | null;
  getLatestOrderbook(pdno): OrderbookUpdate | null;
  clear(): void;
}
```

### 보장

- 종목별 독립된 listener Set — 다른 종목의 emit은 영향 없음.
- **초기 스냅샷 제공**: 신규 구독자에게 `latestTick`/`latestOrderbook` 가 있으면 즉시 전달해 빈 화면 방지.
- `Array.from(entry.tick)` 로 복사 후 순회 — listener가 unsubscribe 해도 안전.

### 테스트

[src/main/realtime/feed-bus.test.ts](../../src/main/realtime/feed-bus.test.ts) — emit/subscribe/unsubscribe/스냅샷/구독자 카운트.

## 4. RealtimeService

[src/main/realtime/realtime-service.ts](../../src/main/realtime/realtime-service.ts)

`KisWsClient + FeedBus` 결합 서비스. env별 인스턴스 (context에서 `setCurrentEnv` 훅으로 lazy 재생성).

### API

```ts
await realtime.start(appKey, appSecret);  // approval_key 발급 + WS 연결
realtime.watch(pdno, 'tick');       // refcount++ → 첫 구독이면 H0STCNT0 subscribe
realtime.watch(pdno, 'orderbook');  //                H0STASP0
realtime.unwatch(pdno, 'tick');     // refcount-- → 0이면 unsubscribe
realtime.stop();                    // 모든 WS 정리
realtime.isStarted();
realtime.getWatched(); // [{ pdno, tick, orderbook }]
```

### Ref-counting 규약

- `watch()` 는 topic별 카운터를 증가 — 여러 컴포넌트가 같은 종목을 구독해도 안전.
- `unwatch()` 후 `tick===0 && orderbook===0` 이면 entry 삭제.
- `start()` 재호출 시 기존 watches 자동 복원 (`ensureWsSubscription`).

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| KIS WS가 20종목 초과 | `subscribe` 가 `VALIDATION` 에러 → `realtime.subscribe_failed (WARN)` 로그, UI 는 빈 호가 계속 표시 |
| WS 연결 끊김 | KisWsClient 내부 지수백오프 재연결 + 구독 자동 복원 |
| env 전환 | `onEnvChange` 콜백이 기존 `realtime.stop()` → 신규 env로 새 인스턴스. bus는 공유. |
| `stop()` 호출 후 `watch()` | entry는 map에 유지되지만 WS 호출 없음. 이후 `start()` 시 복원. |

## 5. realtimeRouter (tRPC)

[src/main/trpc/routers/realtime-router.ts](../../src/main/trpc/routers/realtime-router.ts) — 모두 `authedProcedure`.

| 엔드포인트 | 입력 | 동작 |
| --- | --- | --- |
| `realtime.start` | — | credentials → `approval_key` 발급 → WS 연결. 이미 시작됐으면 `{ok:true}` |
| `realtime.stop` | — | WS 정리 |
| `realtime.status` | — | `{ started, watched: [{pdno,tick,orderbook}] }` |
| `realtime.watch` | `{ pdno, topic }` | refcount 증가 |
| `realtime.unwatch` | `{ pdno, topic }` | refcount 감소 |
| `realtime.getLatestTick` | `{ pdno }` | 최신 tick 스냅샷 |
| `realtime.getLatestOrderbook` | `{ pdno }` | 최신 호가 스냅샷 |

## 6. orderRouter — 즉시 주문 (tRPC)

[src/main/trpc/routers/order-router.ts](../../src/main/trpc/routers/order-router.ts) — 모두 `authedProcedure`.

### `order.placeCash({ side, pdno, qty, price, division })`

1. credentials → 토큰 확보
2. **`ctx.safety.canTrade(input.pdno)` 검증** — false 면 `FORBIDDEN`
3. `orderCash(deps, input)` 호출
4. 성공 시 `orders` 테이블에 PENDING 기록 + **`orgNo` (KRX_FWDG_ORD_ORGNO) 저장**

### `order.amend(input: KisOrderAmendRequest)`

정정/취소. `action='cancel'` 성공 시 `orders.status='CANCELLED'` 업데이트.

### `order.listActive`

`status IN ('PENDING','PARTIAL')` 주문을 `placedAt ASC` 순으로 반환. UI 는 2초 polling.

### `order.cancelMany({ odnos: string[] })`

선택한 주문들을 일괄 취소.

- DB 에 저장된 `orgNo` 를 사용 (정정/취소는 KIS 요구사항)
- `orgNo` 가 `null` 이면 해당 건은 스킵 + `reason: 'orgNo 누락 — 정정/취소 불가'` 응답
- 성공한 건만 DB status=`CANCELLED` 로 업데이트
- 반환: `{ results: [{ odno, ok, reason? }] }`

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| safety.canTrade=false | placeCash → 403 FORBIDDEN. 주문 자체가 발생하지 않음 |
| orgNo 누락 (레거시 주문) | cancelMany 에서 해당 건 skip, 원인 메시지 응답 |
| 실전 환경 | 안전장치는 라우터 레벨 + 클라이언트 확인 모달 2중 적용 |
| 50건 초과 요청 | Zod `max(50)` 에서 `BAD_REQUEST` |

## 7. OrderTicket (주문 티켓 UI)

[src/renderer/src/features/order-ticket/](../../src/renderer/src/features/order-ticket/)

### Props

```ts
interface OrderTicketProps {
  selection: { pdno, name, suggestedPrice?, suggestedSide? };
  isProd: boolean;   // PROD 환경 여부
  oneClick: boolean; // 원터치 모드 (PROD 에서는 강제 OFF)
}
```

### 동작

- `suggestedPrice`/`suggestedSide` 변경 시 폼 필드 자동 prefill (호가창 클릭 연동)
- 구분 `LIMIT`/`MARKET`, 수량, 가격 입력 검증 (시장가는 price=0 자동)
- 매수/매도 버튼 분리 (색상도 한국식 — 매수 빨강 / 매도 파랑)
- **PROD 또는 oneClick=off** → `window.confirm` 으로 주문 내역 재확인 모달
- 주문 결과 `onPlaced({ odno, side })` 콜백

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| PROD + oneClick=true (코드/설정 오설정) | `useOrderHotkeys` 와 `OrderTicket` 양쪽에서 **강제 OFF** (PROD 우선) |
| 시장가 선택 | price 필드 disabled + 표시 문자열 `'시장가'` |
| qty 비정수 / ≤0 | `canSubmit=false` → 버튼 비활성 |

### 테스트

[src/renderer/src/features/order-ticket/ui/order-ticket.test.tsx](../../src/renderer/src/features/order-ticket/ui/order-ticket.test.tsx) — 매수/매도 제출, PROD 확인 모달 강제, prefill, MARKET price disabled.

## 8. TradingPanel (widget)

[src/renderer/src/widgets/trading-panel/](../../src/renderer/src/widgets/trading-panel/)

3-column grid: **호가창 / (주문티켓 + 미체결) / 체결창**.

대시보드에서 보유 종목 행 클릭 시 [PositionChart](../../src/renderer/src/pages/dashboard/ui/position-chart.tsx) 아래에 `TradingPanel` 이 함께 전개됩니다.

### 구성

- **[OrderbookPanel](../../src/renderer/src/widgets/trading-panel/ui/orderbook-panel.tsx)**: 10단 호가 (매도 상단 10단 역순 → 매수 하단 10단). 행 클릭 시 `onClickPrice(price, side)` — order-ticket prefill. 잔량 bar(매도=파랑, 매수=빨강 반투명), 현재가 강조.
- **[TradeFeedPanel](../../src/renderer/src/widgets/trading-panel/ui/trade-feed-panel.tsx)**: 최근 200건 ring buffer. `tickDirection` 기반 색상 (UP=빨강/DOWN=파랑/FLAT=회색).
- **[ActiveOrdersPanel](../../src/renderer/src/widgets/trading-panel/ui/active-orders-panel.tsx)**: `order.listActive` 2초 polling, 체크박스 멀티 선택 → "선택 취소 (N)" 버튼으로 `cancelMany`. `pdnoFilter` prop으로 현재 종목만 필터.
- **[OrderTicket](../../src/renderer/src/features/order-ticket/ui/order-ticket.tsx)**: 7절 참조.

### 호가창 ↔ 주문 티켓 autofill 규약

- 매도 호가 클릭 → `onClickPrice(price, 'BUY')` — 해당 가격으로 **매수** prefill (상대 호가 공략)
- 매수 호가 클릭 → `onClickPrice(price, 'SELL')` — 해당 가격으로 **매도** prefill

### 테스트

[src/renderer/src/widgets/trading-panel/ui/orderbook-panel.test.tsx](../../src/renderer/src/widgets/trading-panel/ui/orderbook-panel.test.tsx) — 10단 렌더, 잔량 bar 비율, 행 클릭 콜백 side 방향.

## 9. 단축키 (useOrderHotkeys)

[src/renderer/src/widgets/trading-panel/model/use-order-hotkeys.ts](../../src/renderer/src/widgets/trading-panel/model/use-order-hotkeys.ts)

HTS 친숙 매핑:

| 키 | 동작 |
| --- | --- |
| `F3` / `F9` | 매수 (side 전환) |
| `F4` / `F12` | 매도 |
| `F5` | 정정 |
| `F8` | 취소 |
| `Enter` (INPUT/TEXTAREA/SELECT 외) | 전송 |

### 안전장치

- `enabled=false` 이면 `useEffect` 가 아무 리스너도 등록하지 않음 (early return) — `TradingPanel` 이 **PROD 에서는 `hotkeys=false` 강제**.
- INPUT/TEXTAREA/SELECT 포커스 중 F-키 외에는 무시. `Enter` 만 전송 트리거로 허용.

## 10. 실시간 구독 라이프사이클 훅

[src/renderer/src/widgets/trading-panel/model/use-live-feed.ts](../../src/renderer/src/widgets/trading-panel/model/use-live-feed.ts)

- `useLiveTick(pdno, pollMs=1000)` — mount 시 `realtime.watch(pdno,'tick')`, unmount 시 `unwatch`. `getLatestTick` 1초 polling.
- `useLiveOrderbook(pdno, pollMs=500)` — 동일 패턴, orderbook 500ms.
- `useTradeFeed(pdno, capacity=200)` — tick을 ring buffer로 보존. `time + accumVolume` 조합으로 중복 tick 필터.

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 같은 pdno 여러 컴포넌트가 useLiveTick 호출 | RealtimeService refcount 증가, WS 구독은 1회만 |
| unmount 순서가 뒤바뀜 | refcount 기반이라 마지막 unmount 때만 KIS unsubscribe |
| polling 중 realtime 미시작 | `getLatestTick` 가 `{ tick: null }` — UI 는 "호가 로드 중..." 표시 |

## 11. PROD 안전장치 요약

실전 계좌 실수 주문을 막기 위한 다층 방어:

1. **라우터**: `ctx.safety.canTrade(pdno)` 가 false 면 즉시 403.
2. **UI**: `TradingPanel` 이 PROD 일 때 `oneClick=false` + `hotkeys=false` 강제 (prop 값 무시).
3. **OrderTicket**: PROD 또는 oneClick 해제 시 `window.confirm` 모달 강제. 문구에 종목 + 수량 + 금액 + `⚠️ 실전 계좌로` 명시.
4. **환경 전환**: 애초에 PROD 진입 자체가 [features/authentication.md](./authentication.md) 의 2단계 모달 (체크박스 + `실전전환` 타이핑) 필요.

## 12. 관련 DB 변경

- `orders` 테이블에 **`orgNo` 컬럼 추가** (KIS `KRX_FWDG_ORD_ORGNO`). 정정/취소에 필수이므로 placeCash 응답값을 저장.
- bootstrap-schema 동기화: [src/main/db/bootstrap-schema.ts](../../src/main/db/bootstrap-schema.ts).
- 기존 schema: [src/main/db/schema.ts](../../src/main/db/schema.ts) `orders.orgNo`.

## 13. 테스트 요약 (NM-014 기여분)

| 파일 | 케이스 수 |
| --- | --- |
| `ws-frame-parser.test.ts` | 다수 (envelope/복수/46·59 필드) |
| `feed-bus.test.ts` | pub/sub 라이프사이클 |
| `order-ticket.test.tsx` | 4개 (매수/매도/PROD 확인/prefill) |
| `orderbook-panel.test.tsx` | 행 클릭 / 잔량 bar |

전체 합산: 기존 199 → 222 passed (+23).
