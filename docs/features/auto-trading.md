# 자동매매 FSM · 차수 장부 · 부스터 · 예약매수 · 리스플릿

US-012 / NM-004 / NM-005 / NM-006. 박스권 분할매매 핵심 로직입니다.

상위 인덱스: [../README.md](../README.md)

## 1. 자동매매 FSM (US-012)

### 핵심 규칙

[`evaluate(price, position, cfg)`](../../src/main/trading/fsm.ts) — **순수 함수**. 현재가, 포지션 스냅샷, 설정을 입력받아 생성해야 할 주문 목록을 반환.

```ts
function evaluate(price: number, position: PositionSnapshot, cfg: TradingConfig): FsmOrder[];
```

규칙:

1. **시드 매수** — 포지션이 완전히 비어 있을 때 1차 매수 `{ qty = floor(amount / price) }`.
2. **하향 추가매수** — 가장 높은 차수(`top`) 의 매입가 × `(1 - dropPct)` 이하로 하락하면 `nth+1` 차수 매수. 단, `top.nth < maxStages`, `qty > 0`, 이미 `BUYING` 상태 차수가 없을 때만.
3. **차수별 독립 익절** — `OPEN` 상태 각 차수에 대해 `buyPrice × (1 + profitPct) ≤ price` 이면 해당 차수 전량 매도.
4. **`BUYING` / `SELLING` 재평가 금지** — 중복 주문 방지.
5. `dropPct` 와 `profitPct` 가 동시에 성립할 수 있음 — BUY + SELL 모두 emit.

### 설정 스키마

[`TradingConfigSchema`](../../src/main/trading/fsm.ts) — 내부용 (호출측이 즉시 소비).

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| `pdno` | `/^\d{6}$/` | 종목 6자리 |
| `totalAmountKrw` | 양의 정수 | 총 배분 원화 |
| `maxStages` | 1~20 | 최대 차수 |
| `dropPct` | 0 < x ≤ 0.5 | 하향 추가매수 기준 (0.03 = 3%) |
| `profitPct` | 0 < x ≤ 0.5 | 차수별 익절 기준 |

`amountPerStage = floor(totalAmountKrw / maxStages)`, `qty = floor(amount / price)`.

### 테스트 방법

[src/main/trading/fsm.test.ts](../../src/main/trading/fsm.test.ts) 11 cases:
- 시드 매수 (빈 포지션)
- 정상 하향 2차 매수 진입
- 단일 차수 독립 익절
- 동시 BUY + SELL (하향 + 기존 차수 익절)
- `maxStages` 도달 → BUY 미생성
- 반등 후 2차 익절
- `price <= 0` / NaN → 빈 배열
- `position.pdno !== cfg.pdno` → 빈 배열
- `BUYING` 상태 있을 때 추가 BUY 미생성
- `qty` 가 0이 되는 경우 BUY 미생성
- 소수점 floor 계산 검증

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 1차 진입가 너무 높아 `qty=0` | BUY 미생성 — 호출측이 `amountPerStage` 증액 필요 |
| 최대 차수 이후 더 하락 | 추가 BUY 미생성. 익절 가능성은 유지 |
| 동시 여러 차수 익절 트리거 | 각각 별도 SELL 주문 생성 |
| 직전 차수가 `SOLD` | `highestLot` 은 전체 lots 기준이라 `SOLD` 차수도 포함되나, `hasPendingBuy` 만 `BUYING` 체크. 현재 구현은 `SOLD` 도 `top` 후보 — 호출측이 원하면 `OPEN` 만 필터링 권장 |

## 2. 차수 장부 (US-012)

### 테이블

```ts
lots {
  id PK, accountId, pdno, nth, buyPrice, qty, amountKrw,
  status: 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING',
  boughtAt, soldAt?, sellPrice?
}
```

### 트랜잭션 규약

[`LotsRepo`](../../src/main/trading/lots-repo.ts) — better-sqlite3 `transaction(cb)` 사용. 콜백 throw 시 **자동 rollback**.

- `snapshot(accountId, pdno)` — 포지션 일괄 조회 (`PositionSnapshot`).
- `insertLot(input)` — `(accountId, pdno, nth)` 중복 존재 시 throw → rollback. 경합 안전.
- `updateLotStatus({ lotId, status, sellPrice?, soldAt? })` — `changes === 0` 이면 throw (없는 id).
- `replan(accountId, plan)` — **리스플릿 전용**. 4절 참고.

### 테스트 방법

[src/main/trading/lots-repo.test.ts](../../src/main/trading/lots-repo.test.ts) — 단일 insert → snapshot 라운드트립, 중복 차수 거부 + rollback, updateLotStatus 변경, replan 통합.

## 3. 예약매수 (NM-005)

잔고에 없는 신규 종목을 지정 가격 + 유효기간 내 최초 도달 시 1차 매수.

### 스키마 / 레포

테이블: `prebuy_orders { id PK, pdno, targetPrice, amountKrw, validUntil, status, createdAt }`

[`PrebuyRepo`](../../src/main/trading/prebuy-repo.ts):
- `insert({ pdno, targetPrice, amountKrw, validUntil })` — **최대 100건** + 동일 `pdno PENDING` 중복 차단.
- `listPending()` — 감시 대상 전체.
- `cancel(id)` / `markFilled(id)` / `markExpired(id)` — 상태 전이.

