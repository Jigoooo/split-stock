# 08. 종목 마스터 + 티어드 감시 + 예약매수 플로우 (NM-003 + NM-005)

도메스틱(KIS/KIWOOM) 전용. UPBIT 제외.

---

## 종목 마스터 동기화

### ASCII 흐름도

```
[부팅 시 또는 setEnv(비-UPBIT) 이벤트]
  → StockMasterSyncService.isStale()
       [now - last_sync_at >= 24h]
  → stale=true:
       downloadAndParseMaster(KOSPI_URL, 'cp949')
       downloadAndParseMaster(KOSDAQ_URL, 'cp949')
         │
         ├─ iconv.decode (cp949 → UTF-8)
         ├─ parseMst (고정폭 파싱)
         └─ groupCode='ST' 필터
  → repo.upsertMany()
  → settings.set('stock_master.last_sync_at', epoch)
```

### 다운로드 URL

| 시장 | URL |
|---|---|
| KOSPI | `https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip` |
| KOSDAQ | `https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip` |

### LEAD 가설 vs 실제 코드 정정

| 항목 | LEAD 가설 | 실제 구현 |
|---|---|---|
| 24h sync trigger | cronjob 자동 폴링 | **이벤트 기반 lazy** (부팅 + setEnv 시 isStale 체크) |
| 종목 마스터 URL | `inquirePrice` REST 호출 | **.mst zip 다운로드 + cp949 파싱** (더 효율적) |

### 제약 사항

- 24h 백그라운드 cronjob 없음 — 앱 24h+ 백그라운드 시 sync 누락 가능
- setEnv 이벤트에만 의존 → 장기 실행 시 수동 재시작 필요

---

## 티어드 감시 (RotatingQuoteFeed)

### ASCII 흐름도

```
WatchEngine 생성
  → loadWatchingOrders(WATCHING, KIS/KIWOOM only)
  → onWatchingPdnosChanged
  → SharedPriceFeedRegistry.syncTracked(pdnos)
  → RotatingQuoteFeed.subscribe(pdno)   [등록순 FIFO]

RotatingQuoteFeed tick loop:
  rate = getRatePerSec()
  minTimeMs = ⌊1000 / rate⌋
  ┌────────────────────────────────────────────┐
  │ PROD 개장: 12rps → 83ms  ← ✅ H4 Fix 797c0e7 (18→12rps) │
  │ PROD 폐장:  6rps → 167ms                               │
  │ MOCK 개장:  4rps → 250ms                               │
  │ MOCK 폐장:  2rps → 500ms                               │
  └────────────────────────────────────────────┘
  → KisHttpClient.get(inquirePrice)
       [Bottleneck: minTime=67ms, maxConcurrent=1]
  → emit 'quote'
  → bus.emitTick()
  → watchEngine.onPrice()
       → LTE/GTE 매칭
       → fire() → handler 실행
```

### 🟡 H4 — PROD rate limit 보수 조정 (✅ Fix `797c0e7`)

**문제**: PROD 개장 18rps → KIS 가이드라인 15rps 초과. RATE_LIMITED 응답 위험.
**Fix**: 18rps → **12rps** (KIS 15rps 가이드라인 안전 margin).
**검증**: 신규 테스트 6개 (rate-limit + 회귀 방지).

### 🟡 priority sort 미구현 (잔여 backlog)

**현재**: 등록순 FIFO 회전 큐 (시간 균등 분배)

**의도** (kis-hashed-barto.md): 트리거 근접 종목 우선

**영향**: 30+ 종목 분산 시 고가격대 매수 trigger가 저가격대와 동일 대기시간 → 빠른 진입이 필요한 종목 지연

**Fix 권고**: `startCycle()`에 priority 정렬 로직 추가

### LEAD 가설 vs 실제 코드 정정

| 항목 | LEAD 가설 | 실제 구현 |
|---|---|---|
| RotatingQuoteFeed sort | priority sort (트리거 근접순) | **단순 FIFO** (Map insertion order) |
| Bottleneck 위치 | quoteFeed 내부 | **HTTP 레이어** (KisHttpClient, minTime=67ms) |

---

## 예약매수 (PrebuyWatcher)

### ASCII 흐름도

```
PrebuyWatcher(engine 모드).reload()
  → repo.listPending()
  → engine.register(source='PREBUY', comparator='LTE')
  → WatchEngine 큐 편입
  → SharedPriceFeedRegistry
  → RotatingQuoteFeed.subscribe(pdno)

[가격 도달 시]
  RotatingQuoteFeed → watchEngine.onPrice()
  → PREBUY fallbackHandler
  → resolvePrebuySource(상태 재검증)
  → runWatchedOrder(order, price)   [A 플로우 동일 경로]
       → autoBuyGuard.assertAutoBuyAllowed(source='WATCH')
       → broker.placeOrder()
  → 성공: prebuyRepo.markFilled(id) → status='FILLED'

[만료 cleanup]
  WatchEngine.setInterval(expireStale, 60_000ms)
  → DB EXPIRED + dequeue
```

---

## 검증 항목

| # | 항목 | 결과 |
|---|---|---|
| H1 | 24h 주기 trigger | ⚠️ lazy 방식 (가설 정정) |
| H2 | KIS .mst 다운로드 + cp949 파싱 | ✅ 정상 |
| H3 | RotatingQuoteFeed priority sort | ⚠️ FIFO 단순 (가설 정정, 잔여 backlog) |
| H4 | KIS PROD rate 한도 | ✅ Fix `797c0e7` (12rps) |
| H5 | prebuy-watcher feed 구독 | ✅ WatchEngine 위임 |
| H6 | 1차 매수 발사 (A 플로우 통합) | ✅ runWatchedOrder 공유 |
| H7 | 60초 만료 cleanup | ✅ WatchEngine.setInterval |

## 검증 결과

✅ 핵심 기능(종목 마스터 + 티어드 감시 + 예약매수) 정상.
✅ H4 rate limit fix 완료 (`797c0e7`).
🟡 priority sort — 현재 spec 결정에 따라 가산 작업.

---

## 적용 범위

| 기능 | 적용 broker |
|---|---|
| 종목 마스터 동기화 | KIS / KIWOOM (도메스틱) |
| RotatingQuoteFeed | KIS / KIWOOM (도메스틱) |
| WatchEngine | KIS / KIWOOM (도메스틱) |
| 예약매수 | KIS / KIWOOM (도메스틱) |
| UPBIT | 해당 없음 (ticker polling 방식) |
