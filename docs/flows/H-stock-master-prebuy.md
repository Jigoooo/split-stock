# H. 종목 마스터 + 티어드 감시 + 예약매수 (NM-003 + NM-005)

## 정확한 흐름

### 종목 마스터
```
부팅/setEnv(비-UPBIT)
  → StockMasterSyncService.isStale() [now - last_sync_at >= 24h]
  → downloadAndParseMaster(KOSPI_URL, 'cp949') + (KOSDAQ_URL, 'cp949')
  → iconv.decode → parseMst(고정폭) → groupCode='ST' 필터
  → repo.upsertMany() → settings.set('stock_master.last_sync_at', epoch)

URLs:
  KOSPI:  https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip
  KOSDAQ: https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip
```

### 티어드 감시
```
WatchEngine 생성 → loadWatchingOrders(WATCHING, KIS/KIWOOM only)
→ onWatchingPdnosChanged → SharedPriceFeedRegistry.syncTracked
→ RotatingQuoteFeed.subscribe(pdno)   ← 등록순 FIFO

RotatingQuoteFeed tick loop:
  minTimeMs = ⌊1000/getRatePerSec()⌋  [PROD개장: 56ms, MOCK개장: 250ms]
  → KisHttpClient.get(inquirePrice)
    [Bottleneck: minTime=67ms, maxConcurrent=1]  ← 실제 rate cap
  → emit 'quote' → bus.emitTick() + watchEngine.onPrice()
  → WatchEngine.onPrice: LTE/GTE 매칭 → fire() → handler 실행
```

### 예약매수
```
PrebuyWatcher(engine 모드).reload()
  → repo.listPending() → engine.register(source='PREBUY', comparator='LTE')
  → WatchEngine 큐 편입 → SharedPriceFeedRegistry → RotatingQuoteFeed.subscribe

가격 도달 시:
  RotatingQuoteFeed → watchEngine.onPrice
  → PREBUY fallbackHandler → resolvePrebuySource(상태 재검증)
  → runWatchedOrder(order, price)  ← A 플로우 동일
  → 성공: prebuyRepo.markFilled(id)  → status='FILLED'

만료 cleanup:
  WatchEngine.setInterval(expireStale, 60_000ms) → DB EXPIRED + dequeue
```

## LEAD 가설 vs 실제 코드 정정

| 항목 | LEAD 가설 | 실제 |
|---|---|---|
| 24h sync trigger | cronjob 자동 폴링 | **이벤트 기반 lazy** (부팅 + setEnv 시 isStale 체크) |
| RotatingQuoteFeed sort | priority sort (트리거 근접순) | **단순 FIFO** (Map insertion order) |
| 종목 마스터 URL | `inquirePrice` REST 호출 | **.mst zip 다운로드 + cp949 파싱** (더 효율적) |
| Bottleneck 위치 | quoteFeed 내부 | **HTTP 레이어** (KisHttpClient) |

## 🟡 H4 — PROD 18rps KIS 가이드라인 초과

**위치**: `trading-runtime.ts:155`
```
PROD 개장: 18rps (KIS 가이드라인 15rps 초과)
PROD 폐장: 6rps
MOCK 개장: 4rps / 폐장: 2rps
```

**위험**: PROD 운영 시 KIS 측에서 RATE_LIMITED 응답 → 자동매매 중단 가능
**권고**: PROD 개장 18rps → 12-14rps 보수적 조정

## 🟡 priority sort 미구현

**현재**: 등록순 FIFO 회전 큐 (시간 균등 분배)
**의도** (kis-hashed-barto.md): 트리거 근접 종목 우선
**영향**: 30+ 종목 분산 시 고가격대 매수 trigger 가 저가격대와 동일 대기시간 → 빠른 진입이 필요한 종목 지연
**권고**: `startCycle()` 에 priority 정렬 로직 추가 (단, 복잡도 증가)

## 검증 항목

| # | 항목 | 결과 |
|---|---|---|
| H1 | 24h 주기 trigger | ⚠️ lazy 방식 (가설 정정) |
| H2 | KIS .mst 다운로드 + cp949 파싱 | ✅ 정상 |
| H3 | RotatingQuoteFeed priority sort | ⚠️ FIFO 단순 (가설 정정) |
| H4 | KIS 15rps Bottleneck | ⚠️ PROD 개장 18rps **가이드라인 초과** |
| H5 | prebuy-watcher feed 구독 | ✅ WatchEngine 위임 |
| H6 | 1차 매수 발사 (A 플로우 통합) | ✅ runWatchedOrder 공유 |
| H7 | 60초 만료 cleanup | ✅ WatchEngine.setInterval |

## 제약 사항

- WatchEngine + PREBUY 모두 도메스틱(KIS/KIWOOM) 한정 — UPBIT 제외
- 24h 백그라운드 cronjob 없음 — 앱 24h+ 백그라운드 시 sync 누락 가능

## 검증 결과

✅ 핵심 기능 정상.
🟡 H4 (rate limit 초과) 즉시 검토 권고.
🟡 priority sort 는 현재 spec 결정에 따라 가산 작업.