### Watcher

```ts
const watcher = new PrebuyWatcher({
  timer,
  repo: prebuyRepo,
  onTrigger: (order, { price }) => {
    // 1차 매수 실행 + repo.markFilled(order.id)
  },
  onExpire: (order) => logger.log({ level: 'INFO', category: 'FSM', message: 'prebuy.expired', payload: { id: order.id } }),
  expiryCheckMs: 60_000,
});
watcher.reload(); // DB PENDING 목록 로드
watcher.onPrice(pdno, price); // 가격 신호 push
```

엔진: [src/main/trading/prebuy-watcher.ts](../../src/main/trading/prebuy-watcher.ts)

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| PENDING 100건 꽉 참 | 101번째 `insert` 는 `CAP_EXCEEDED` |
| 동일 pdno PENDING 존재 | `DUPLICATE_PENDING` |
| 트리거 후 watcher 재받음 방지 | onTrigger 후 `removeFromMap` 로 감시 해제 |
| `validUntil` 이 과거 | 만료 체크 interval 이 다음 주기에 markExpired + onExpire |
| DB 수동 조작으로 status 가 `CANCELLED` 로 바뀜 | 다음 `reload()` 호출 전까지는 in-memory 감시 유지 — 호출측이 reload 필요 |

### 테스트 방법

[src/main/trading/prebuy-repo.test.ts](../../src/main/trading/prebuy-repo.test.ts) (6) + [prebuy-watcher.test.ts](../../src/main/trading/prebuy-watcher.test.ts) (4) — insert cap/중복, 가격 도달, 만료 interval, markFilled/markExpired 전이.

## 5. 리스플릿 (Re-split, NM-006)

기존 `OPEN` 포지션을 새 차수 구조로 **장부상** 재편성합니다. 실제 주문은 발생하지 않습니다.

### 계획 생성

[`planFromParams(raw)`](../../src/main/trading/respiit-planner.ts):

```ts
const plan = planFromParams({
  pdno: '005930',
  stages: 5,
  intervalDays: 7,
  priceGapPct: 0.03,       // 0이면 동일가 (또는 priceGapKrw 사용)
  priceGapKrw: 1000,       // priceGapPct 와 병용 가능 — Krw 우선
  totalQty: 50,
  anchorPrice: 74500,
  anchorAt: new Date('2026-04-01'), // 생략 시 now
});
```

- 각 차수 가격: `priceGapKrw` 주어지면 `anchorPrice - priceGapKrw * (n-1)`, 아니면 `round(anchorPrice * (1 - priceGapPct * (n-1)))`, 1 미만이면 1로 클램프.
- 각 차수 수량: `floor(totalQty / stages)` + **1차에 잔여 합산**.
- 각 차수 시점: `anchorAt - intervalDays × (n-1)` (과거로 역산).

CSV:
```ts
const plan = planFromCsv('005930', `
2026-01-05, 10, 75000
2026-01-12, 10, 73500
2026-01-19, 10, 72000
`);
```
헤더 없음, `[YYYY-MM-DD, qty, price]`. 각 행 `CsvRowSchema` 로 검증.

### 적용 (Orchestrator)

[`applyRespiit`](../../src/main/trading/respiit-orchestrator.ts) 는 `LotsRepo.replan` 트랜잭션 실행 후:

1. **성공** → `safety.toggleSymbol(pdno, false)` 자동 (사용자에게 전략 재검증 강제)
2. `event_logs` `FSM / respiit.applied (WARN)` 기록 (stages, firstNth, lastNth)
3. **실패** → `FSM / respiit.failed (ERROR)` 기록 + rollback

### LotsRepo.replan 트랜잭션

[src/main/trading/lots-repo.ts](../../src/main/trading/lots-repo.ts):

1. 기존 `(accountId, pdno, status='OPEN')` 차수만 DELETE
2. 보존된 non-OPEN 차수의 `nth` 를 수집 → 새 plan 의 `nth` 와 **충돌 시 throw → full rollback**
3. plan.entries 각 행을 INSERT (`status='OPEN'`)

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 이미 SOLD 인 차수 존재 | 보존됨. 새 plan 의 nth 와 겹치면 전체 rollback |
| BUYING / SELLING 차수 | 보존됨. 같은 이유로 충돌 rollback 가능 |
| CSV 의 date 가 `YYYY/MM/DD` 형식 | Zod 정규식 실패 → throw (호출측이 UI에서 catch) |
| `stages > 20` | `RespiitParamsSchema` 실패 |
| `totalQty=7, stages=3` | base=2, remainder=1 → 1차 3주, 2·3차 2주 |
| `priceGapKrw` 로 가격이 음수가 되는 경우 | `Math.max(1, ...)` 로 1원 클램프 |

### 테스트 방법

[respiit-planner.test.ts](../../src/main/trading/respiit-planner.test.ts) 9 + [respiit-orchestrator.test.ts](../../src/main/trading/respiit-orchestrator.test.ts) 2 = 11 cases.

## 6. 도메인 불변식 (모든 매매 공통)

- 다음 차수 매수가 기준은 **직전 차수 매수가**. 평단가 아님.
- 차수는 독립 포지션 — 2차 익절돼도 1·3차는 각자 대기.
- 수량은 원화 금액 균등 분할 → `floor(amount / price)`.
