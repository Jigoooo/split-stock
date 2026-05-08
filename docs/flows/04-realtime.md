# 04. 실시간 구독 + 멀티계좌 플로우

WS/REST 가격 공급, booster 재구독, 멀티계좌 account 전환 통합.

---

## 도메스틱(KIS) 실시간 구독

### ASCII 흐름도

```
[부팅 시 구독 초기화]
trading-runtime.ts
  → KisWsClient 연결
  → subscribeMarketData()
       ├─ H0STCNT0 (체결가)  → bus.emitTick(pdno, price)
       ├─ H0STASP0 (호가)    → bus.emitTick(pdno, askBid)
       └─ H0STCNI0 (계좌체결) → subscribeAccountEvents
                               → enqueueBrokerEvent (debounce)
                               → manualOrderReconciler.poll()

[RotatingQuoteFeed — REST 보조 가격 공급]
  PROD 개장: minTimeMs = ⌊1000/12⌋ = 83ms  ← ✅ H4 Fix 797c0e7 (18→12rps)
  MOCK 개장: minTimeMs = ⌊1000/4⌋  = 250ms
  Bottleneck: KisHttpClient (minTime=67ms, maxConcurrent=1)

  loop:
    KisHttpClient.get(inquirePrice)
      → emit 'quote'
      → bus.emitTick()
      → watchEngine.onPrice()

[SharedPriceFeedRegistry — 종목 추적 관리]
  WatchEngine.loadWatchingOrders()
    → onWatchingPdnosChanged
    → SharedPriceFeedRegistry.syncTracked(pdnos)
    → RotatingQuoteFeed.subscribe(pdno)   [FIFO 등록]
```

### WS 재연결 (호가 단절 시)

```
KisWsClient ws 'close' 이벤트
  → scheduleReconnect()
       queueMicrotask(_onFallbackStart)
         → RealtimeService → orderbookPoller.start()
               (즉시 1회 poll + 1Hz polling → bus.emitOrderbook)
       queueMicrotask(onPhaseChange('reconnect-wait'))
         → pool.setWsAvailable(false) → 200ms debounce reconcile
         → 전체 종목 REST fallback 전환
  → reconnect backoff: min(1000 * 2^attempt, 30000ms)  [무한 재시도]
  → 재연결 성공 → onPhaseChange('open')
       pool.setWsAvailable(true) → 200ms debounce → WS 재배치
       orderbookPoller.stop()
```

---

## UPBIT 실시간 구독

### ASCII 흐름도

```
[부팅 시 구독 초기화]
bootstrap-deps.ts
  → CryptoRealtimeService 생성
  → watchPrivate(accountId)
       → UPBIT private WS 연결
       → onOrder handler 등록

[fill event 수신]
UPBIT private WS → applyPrivateOrder(session, event)
  → repo.applyPrivateOrderEvent(event)   [cryptoOrders/cryptoFills DB]
  → bus.publishPrivateOrder(event)
  → bootstrap-deps callback (active account only)
       → cryptoAutoRepo.syncLotsFromFillEvent(event)
       → cryptoBoosterService.handleCryptoFill(event)

[Booster ticker 구독]
BoosterWatcher.register(market)
  → bus.subscribeTicker(market) 시작
  → realtime.watchMarket(candleUnit:'1m') refcount
  → 해제 시: cleanupSubscription (bus unsub + unwatch)
```

---

## 멀티계좌 booster 재구독 (NM-016 관련 D 플로우)

### ASCII 흐름도

```
[사용자: env/account 배지 클릭]
        │
        ▼
auth-router.ts:65  ctx.setEnvAndAccount({ env, accountId })
        │
        ▼
context.ts:364  setEnvAndAccount()
  1. activeAccountId = next.accountId    [원자 교체]
  2. currentEnv = next.env
  3. clearBrokerCache()
  4. syncWatchEngine(next.accountId)
  5. syncAccountRealtimeSubscription()   [KIS/KIWOOM realtime 재구독]
  6. onActiveAccountChanged?.(next.accountId)   [콜백 동기 발화]
        │
        ▼
bootstrap-deps.ts:519-521  rebindCryptoBoosterSubscription(accountId)
        │
        ├── [이전 unsub 있으면] cryptoBoosterUnsub()   [이전 계좌 해제]
        │
        └── [accountId !== null]
              cryptoRealtime.bus.subscribePrivateOrder(accountId, handler)
                │
                ▼
              cryptoBoosterUnsub = Unsubscribe   [handle 저장]

[새 계좌 UPBIT fill event 수신]
cryptoRealtime.applyPrivateOrder(session, event)
  → bus.publishPrivateOrder(event)
  → subscribePrivate 내부 Set listener 발화
  → cryptoAutoRepo.syncLotsFromFillEvent(event)
  → cryptoBoosterService.handleCryptoFill(event)
```

### 진입점 (3곳)

- `auth-router.ts:65` — 헤더 환경/계좌 배지 클릭
- `auth-router.ts:103` — 설정 패널 계좌 변경
- `account-shared.ts:52-55` — 자격증명 저장 후 자동 전환

### 검증 항목

| # | 항목 | 결과 | 신뢰도 |
|---|---|---|---|
| D1 | onActiveAccountChanged hook 등록 | ✅ context.ts:173, bootstrap-deps.ts:518-521 | 100% |
| D2 | rebindCryptoBoosterSubscription unsub 패턴 | ✅ closure 변수 + unsub-then-resubscribe | 100% |
| D3 | setEnvAndAccount 트리거 wiring (3 진입점) | ✅ auth-router.ts:65, 103, account-shared.ts:52-55 | 100% |
| D4 | unsubscribe handle 보관/호출 | ✅ Map.delete 표준 패턴 | 100% |
| D5 | 단위 테스트 | ⚠️ context.test.ts:137-188 콜백 발화만 (rebind 내부 미커버) | 95% |
| D6 | 흐름 단절 지점 | ✅ 없음 | 95% |

### D5 커버리지 갭 (개선 권고 — 잔여 backlog)

- `rebindCryptoBoosterSubscription` 내부 동작(이전 unsub 호출, syncLotsFromFillEvent 연계, handleCryptoFill 전달) 직접 검증 테스트 없음
- end-to-end (auth-router → factory → callback → booster) 통합 테스트 없음

### 구조적 주의점

- `cryptoRealtime.bus`가 공유 싱글톤 — 다중 계좌 병렬 구독 요구 시 단일 handle 패턴이 병목 (현재 단일 activeAccountId 설계상 문제 없음)

**검증 결과**: ✅ wiring 단절 없음. 정상 동작.

---

## Broker 비교

| 항목 | 도메스틱(KIS) | UPBIT |
|---|---|---|
| 실시간 가격 | KIS WS H0STCNT0 + REST RotatingQuoteFeed | setInterval polling |
| 호가 실시간 | KIS WS H0STASP0 | 별도 (ticker) |
| 계좌 체결 | KIS WS H0STCNI0 + ManualOrderReconciler | UPBIT private WS |
| WS 재연결 | scheduleReconnect → REST fallback 자동 전환 | N/A (polling 방식) |
| 계좌 전환 | syncAccountRealtimeSubscription + onActiveAccountChanged | rebindCryptoBoosterSubscription |
| booster 구독 | bus.subscribeTick (FeedBus) | bus.subscribePrivateOrder + subscribeTicker |
| REST rate | 12rps PROD 개장 (H4 fix `797c0e7`) | setInterval 기반 |
