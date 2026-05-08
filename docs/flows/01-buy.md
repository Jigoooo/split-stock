# 01. 자동매매 매수 플로우

도메스틱(KIS) + UPBIT 매수 경로 통합. 매도/부스터는 `02-sell-booster.md` 참조.

---

## 도메스틱(KIS) 매수

### ASCII 흐름도

```
[가격 공급층]
  REST polling (quoteFeed, RotatingQuoteFeed)
    ├─→ bus.emitTick() ──→ StrategyExecutionEngine.onTick()
    │                         (subscribeTick)
    └─→ WatchEngine.onPrice() (REST 전용 직접 수신)

  KIS WS (H0STCNT0) ─→ bus.emitTick() (StrategyEngine만)
  KIS WS (H0STASP0) ─→ bus.emitTick() (호가)

[매수 실행층 — StrategyExecutionEngine 경로]
  StrategyExecutionEngine.onTick()
    ├─ inFlightPdnos.has(pdno)       [종목 단위 직렬화]
    ├─ checkSafety()
    ├─ resolveStrategyProfile()
    ├─ lotsRepo.snapshot()
    ├─ fsm.evaluate() → orders[]
    └─ executeStrategyOrder(order)
         ├─ autoBuyGuard.assertAutoBuyAllowed(source='STRATEGY')
         │    ├─ assertProtectionLimits  (ProtectionLimitsRepo)
         │    ├─ assertTimeWindow        (KST 분 단위)
         │    └─ assertRateGuard         (인메모리 슬라이딩 윈도우)
         ├─ broker.placeOrder({side:'BUY',...})  [BrokerPort 추상]
         └─ recordStrategyOrder()
              └─ pendingOrderWatcher.register() (LIMIT 만)

[매수 실행층 — WatchEngine 경로 (단발/예약매수)]
  WatchEngine.onPrice()
    ├─ entry.inFlight 가드
    ├─ inFlightCoordinator.tryAcquire(pdno)  [WatchEngine ↔ StrategyEngine 공유 종목 lock]
    ├─ comparator(price)
    └─ fire() → executeWatchOrder(order)
         ├─ hasActiveCycle()              [1차 중복 방지]
         ├─ autoBuyGuard.assertAutoBuyAllowed(source='WATCH')
         ├─ broker.placeOrder()
         └─ registerPendingWatchOrder()

[체결 동기화층]
  KIS WS H0STCNI0 → subscribeAccountEvents → enqueueBrokerEvent (debounce)
                                            → manualOrderReconciler.poll()
  ManualOrderReconciler [3초 polling, 독립 안전망]
    → broker.listDailyExecutions()
    → reconcileLinkedLot()   [lots BUYING → OPEN]
    → onTradeExecution()
         ├─ broadcastTradeExecution()   (renderer IPC + BoosterService.handleTradeExecution)
         ├─ currentStateSync.trigger('trade-event')
         └─ balanceSync.refreshWithBackoff()
```

### LEAD 가설 vs 실제 코드 정정 (6건)

| # | LEAD 가설 | 실제 코드 | file:line |
|---|---|---|---|
| A1 | `kis/order.ts placeBuyOrder` | `BrokerPort.placeOrder()` 추상 인터페이스 | watch-order-executor.ts:109,195 |
| A2 | WatchEngine + FSM = 단일 엔진 | WatchEngine(단발) + StrategyExecutionEngine(차수) **분리** | watch-engine.ts, strategy-execution-engine.ts |
| A3 | KIS WS → WatchEngine 직접 | WS는 bus.emitTick만, WatchEngine은 **REST 전용** | trading-runtime.ts:158-175 |
| A4 | `hasPendingBuy` 가드 | `entry.inFlight` + `inFlightCoordinator` + `hasActiveCycle()` 3중 가드 | watch-order-executor.ts:46 |
| A5 | 체결 → FSM 즉시 재평가 | `refreshTrackedSymbols()` 는 추적 목록만, 재평가는 **다음 tick** | account-sync-runtime.ts |
| A6 | pendingOrderWatcher 등록 위치 | STRATEGY 경로는 `recordStrategyOrder()` 내부 | watch-order-recording.ts:78 |

### 검증 결과

✅ 흐름 단절 없음. WatchEngine + StrategyExecutionEngine 분리 구조 명확.
⚠️ 동일 protection 검사가 두 path(gate + autoBuyGuard)에서 발생하던 이슈는 commit `8ee5a75`에서 정리됨.

---

## UPBIT 매수

### ASCII 흐름도

```
[Polling-loop, runAutoLiveTick / startAuto]
setInterval → readAutoTickInputs → runLiveTick
  → plan() → planned.kind = plan-buy / plan-sell / noop
  → getGate() (config/exposure/cooldown)   [protection 검사 제거됨, post-E2]
  → cryptoAutoBuyGuard.assertAutoBuyAllowed (plan-buy 만)
       → assertProtectionLimits
       → assertRateGuard
            → 임계 초과 시:
                applyCryptoStrategyAutoMode('SELL_ONLY')
                + repo.upsertStrategy (DB persist)
                + onSellOnly.notify
                    → notifySellOnlyAuto (OS notification)
                    + broadcastToAllWindows('appShell:auto-sell-only')
                      → preload IPC → renderer toast
                + throw AutoOrderBlockedError
  → adapter.createOrder (REST)
  → markLiveAction
  + rateGuard.recordBuy
  + checkAndPossiblyDisableAuto
       → 임계 초과 시: safetyRegistry.setMaster(false) (전역 OFF)
  → insertEvent(kind='live-place')
```

### LEAD 가설 vs 실제 코드

| # | 항목 | 결과 |
|---|---|---|
| C1 | WS subscription bootstrap rebind | ✅ 정상 (95%) |
| C2 | runLiveTick 진입점 (router.runAutoLiveTick + startAuto) | ✅ 정상 |
| C3 | CryptoAutoBuyGuard 검사 순서 (protection→rate) | ✅ 정상 (99%) |
| C4 | runLiveTick 내 가드 호출 시점 | ✅ 정상 (98%) |
| C5 | createOrder REST + fill event WS decoupled | ✅ 정상 (95%) |

### 검증 결과

✅ C1-C5 매수 경로 wiring 정상.
⚠️ UPBIT fill event 처리(lots 동기화/booster 진입) → `02-sell-booster.md` C12-b 참조.

---

## Broker 비교

| 항목 | 도메스틱(KIS) | UPBIT |
|---|---|---|
| 가격 공급 | REST RotatingQuoteFeed + KIS WS H0STCNT0 | setInterval polling |
| 매수 실행 | BrokerPort.placeOrder (추상) | adapter.createOrder (REST) |
| 안전장치 | autoBuyGuard (assertProtectionLimits + assertTimeWindow + assertRateGuard) | cryptoAutoBuyGuard (assertProtectionLimits + assertRateGuard) |
| 체결 확인 | KIS WS H0STCNI0 + ManualOrderReconciler 3초 polling | UPBIT private WS (decoupled) |
| 차수 엔진 | StrategyExecutionEngine (FSM) | plan() 함수 (plan-buy/noop) |
| 단발 매수 | WatchEngine | 해당 없음 |
