# 주문 실행 · 미체결 자동취소

US-010 + NM-001. KIS 현금 매수/매도/정정/취소 어댑터와 지정가 주문의 미체결 감시/자동 취소를 다룹니다.

> 실시간 패널에서 호가창 클릭 → 주문 티켓 연동 흐름은 별도 문서: [realtime-trading.md](./realtime-trading.md).

상위 인덱스: [../README.md](../README.md)

## 1. 현금 주문 (US-010)

### 사용 방법

```ts
import { orderCash } from '@main/kis/order';

const r = await orderCash(deps, {
  side: 'BUY',          // 'BUY' | 'SELL'
  pdno: '005930',
  qty: 10,
  price: 74500,         // 지정가. MARKET 이면 0
  division: 'LIMIT',    // 'LIMIT' | 'MARKET'
});
if (r.isOk()) {
  const { odno, orgNo, orderedAt } = r.value;
}
```

코어: [src/main/kis/order.ts](../../src/main/kis/order.ts)

`deps` 구조:
```ts
interface OrderDeps {
  http: KisHttpClient;
  env: AppEnv;
  token: string;
  appKey: string;
  appSecret: string;
  accountNo8: string;
  accountProdCd: string;
  logger: EventLogger;
}
```

### TR_ID 분기

| 동작 | 실전 | 모의 |
| --- | --- | --- |
| 현금 매수 | `TTTC0012U` | `VTTC0012U` |
| 현금 매도 | `TTTC0011U` | `VTTC0011U` |
| 정정/취소 | `TTTC0013U` | `VTTC0013U` |

`endpoints.trId(...)` 가 환경별로 매핑 ([src/main/kis/endpoints.ts](../../src/main/kis/endpoints.ts)).

### ORD_DVSN / ORD_UNPR 규칙

| `division` | `ORD_DVSN` | `ORD_UNPR` |
| --- | --- | --- |
| `LIMIT` | `'00'` | 지정가 (price > 0 강제) |
| `MARKET` | `'01'` | `'0'` (가격 필드 의미 없음) |

### 정정/취소

```ts
const r = await cancelOrRevise(deps, {
  action: 'cancel',       // 'cancel' | 'revise'
  orgOrgNo: '00950',      // 원주문 조직번호 (KRX_FWDG_ORD_ORGNO)
  orgOdno: '0000012345',  // 원주문번호
  division: 'LIMIT',
  qty: 10,
  price: 0,               // 취소는 0, revise LIMIT는 >0
  qtyAllOrder: false,     // true면 QTY_ALL_ORD_YN='Y'
});
```

- `RVSE_CNCL_DVSN_CD`: 취소 = `'02'`, 정정 = `'01'`.
- 취소는 `ORD_UNPR='0'` 강제. `revise + LIMIT` 는 `price > 0` 검증.

### 이벤트 로깅 (마스킹)

- 모든 요청/응답은 [event_logs](./observability.md) 에 기록.
- `ODNO`, `orgOdno` 는 [`hashIdentifier(raw)`](../../src/main/logging/event-logger.ts) 로 sha256 앞 12자로 치환 → 평문 ID 노출 방지.
- `accountNo8 + accountProdCd` 도 해시로 전달.
- 로그 라인 목록:
  - `order.cash.request {BUY|SELL}` (INFO)
  - `order.cash.network_error` (ERROR)
  - `order.cash.response_malformed` (ERROR)
  - `order.cash.business_error` (WARN) — KIS `rt_cd` 비-0
  - `order.cash.accepted` (INFO) — ODNO 해시만
  - `order.amend.request {cancel|revise}` + `.accepted` / `.business_error` / `.network_error` / `.response_malformed`

### 인증 필요 여부

