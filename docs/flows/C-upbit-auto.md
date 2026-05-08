# C. UPBIT 자동매매 플로우 (E2-1 + E2-2 + post-E2 hardening)

## 정확한 흐름

```
[Polling-loop, runAutoLiveTick / startAuto]
setInterval → readAutoTickInputs → runLiveTick
  → plan() → planned.kind = plan-buy/plan-sell/noop
  → getGate() (config/exposure/cooldown)  [protection 검사 제거됨, post-E2]
  → cryptoAutoBuyGuard.assertAutoBuyAllowed (plan-buy 만)
       → assertProtectionLimits → assertRateGuard
            → 임계 초과 시: applyCryptoStrategyAutoMode('SELL_ONLY')
                          + repo.upsertStrategy (DB persist)
                          + onSellOnly.notify
                              → notifySellOnlyAuto (OS notification)
                              + broadcastToAllWindows('appShell:auto-sell-only')
                                → preload IPC → renderer toast
                          + throw AutoOrderBlockedError
  → adapter.createOrder (REST)
  → markLiveAction + rateGuard.recordBuy + checkAndPossiblyDisableAuto
       → 임계 초과 시: safetyRegistry.setMaster(false) (전역 OFF)
  → insertEvent(kind='live-place')

[UPBIT private WS path - decoupled]
UPBIT private WS → CryptoRealtimeService.watchPrivate.onOrder
  → applyPrivateOrder(session, event)
       → repo.applyPrivateOrderEvent(event) [cryptoOrders/cryptoFills DB]
       → bus.publishPrivateOrder(event)
  → bootstrap-deps callback (active account only) [W5-E 추가]
       → cryptoAutoRepo.syncLotsFromFillEvent(event)  ⚠️ 모든 open lots close
       → cryptoBoosterService.handleCryptoFill(event)
            → 4중 가드 (side='ask', state='done', remainingVolume=0,
                       listOpenLots=0, profitBooster.enabled, etc)
            → BoosterWatcher.register
                 → bus.subscribeTicker(market) 시작
                 → realtime.watchMarket(candleUnit:'1m') refcount

[Booster trigger]
ticker price ≤ lastFilledPrice * (1 - boosterPct)
  → BoosterWatcher.trigger
  → CryptoBoosterService.onTrigger
       → safetyRegistry.snap (master/errorLock)
       → cryptoAutoBuyGuard.assertAutoBuyAllowed (source='BOOSTER')
       → adapter.createOrder
       → markLiveAction + rateGuard.recordBuy
       → cleanupSubscription (bus unsub + unwatch)
```

## 🔴 C12-b — syncLotsFromFillEvent 차수 매매 위반 (CRITICAL)

**위치**: `crypto-auto-repo.ts:877-891`

**문제**:
```typescript
syncLotsFromFillEvent(event):
  if (side='ask' && state='done' && remainingVolume='0'):
    for each open live lot of (accountId, market):
      closeLot(lot)  // ← 모든 lot 일괄 close
```

차수 매매에서는 1차/2차/3차 분할매수 후 **각 차수 독립 익절**. 1차만 매도해도 2/3차 lot 은 보유 유지가 정상.

**현재 동작**: 1차 매도 fill 한 건이 들어오면 2/3차 lot 까지 모두 close → 사용자는 2/3차 보유 중인데 장부상 사라짐 + booster 가 listOpenLots=0 보고 등록됨 (의도 아님).

**검증 방법**:
1. UPBIT Mock 환경에서 KRW-XXX 1차 매수
2. 2차 매수
3. 1차만 매도 (UPBIT 웹/앱 또는 분할 매도)
4. DB `lots` 테이블에서 broker='UPBIT', accountId, market 의 row 들 확인 — 2차 lot status='open' 유지돼야 정상

**가능한 fix**:
- `syncLotsFromFillEvent` 가 `event.executedVolume` 만큼만 lot.quantity 차감 + 0이면 close
- 또는 fill 이벤트에 `lotId` 매핑이 있으면 해당 lot만 close

## C12-a — 다중 활성 계좌 미지원

**위치**: `bootstrap-deps.ts:441` `let cryptoBoosterUnsub: (() => void) | null = null;`

**제약**: single account only. 사용자가 UPBIT 여러 계좌를 동시에 자동매매 활성화해도 booster 는 활성 계좌 1개에만 등록.

**현재 의도**: `onActiveAccountChanged` 가 단일 계좌 rebind 만 수행 → 비활성 계좌 의 fill event 는 booster 진입 안 함.

**상태**: 현재 product scope 결정. 멀티 계좌 병렬 사용 시 backlog 처리.

## C12-c — 이중 history Map

CryptoAutoBuyGuard 의 `histories` Map (시도 직전 카운트) vs createRateGuard 의 `history` Map (placement 성공 후 카운트). 의도성 불명. 정리 권고.

## LEAD 가설 vs 실제 코드

| # | 항목 | 결과 |
|---|---|---|
| C1 | WS subscription bootstrap rebind | ✅ 정상 (95%) |
| C2 | runLiveTick 진입점 (router.runAutoLiveTick + startAuto) | ✅ 정상 |
| C3 | CryptoAutoBuyGuard 검사 순서 (protection→rate) | ✅ 정상 (99%) |
| C4 | runLiveTick 내 가드 호출 시점 | ✅ 정상 (98%) |
| C5 | createOrder REST + fill event WS decoupled | ✅ 정상 (95%) |
| C6 | syncLotsFromFillEvent → handleCryptoFill 동기 순서 | ✅ 정상 (99%) |
| C7 | handleCryptoFill 4중 가드 + listOpenLots 우회 | ✅ 정상 (92%) |
| C8 | onTrigger 4중 게이트 + adapter 호출 | ✅ 정상 (97%) |
| C9 | RateGuard SELL_ONLY 두 경로 병존 | ⚠️ 의도성 불명 (88%) |
| C10 | tray notification (commit 8ee5a75) wiring | ✅ 정상 (96%) |
| C11 | ticker subscription 흐름 | ✅ 정상 (95%) |
| **C12-a** | 다중 계좌 미지원 | 🟡 backlog |
| **C12-b** | syncLotsFromFillEvent 모든 lots close | 🔴 **CRITICAL** |
| **C12-c** | 이중 history Map | 🟡 정리 권고 |

## 검증 결과

✅ C1-C11 wiring 정상.
🔴 C12-b 즉시 검증 + 조치 필요.
