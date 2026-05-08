# F. 차트/호가 자동 복구 플로우 (NM-014)

## 정확한 흐름

### [차트]
```
user 차트 요청
→ getDailyOhlcv() → authService.getValidToken()
→ withExponentialBackoff(maxRetries=3, base=200ms, factor=3, full jitter, cap=30s)
   ├─ 성공 → swrCache.set(pdno, period, candles) → ok 반환
   ├─ NETWORK(5xx/timeout) → 재시도 (0~200ms → 0~600ms → 0~1800ms full jitter) → 소진 시 err
   └─ 4xx (BUSINESS/VALIDATION/AUTH_FAILED/RATE_LIMITED) → 즉시 cache fallback
        1순위: swrCache.getInRange() (인메모리)
          → 즉시 stale ok 반환 + swrRevalidator.triggerRevalidate() [백그라운드]
          → 재검증 성공 시 swrCache.set() 갱신
              + onSuccess() → broadcastToAllWindows('appShell:candles-updated')
              → preload → window.appShell.onCandlesUpdated()
              → use-position-chart-candles: date-upsert merge → setCandles()
        2순위: candlesRepo.getInRange() (로컬 DB)
        miss → err + isAutoRecovering=true 안내
```

### [호가]
```
KisWsClient ws 'close' 이벤트
→ scheduleReconnect() (첫 단절 시)
    queueMicrotask(_onFallbackStart) → RealtimeService → orderbookPoller.start()
      (즉시 1회 poll + 1Hz polling 시작 → bus.emitOrderbook → renderer 동일 채널)
    queueMicrotask(onPhaseChange('reconnect-wait'))
      → pool.setWsAvailable(false) → 200ms debounce reconcile → 전체 종목 REST fallback
→ reconnectDelayMs(base=1000ms, max=30000ms, attempt) = min(1000 * 2^attempt, 30000)
   attempt 0→1000ms, 1→2000ms, 2→4000ms, ... cap 30000ms (무한 재시도)
→ 재연결 성공 → onPhaseChange('open')
    pool.setWsAvailable(true) → 200ms debounce → priority 기반 WS 재배치
    orderbookPoller.stop() → polling 즉시 중단
```

## LEAD 가설 vs 실제 코드 정정

| 항목 | LEAD 가설 | 실제 구현 |
|---|---|---|
| IPC 채널명 | `appShell:chart-updated` | **`appShell:candles-updated`** |
| REST 폴링 파일명 | `orderbook-rest-fallback.ts` | **`orderbook-rest-poller.ts`** |
| retry delays | 200ms→600ms→1.8s 고정 | **full jitter** (0~200ms, 0~600ms, 0~1800ms) |
| WS backoff | "1→2→4→...→30s cap" | min(1000 * 2^attempt, 30000) — 동일하나 **무한 재시도** |
| cache fallback 분기명 | `classify_error_kind` | 인라인 `brokerErr.kind !== 'NETWORK'` |
| SWR 캐시 우선순위 | 언급 없음 | swrCache(1순위) → candlesRepo DB(2순위) |

## 핵심 파일

- `src/main/brokers/core/candles-swr-cache.ts` — SWR 캐시 (TTL 5분, key=pdno::period)
- `src/main/brokers/core/candles-swr-revalidate.ts` — 백그라운드 재검증
- `src/main/brokers/kis/adapter.ts` — getDailyOhlcv (재시도 + cache fallback)
- `src/main/brokers/core/retry.ts` — withExponentialBackoff (full jitter)
- `src/main/realtime/ws-client.ts` — scheduleReconnect, onPhaseChange
- `src/main/realtime/orderbook-rest-poller.ts` — 1Hz REST 폴링
- `src/main/realtime/realtime-service.ts:128-131` — phase change handler
- `src/preload/index.ts:115-116` — IPC subscriber
- `src/renderer/.../use-position-chart-candles.ts:166-187` — renderer 자동 갱신

## 검증 결과

✅ wiring 정상. 동작 의도대로.
⚠️ 메모리/명명 정정만 필요 (`candles-updated` 채널, `orderbook-rest-poller` 파일).
