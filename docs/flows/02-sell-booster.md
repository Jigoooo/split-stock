# 02. 매도 + 부스터 플로우

도메스틱(KIS) + UPBIT 매도 및 수익 부스터 경로 통합. 매수는 `01-buy.md` 참조.

---

## 도메스틱(KIS) 매도 + 부스터

### ASCII 흐름도

```
FeedBus.emitTick(pdno, price)
  └→ StrategyExecutionEngine.onTick()
       └→ [profile.autoSellEnabled 필터]
            └→ fsm.evaluate() → SELL order  (lot.buyPrice * (1 + targetProfitPct) ≤ price)
                 └→ executeStrategyOrder(SELL, nth=N)
                      └→ broker.placeOrder() → odno

[체결 확인 — ManualOrderReconciler]
  REST 폴링 (3초) + KIS CNI WS 보조 trigger
    └→ decision=FILLED, remainingQty=0
         ├→ reconcileLinkedLot()   ← ✅ B6 Fix d470d7a: onTradeExecution 보다 먼저 실행
         │    └→ lot.status: SELLING → SOLD
         └→ onTradeExecution() 방출
              ├→ watchEvents.broadcastTradeExecution()
              └→ boosterService.handleTradeExecution()
                   └→ 4중 gate
                        ├─ side=SELL
                        ├─ nth=1
                        ├─ status=FILLED, remaining=0
                        └─ lotsRepo.snapshot()
                             └→ hasActiveCycle() 검사
                                  ← ✅ lot이 이미 SOLD 상태 (B6 fix 이후)
                                  └→ profitBooster.enabled 확인
                                       └→ BoosterWatcher.register
                                            └→ bus.subscribeTick()
                                                 └→ price ≤ lastFilled*(1-pct)
                                                      └→ onTrigger()
                                                           └→ executeStrategyOrder(BUY, nth=1)
```

### 🔴 B6 — 부스터 등록 race 조건 (CRITICAL → ✅ Fix `d470d7a`)

**위치**: `manual-order-reconciler.ts:301-325`

**문제 (fix 전)**:
- L301-315: `onTradeExecution` 방출 → `boosterService.handleTradeExecution` 동기 호출
- L318: `reconcileLinkedLot(SELLING→SOLD)` 이후 실행
- → BoosterService가 `lotsRepo.snapshot()` 읽는 시점에 lot이 **SELLING 상태**
- → `hasActiveCycle()` = true → booster register **skip**

**Fix**: `reconcileLinkedLot`을 `onTradeExecution` 보다 먼저 실행하도록 순서 교체.

**검증**: 신규 테스트 — onTradeExecution 콜백 내부에서 lot status='SOLD' 직접 검증.

---

### 부스터 깊이 검증 (Bd 시리즈, B6 fix 이후 scientist B-deep)

#### Bd1 — broadcastTradeExecution 체인 (INFO)
B6 fix로 해소됨. 별도 조치 불필요.

#### Bd2 — multi-lot 동시 SELL booster 누락 (HIGH) — 잔여 backlog

**위치**: `booster-service.ts:54-56` `hasActiveCycle(snapshot.value.lots)`

**문제**: 1차 SELL FILLED 처리 중 2차 lot이 SELLING 상태면 `hasActiveCycle=true` → booster register skip. silent miss (보정 수단 없음).

**발생 조건**: 분할매수 전략에서 2개 이상 lot이 거의 동시에 SELL FILLED. 단일 lot 전략은 무영향.

**Fix 권고**: `snapshot.lots.filter(l => l.id !== event.lotId)` 후 hasActiveCycle 검사.

#### Bd3 — nth=null manual order skip (INFO)
의도된 설계 (booster 이중 진입 방지). 주석 명시 권고.

#### Bd4 — onTrigger 실패 시 retry/failed-queue 없음 (HIGH) — 잔여 backlog

**위치**: `booster-service.ts:184-198` finally cleanupSubscription

**문제**: KIS API 장애/timeout/rate limit으로 BUY 주문 실패 시 task 영구 소멸. ERROR log만 남음. 사용자 보정 기회 없음.

