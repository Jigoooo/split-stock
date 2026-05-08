# 05. 차트/호가 데이터 자동복구 플로우 (NM-014)

차트(OHLCV) SWR 캐시 + 지수 백오프 재시도, 호가 WS 단절 시 REST fallback 자동 전환.

---

## 차트 자동복구

### ASCII 흐름도

```
user 차트 요청
  → getDailyOhlcv()
  → authService.getValidToken()
  → withExponentialBackoff(maxRetries=3, base=200ms, factor=3, full jitter, cap=30s)
       │
       ├─ 성공
       │    → swrCache.set(pdno, period, candles)
       │    → ok 반환
       │
       ├─ NETWORK 오류 (5xx / timeout)
       │    → 재시도 (jitter 포함)
       │         attempt 0: 0~200ms
       │         attempt 1: 0~600ms
       │         attempt 2: 0~1800ms
       │    → 소진 시 err 반환
       │
       └─ 4xx (BUSINESS / VALIDATION / AUTH_FAILED / RATE_LIMITED)
            → 즉시 cache fallback (재시도 없음)
                 ┌─ 1순위: swrCache.getInRange() (인메모리, TTL 5분)
                 │    → 즉시 stale ok 반환
                 │    + swrRevalidator.triggerRevalidate() [백그라운드]
                 │         → 재검증 성공 시 swrCache.set() 갱신
                 │         + onSuccess()
                 │              → broadcastToAllWindows('appShell:candles-updated')
                 │                → preload IPC
                 │                → window.appShell.onCandlesUpdated()
                 │                → use-position-chart-candles:
                 │                     date-upsert merge → setCandles()
                 │
                 ├─ 2순위: candlesRepo.getInRange() (로컬 DB)
                 │
                 └─ miss → err + isAutoRecovering=true 안내
```

### LEAD 가설 vs 실제 코드 정정

| 항목 | LEAD 가설 | 실제 구현 |
|---|---|---|
| IPC 채널명 | `appShell:chart-updated` | **`appShell:candles-updated`** |
| retry delays | 200ms→600ms→1.8s 고정 | **full jitter** (0~200ms, 0~600ms, 0~1800ms) |
| cache fallback 분기명 | `classify_error_kind` | 인라인 `brokerErr.kind !== 'NETWORK'` |
| SWR 캐시 우선순위 | 언급 없음 | swrCache(1순위) → candlesRepo DB(2순위) |

### 핵심 파일 (차트)

| 파일 | 역할 |
|---|---|
| `src/main/brokers/core/candles-swr-cache.ts` | SWR 캐시 (TTL 5분, key=pdno::period) |
| `src/main/brokers/core/candles-swr-revalidate.ts` | 백그라운드 재검증 |
| `src/main/brokers/kis/adapter.ts` | getDailyOhlcv (재시도 + cache fallback) |
| `src/main/brokers/core/retry.ts` | withExponentialBackoff (full jitter) |
| `src/preload/index.ts:115-116` | IPC subscriber |
| `src/renderer/.../use-position-chart-candles.ts:166-187` | renderer 자동 갱신 |

---

## 호가 자동복구

### ASCII 흐름도

```
KisWsClient ws 'close' 이벤트
  → scheduleReconnect()  [첫 단절 시]
       │
       ├─ queueMicrotask(_onFallbackStart)
       │    → RealtimeService
       │    → orderbookPoller.start()
       │         즉시 1회 poll + 1Hz polling 시작
       │         → bus.emitOrderbook
       │         → renderer 동일 채널 (WS와 동일 인터페이스)
       │
       └─ queueMicrotask(onPhaseChange('reconnect-wait'))
            → pool.setWsAvailable(false)
            → 200ms debounce reconcile
            → 전체 종목 REST fallback 전환
  │
  └─ reconnect backoff: min(1000 * 2^attempt, 30000ms)  [무한 재시도]
       attempt 0 → 1000ms
       attempt 1 → 2000ms
       attempt 2 → 4000ms
       ...
       cap      → 30000ms
  │
  └─ 재연결 성공 → onPhaseChange('open')
       pool.setWsAvailable(true)
       → 200ms debounce → priority 기반 WS 재배치
       orderbookPoller.stop()   [polling 즉시 중단]
```

### LEAD 가설 vs 실제 코드 정정

| 항목 | LEAD 가설 | 실제 구현 |
|---|---|---|
| REST 폴링 파일명 | `orderbook-rest-fallback.ts` | **`orderbook-rest-poller.ts`** |
| WS backoff | "1→2→4→...→30s cap" | min(1000 * 2^attempt, 30000) — 동일하나 **무한 재시도** |

### 핵심 파일 (호가)

| 파일 | 역할 |
|---|---|
| `src/main/realtime/ws-client.ts` | scheduleReconnect, onPhaseChange |
| `src/main/realtime/orderbook-rest-poller.ts` | 1Hz REST 폴링 |
| `src/main/realtime/realtime-service.ts:128-131` | phase change handler |

---

## 검증 결과

✅ wiring 정상. 동작 의도대로.
⚠️ 명명 정정 필요: IPC 채널 `candles-updated`, 파일명 `orderbook-rest-poller`.

---

## 적용 범위

| 항목 | 적용 broker |
|---|---|
| 차트 자동복구 | 도메스틱(KIS) |
| 호가 WS fallback | 도메스틱(KIS) |
| UPBIT | 해당 없음 (polling 방식, 별도 WS 관리) |
