# B. 도메스틱(KIS) 매도 + 부스터 플로우

## 정확한 흐름

```
FeedBus.emitTick(pdno, price)
  └→ StrategyExecutionEngine.onTick()
       └→ [profile.autoSellEnabled 필터]
            └→ fsm.evaluate() → SELL order  (lot.buyPrice * (1 + targetProfitPct) ≤ price)
                 └→ executeStrategyOrder(SELL, nth=N)
                      └→ broker.placeOrder() → odno
                           └→ ManualOrderReconciler (REST 폴링 + KIS CNI WS 보조 trigger)
                                └→ decision=FILLED, remainingQty=0
                                     ├→ ⚠️ onTradeExecution 방출 (lot 아직 SELLING)
                                     │    ├→ watchEvents.broadcastTradeExecution()
                                     │    └→ boosterService.handleTradeExecution()
                                     │         └→ [gate: side=SELL, nth=1, FILLED, remaining=0]
                                     │              └→ lotsRepo.snapshot()
                                     │                   └→ ⚠️ hasActiveCycle() ← SELLING 감지
                                     │                        └→ [정상] profitBooster.enabled
                                     │                             └→ BoosterWatcher.register
                                     │                                  └→ bus.subscribeTick()
                                     │                                       └→ price ≤ lastFilled*(1-pct)
                                     │                                            └→ onTrigger()
                                     │                                                 └→ executeStrategyOrder(BUY,1)
                                     └→ [이후] reconcileLinkedLot() → lot.status = SOLD
```

## 🔴 B6 — 잠재적 타이밍 버그 (CRITICAL)

**위치**: `manual-order-reconciler.ts:301-318`
**문제**:
- L301-315: `onTradeExecution` 이벤트 방출 (boosterService.handleTradeExecution 동기 호출)
- L318: `reconcileLinkedLot(lots SELLING→SOLD)` 가 **그 다음에** 실행

→ BoosterService 가 lotsRepo.snapshot() 읽는 시점에 lot 이 **SELLING 상태**
→ `hasActiveCycle()` 가 `true` 반환 (SELLING 도 active cycle 로 간주)
→ booster register **skip**

**영향**: 도메스틱 1차 매도 후 booster 가 항상 동작 안 할 가능성. `event_logs` 에 `booster.registered` 미발생 → 사용자가 booster 동작 안 한다고 인지.

**검증 방법**:
1. Mock 계좌에서 booster 활성화 + 1차 매수
2. 매도 trigger 도달 (또는 강제 매도)
3. event_logs 확인 — `booster.registered` 발생? `booster.skipped reason=active-cycle-exists` 만 발생?

**가능한 fix 방향**:
- `reconcileLinkedLot` 을 `onTradeExecution` 보다 먼저 실행
- 또는 `hasActiveCycle` 이 SELLING 차수를 active 로 보지 않도록 정의 변경
- 또는 `event.lotId` 를 BoosterService 에 전달해서 해당 lot 을 snapshot 에서 제외

## LEAD 가설 vs 실제 코드 정정

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| B1 | FSM 익절 트리거 (targetProfitPct) | ✅ 정상 | autoSellEnabled=false 시 SELL 신호 전체 억제 |
| B2 | broadcastTradeExecution wiring | ✅ 정상 | bootstrap-deps.ts:597-602 단일 lambda |
| B3 | BoosterService 4-gate (side/nth/status/remaining) | ✅ 정상 | 단, nth=null 시 skip |
| B4 | tick 감시 FeedBus wiring | ✅ 정상 | getRealtime null 시 silent degradation 위험 |
| B5 | onTrigger → BUY 1차 주문 | ✅ 정상 | qty=0 시 skip |
| **B6** | **reconcileLinkedLot 타이밍** | 🔴 **버그** | **booster 등록 skip 가능** |

## 검증 결과 (1차)

✅ B1-B5 정상.
🔴 B6 즉시 검증 + 조치 필요. → ✅ Fix `d470d7a` (reconcileLinkedLot 우선 실행)

---

## 추가 깊이 검증 (B6 fix 후, scientist B-deep)

### Bd2 — multi-lot 동시 SELL booster 누락 (HIGH)
- **위치**: `booster-service.ts:54-56` `hasActiveCycle(snapshot.value.lots)`
- **문제**: 1차 SELL FILLED 처리 중 2차 lot 이 SELLING 상태면 hasActiveCycle=true → booster register skip. silent miss (보정 수단 없음).
- **발생 조건**: 분할매수 전략에서 2개 이상 lot 이 거의 동시에 SELL FILLED. 단일 lot 전략은 무영향.
- **Fix 권고**: `snapshot.lots.filter(l => l.id !== event.lotId)` 후 hasActiveCycle 검사.

### Bd4 — onTrigger 실패 시 retry/failed-queue 없음 (HIGH)
- **위치**: `booster-service.ts:184-198` finally cleanupSubscription
- **문제**: KIS API 장애/timeout/rate limit 등으로 BUY 주문 실패 시 task 영구 소멸. 사용자 보정 기회 없음 (ERROR log 만 남음).
- **Fix 권고**: 1회 재시도 (지수 백오프) + 그래도 실패면 cleanup. 또는 별도 failed-queue + IPC API.

### Bd6 — env 전환 후 WS 재구독 누락 (LOW/MID)
- **위치**: `bootstrap-deps.ts` env 전환 hook
- **문제**: env 전환으로 RealtimeService 재생성 시 BoosterService 의 활성 task 가 newRealtime.watch() 재호출 안 됨. WS 끊김.
- **완화**: bus.subscribeTick 은 살아있고 REST quoteFeed 가 같은 bus 에 publish 하므로 silent failure 아니나, WS vs REST 폴링 주기 차이로 트리거 지연.
- **Fix 권고**: env 전환 hook 에 booster.list() 순회 후 newRealtime.watch() 재호출.

### Bd1, Bd3, Bd5 (INFO)
- Bd1 broadcastTradeExecution 체인 — B6 fix 로 해소됨.
- Bd3 nth=null manual order skip — 의도된 설계 (booster 이중 진입 방지). 주석 명시 권고.
- Bd5 source 'STRATEGY' 하드코딩 — telemetry 만 영향. 'BOOSTER' source 추가 선택적.