**Fix 권고**: 1회 재시도(지수 백오프) + 그래도 실패면 cleanup. 또는 별도 failed-queue + IPC API.

#### Bd5 — source 'STRATEGY' 하드코딩 (INFO)
telemetry만 영향. 'BOOSTER' source 추가는 선택적 개선.

#### Bd6 — env 전환 후 WS 재구독 누락 (LOW/MID) — 잔여 backlog

**위치**: `bootstrap-deps.ts` env 전환 hook

**문제**: env 전환으로 RealtimeService 재생성 시 BoosterService의 활성 task가 `newRealtime.watch()` 재호출 안 됨. WS 끊김.

**완화**: `bus.subscribeTick`은 살아있고 REST quoteFeed가 같은 bus에 publish하므로 silent failure는 아니나, WS vs REST 폴링 주기 차이로 트리거 지연.

**Fix 권고**: env 전환 hook에 `booster.list()` 순회 후 `newRealtime.watch()` 재호출.

### LEAD 가설 vs 실제 코드 정정

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| B1 | FSM 익절 트리거 (targetProfitPct) | ✅ 정상 | autoSellEnabled=false 시 SELL 신호 전체 억제 |
| B2 | broadcastTradeExecution wiring | ✅ 정상 | bootstrap-deps.ts:597-602 단일 lambda |
| B3 | BoosterService 4-gate (side/nth/status/remaining) | ✅ 정상 | 단, nth=null 시 skip |
| B4 | tick 감시 FeedBus wiring | ✅ 정상 | getRealtime null 시 silent degradation 위험 |
| B5 | onTrigger → BUY 1차 주문 | ✅ 정상 | qty=0 시 skip |
| **B6** | **reconcileLinkedLot 타이밍** | ✅ **Fix `d470d7a`** | reconcileLinkedLot 우선 실행으로 해소 |

### 검증 결과

✅ B1-B6 모두 정상 (B6는 fix 완료).
⚠️ Bd2(multi-lot) / Bd4(retry 없음) / Bd6(env 전환 WS) 잔여 backlog.

---

## UPBIT 매도 + 부스터

### ASCII 흐름도

```
[UPBIT private WS path — decoupled]
UPBIT private WS → CryptoRealtimeService.watchPrivate.onOrder
  → applyPrivateOrder(session, event)
       → repo.applyPrivateOrderEvent(event)   [cryptoOrders/cryptoFills DB]
       → bus.publishPrivateOrder(event)
  → bootstrap-deps callback (active account only)  [W5-E 추가]
       ├→ cryptoAutoRepo.syncLotsFromFillEvent(event)
       │    ← ✅ C12-b Fix d2d8eb4: executedVolume 만큼 FIFO 차감 (부분 차감 가능)
       └→ cryptoBoosterService.handleCryptoFill(event)
            → 4중 게이트
               ├─ side='ask'
               ├─ state='done'
               ├─ remainingVolume=0
               └─ listOpenLots=0    [전량 매도 확인]
            → profitBooster.enabled 확인
            → BoosterWatcher.register
                 → bus.subscribeTicker(market) 시작
                 → realtime.watchMarket(candleUnit:'1m') refcount

[Booster trigger — UPBIT]
ticker price ≤ lastFilledPrice * (1 - boosterPct)
  → BoosterWatcher.trigger
  → CryptoBoosterService.onTrigger
       → safetyRegistry.snap (master/errorLock)
       → cryptoAutoBuyGuard.assertAutoBuyAllowed (source='BOOSTER')
       → adapter.createOrder
       → markLiveAction + rateGuard.recordBuy
       → cleanupSubscription (bus unsub + unwatch)
```

### 🔴 C12-b — syncLotsFromFillEvent 차수 매매 위반 (CRITICAL → ✅ Fix `d2d8eb4`)

**위치**: `crypto-auto-repo.ts:877-891`

**문제 (fix 전)**:
```typescript
// 기존 (잘못된 동작)
syncLotsFromFillEvent(event):
  if (side='ask' && state='done' && remainingVolume='0'):
    for each open live lot of (accountId, market):
      closeLot(lot)  // ← 모든 lot 일괄 close
```