- 필요. 호출 전 `AuthService.getValidToken` 으로 토큰 확보 + `credentials.accountNo8/accountProdCd` 필수.
- tRPC 래퍼: [`orderRouter`](../../src/main/trpc/routers/order-router.ts) 의 `placeCash` / `amend` / `listActive` / `cancelMany` 가 모두 `authedProcedure`. Renderer는 직접 `orderCash` 를 호출할 수 없고 반드시 이 라우터 경유 (자세한 사용 예는 [realtime-trading.md §6](./realtime-trading.md#6-orderrouter--즉시-주문-trpc)).

### orderRouter 보강 계약

| 엔드포인트 | 추가 검증 / 부수 효과 |
| --- | --- |
| `order.placeCash` | `ctx.safety.canTrade(pdno)=false` 면 403. 성공 시 `orders` 테이블에 PENDING + **`orgNo` (KRX_FWDG_ORD_ORGNO) 저장** — 이후 정정/취소에 필수 |
| `order.amend` | `action='cancel'` 성공 시 `orders.status='CANCELLED'` 자동 업데이트 |
| `order.listActive` | `status IN ('PENDING','PARTIAL')` 주문을 `placedAt ASC` 로 반환 |
| `order.cancelMany({ odnos })` | 저장된 `orgNo` 로 각 건 취소. `orgNo` 누락 건은 `ok:false, reason:'orgNo 누락'` 로 스킵 (`{results:[...]}` 응답) |

### 테스트 방법

[src/main/kis/order.test.ts](../../src/main/kis/order.test.ts) 10 cases:

- BUY / SELL / MARKET 정상 요청 → headers/body 형식 검증
- `LIMIT + price=0` → `VALIDATION`
- `pdno` 6자리 아님 → `VALIDATION`
- `rt_cd` 비-0 → `API_BUSINESS`, `business_error` 로그
- 500 네트워크 에러 → `NETWORK`, `network_error` 로그
- ODNO 스키마 누락 → `VALIDATION`, `response_malformed` 로그
- `cancelOrRevise cancel` 은 `RVSE_CNCL_DVSN_CD='02'` + `ORD_UNPR='0'`
- `cancelOrRevise revise LIMIT price=0` → `VALIDATION`
- `qtyAllOrder=true` → `QTY_ALL_ORD_YN='Y'`
- 성공 ODNO 로그의 `odnoHash` 는 원값 6자리 이상 난수 (hash prefix)

### 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 모의 서버 응답 지연 | Bottleneck + http-client 내부 timeout → `NETWORK` |
| `rt_cd='0'` 이지만 `ODNO` 없음 | Zod `safeParse` 실패 → `VALIDATION` |
| `ORD_TMD` 누락 | 허용. `orderedAt` 옵셔널 필드로 처리 |
| 증거금 부족 등 비즈니스 실패 | `API_BUSINESS` 에러 + `order.cash.business_error(WARN)` 로그 → 상위에서 `safety.recordError` 로 자동 OFF 가능 |

## 2. 미체결 자동취소 (NM-001)

### 사용 방법

```ts
const watcher = new PendingOrderWatcher({
  timer: realTimer,
  timeoutMs: 10 * 60 * 1000, // 10분
  maxRetries: 5,              // null=무제한
  onExpire: async (entry, attempt) => {
    // 실제 KIS cancelOrRevise 호출 → 성공 시 watcher.rearm(entry) 또는 cancel(entry)
  },
  onLimitReached: (entry) => {
    logger.log({ level: 'WARN', category: 'ORDER', message: 'pending.cancel.limit', payload: entry });
    safety.recordError(`미체결 재시도 한계 초과: ${entry.pdno}`);
  },
});

// 주문 체결 실패 시점에 등록
watcher.register({ pdno: '005930', side: 'BUY', nth: 2, odno: '0000012345' });
```

코어: [src/main/trading/pending-order-watcher.ts](../../src/main/trading/pending-order-watcher.ts)

### 키 규약

- 유일 키: **`(pdno, side, nth)`**. 같은 차수의 같은 방향 주문은 1건만 감시 — 중복 `register()` 는 noop.
- 체결 / 사용자 취소 인지 시 `watcher.cancel(key)` 호출 → 타이머 해제 + 카운터 초기화.
- 재주문 성공 시 `watcher.rearm(key)` 로 타이머 재무장 (attempts 유지).

### 설정 값 (persistent)

[src/main/db/settings-repo.ts](../../src/main/db/settings-repo.ts) 의 `SETTING_KEYS` + `readPendingCancelConfig(repo)`:

- `pending_cancel_timeout_min` : `1~60` 분. 기본 10.
- `pending_cancel_max_retries` : `1~30` 또는 문자열 `'unlimited'` → `maxRetries=null`. 기본 5.
- 범위 밖/NaN/누락 값은 전부 **default fallback**.

### 인증 필요 여부

- watcher 자체는 로컬. `onExpire` 콜백에서 `cancelOrRevise` 를 호출할 때 인증 필요 (위 1절 참고).

### 테스트 방법

[src/main/trading/pending-order-watcher.test.ts](../../src/main/trading/pending-order-watcher.test.ts) 6 cases + [settings-repo.test.ts](../../src/main/db/settings-repo.test.ts) 6 cases:

- 등록 후 timeout 경과 → `onExpire` 호출 (`attempt=1`)
- `cancel(key)` 호출 후 timer tick → `onExpire` 호출되지 않음
- 중복 register → 기존 timer 유지, `size()` 증가 없음
- maxRetries=3 에서 3회 연속 expire → `onLimitReached` 호출 + 내부 엔트리 제거
- maxRetries=null → 10회 expire 해도 제거되지 않음
- `dispose()` → 전체 타이머 clear + map 비움
- settings 읽기 — 1/60/`'unlimited'`/`'abc'`/미설정 경계

### 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 앱 재시작 | in-memory watcher는 초기화됨. 재시작 후 체결 실패한 미체결 주문은 수동 복구 대상 — 이는 의도적(폭주 방지) |
| `onExpire` 내부 취소 호출 자체가 실패 | 호출측이 직접 로깅 + 재시도 로직. watcher는 신호만 제공. |
| 같은 pdno/side/nth 이지만 odno 가 다른 신규 주문 | 기존이 아직 감시 중이면 덮어쓰지 않음(`register` noop). 호출측이 `cancel` 먼저 필요 |
| maxRetries=0 입력 | 범위 밖 → fallback=5 적용 (Zod/범위 검사에서 처리) |
| `rearm()` 타이머 재무장 | attempts 는 보존, timeout 만 리셋 |
