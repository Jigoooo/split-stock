# A. 도메스틱(KIS) 자동매매 매수 플로우

## 정확한 흐름 (실제 코드 기반)

```
[가격 공급층]
  REST polling (quoteFeed, RotatingQuoteFeed)
    ├─→ bus.emitTick() ──→ StrategyExecutionEngine.onTick()
    │                         (subscribeTick)
    └─→ WatchEngine.onPrice() (REST 전용 직접 수신)

  KIS WS (H0STCNT0) ─→ bus.emitTick() (StrategyEngine만)
  KIS WS (H0STASP0) ─→ bus.emitTick() (호가)

[매수 실행층]
  StrategyExecutionEngine.onTick()
    ├─ inFlightPdnos.has(pdno) [종목 단위 직렬화]
    ├─ checkSafety()
    ├─ resolveStrategyProfile()
    ├─ lotsRepo.snapshot()
    ├─ fsm.evaluate() → orders[]
    └─ executeStrategyOrder(order)
         ├─ autoBuyGuard.assertAutoBuyAllowed(source='STRATEGY')
         │    ├─ assertProtectionLimits  (ProtectionLimitsRepo)
         │    ├─ assertTimeWindow         (KST 분 단위)
         │    └─ assertRateGuard          (인메모리 슬라이딩 윈도우)
         ├─ broker.placeOrder({side:'BUY',...})  [BrokerPort 추상]
         └─ recordStrategyOrder()
              └─ pendingOrderWatcher.register() (LIMIT 만)

  WatchEngine.onPrice()
    ├─ entry.inFlight 가드
    ├─ inFlightCoordinator.tryAcquire(pdno)  [WatchEngine ↔ StrategyEngine 공유 종목 lock]
    ├─ comparator(price)
    └─ fire() → executeWatchOrder(order)
         ├─ hasActiveCycle()  [1차 중복 방지]
         ├─ autoBuyGuard.assertAutoBuyAllowed(source='WATCH')
         ├─ broker.placeOrder()
         └─ registerPendingWatchOrder()

[체결 동기화층]
  KIS WS H0STCNI0 → subscribeAccountEvents → enqueueBrokerEvent (debounce)
                                            → manualOrderReconciler.poll()
  ManualOrderReconciler [3초 polling, 독립 안전망]
    → broker.listDailyExecutions()
    → reconcileLinkedLot() [lots BUYING→OPEN]
    → onTradeExecution()
         ├─ broadcastTradeExecution()  (renderer IPC + BoosterService.handleTradeExecution)
         ├─ currentStateSync.trigger('trade-event')
         └─ balanceSync.refreshWithBackoff()
```

## LEAD 가설 vs 실제 코드 정정 (6건)

| # | LEAD 가설 | 실제 코드 | file:line |
|---|---|---|---|
| 1 | `kis/order.ts placeBuyOrder` | `BrokerPort.placeOrder()` 추상 인터페이스 | watch-order-executor.ts:109,195 |
| 2 | WatchEngine + FSM = 단일 엔진 | WatchEngine(단발) + StrategyExecutionEngine(차수) **분리** | watch-engine.ts, strategy-execution-engine.ts |
| 3 | KIS WS → WatchEngine 직접 | WS는 bus.emitTick만, WatchEngine은 **REST 전용** | trading-runtime.ts:158-175 |
| 4 | `hasPendingBuy` 가드 | `entry.inFlight` + `inFlightCoordinator` + `hasActiveCycle()` 3중 가드 | watch-order-executor.ts:46 |
| 5 | 체결 → FSM 즉시 재평가 | `refreshTrackedSymbols()` 는 추적 목록만, 재평가는 **다음 tick** | account-sync-runtime.ts |
| 6 | pendingOrderWatcher 등록 위치 | STRATEGY 경로는 `recordStrategyOrder()` 내부 | watch-order-recording.ts:78 |

## 검증 결과

✅ 흐름 단절 없음. WatchEngine + StrategyExecutionEngine 분리 구조 명확.
⚠️ 동일 protection 검사가 두 path (gate + autoBuyGuard) 에서 발생하던 이슈는 commit 8ee5a75 에서 정리됨.