차수 매매에서 1차만 매도해도 2/3차 lot까지 모두 close → 장부 불일치 + booster 오작동.

**Fix**: `executedVolume`만큼 가장 오래된(낮은 nth) lot부터 FIFO 차감.
- `partialReduceLot` 신규 함수 추가 (qty만 감소, status='open' 유지)
- 전량 차감 시에만 `closeLot`

**검증**: 5개 신규 테스트 (단일 close / 부분 차감 / 전량 / 초과 warning / no-op).

### 🟡 C12-a — 다중 활성 계좌 미지원 (✅ Fix `190150b`, 옵션 A 채택)

**위치**: `bootstrap-deps.ts:441` `let cryptoBoosterUnsub: (() => void) | null = null;`

**채택된 fix (옵션 A)**: account 전환 시 `cryptoBoosterService.dispose()` 호출 (메모리 누수 방지).

**잔여 backlog (옵션 B)**: UPBIT 다중 계좌 동시 booster Map 확장 — 별도 큰 작업.

### LEAD 가설 vs 실제 코드

| # | 항목 | 결과 |
|---|---|---|
| C6 | syncLotsFromFillEvent → handleCryptoFill 동기 순서 | ✅ 정상 (99%) |
| C7 | handleCryptoFill 4중 가드 + listOpenLots 우회 | ✅ 정상 (92%) |
| C8 | onTrigger 4중 게이트 + adapter 호출 | ✅ 정상 (97%) |
| C9 | RateGuard SELL_ONLY 두 경로 병존 | ⚠️ 의도성 불명 (88%) |
| C10 | tray notification (commit 8ee5a75) wiring | ✅ 정상 (96%) |
| C11 | ticker subscription 흐름 | ✅ 정상 (95%) |
| **C12-a** | 다중 계좌 미지원 | ✅ Fix `190150b` (옵션 A) |
| **C12-b** | syncLotsFromFillEvent 모든 lots close | ✅ Fix `d2d8eb4` |
| **C12-c** | 이중 history Map | ⚠️ docstring 명시 `7fa9634` — 통일은 별도 작업 |

### 검증 결과

✅ UPBIT 매도/부스터 wiring 정상. C12-a/b fix 완료.
⚠️ C12-c (이중 history Map) — 사용자 결정 필요 시 별도 작업.

---

## MEDIUM 5건 Fix (Safety/Booster 관련)

| 항목 | Fix | commit |
|---|---|---|
| booster gate optional → required (fail-closed) | ✅ | `b8174c5` |
| profitBooster.expiresAt `.min(0).max(2^31-1)` (setTimeout overflow 방어) | ✅ | `7fa9634` |
| CryptoExchangeError.raw zod fieldErrors 누설 redaction (issueCount만 기록, CWE-209) | ✅ | `7fa9634` |
| applyCryptoStrategyAutoMode renderer 측 로컬 중복 → shared import 통일 | ✅ | `b8174c5` |
| protectionErrorMessage 함수 3군데 중복 → `src/main/safety/protection-error-message.ts` 단일 helper | ✅ | `b8174c5` |

---

## Broker 비교

| 항목 | 도메스틱(KIS) | UPBIT |
|---|---|---|
| 매도 트리거 | FSM (targetProfitPct) | plan() → plan-sell |
| 체결 확인 | ManualOrderReconciler (3초 polling + CNI WS) | UPBIT private WS (decoupled) |
| lot 동기화 | reconcileLinkedLot (SELLING→SOLD) | syncLotsFromFillEvent (FIFO 차감, C12-b fix) |
| 부스터 진입 gate | 4중 (side/nth/FILLED/remaining=0) | 4중 (side='ask'/done/remainingVolume=0/listOpenLots=0) |
| 부스터 가격 감시 | bus.subscribeTick (FeedBus) | bus.subscribeTicker (market) |
| 재매수 경로 | executeStrategyOrder(BUY, nth=1) | adapter.createOrder |
| 다중 계좌 | 해당 없음 | 단일 activeAccountId (C12-a 옵션 A fix) |
