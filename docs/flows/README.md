# split-stock 기능 흐름도 (domain 별 재구성)

8개 scientist agent 병렬 검증 결과 기반. 각 파일에 LEAD 가설 vs 실제 코드 명시.
옵션 D 재구성 — broker-centric → policy-centric (domain 별 분리).

---

## 흐름 인덱스

| 파일 | 영역 | 주요 내용 |
|---|---|---|
| [01-buy.md](./01-buy.md) | 자동매매 매수 (도메스틱 + UPBIT) | KIS WatchEngine/FSM + UPBIT polling 매수, autoBuyGuard |
| [02-sell-booster.md](./02-sell-booster.md) | 매도 + 수익 부스터 (도메스틱 + UPBIT) | B6 fix / Bd2/Bd4/Bd6 backlog / C12-a/b/c fix |
| [03-safety.md](./03-safety.md) | 안전장치 + 실전 전환 | autoBuyGuard / RateGuard / SafetyRegistry / 2단계 모달 |
| [04-realtime.md](./04-realtime.md) | WS/REST 구독 + 멀티계좌 | RotatingQuoteFeed / booster 재구독 / account 전환 |
| [05-data-fetch.md](./05-data-fetch.md) | 차트/호가 자동복구 (NM-014) | SWR 캐시 / 지수 백오프 / WS fallback REST |
| [06-boot.md](./06-boot.md) | catch-up 다이얼로그 + 부팅 순서 (NM-016) | Phase B 4건 강화 (`3efd22c`) |
| [07-ui-parity.md](./07-ui-parity.md) | UPBIT UI parity + 한국어 라벨 + AI | NM-017 잔고 평가 / AI 추천 disabled |
| [08-stock-data.md](./08-stock-data.md) | 종목 마스터 + 티어드 감시 + 예약매수 | H4 rate fix / priority sort backlog |

---

## Broker cross-link 표

"도메스틱 자동매매 전체 흐름을 보려면?" 식의 빠른 탐색용.

### 도메스틱(KIS) 전체 흐름

| 단계 | 파일 | 핵심 섹션 |
|---|---|---|
| 매수 | [01-buy.md](./01-buy.md) | 도메스틱(KIS) 매수 — StrategyEngine / WatchEngine |
| 매도 + 부스터 | [02-sell-booster.md](./02-sell-booster.md) | 도메스틱(KIS) 매도 + 부스터 / B6 fix |
| 안전장치 | [03-safety.md](./03-safety.md) | 도메스틱 안전장치 / 실전 전환 모달 |
| 실시간 가격 | [04-realtime.md](./04-realtime.md) | KIS WS / RotatingQuoteFeed / 계좌 전환 |
| 차트/호가 복구 | [05-data-fetch.md](./05-data-fetch.md) | 차트 SWR + WS fallback |
| 부팅/catch-up | [06-boot.md](./06-boot.md) | 부팅 순서 + catch-up 다이얼로그 |
| 종목 데이터 | [08-stock-data.md](./08-stock-data.md) | 종목 마스터 / 티어드 감시 / 예약매수 |

### UPBIT 전체 흐름

| 단계 | 파일 | 핵심 섹션 |
|---|---|---|
| 매수 | [01-buy.md](./01-buy.md) | UPBIT 매수 — polling / cryptoAutoBuyGuard |
| 매도 + 부스터 | [02-sell-booster.md](./02-sell-booster.md) | UPBIT 매도 + 부스터 / C12-a/b/c fix |
| 안전장치 | [03-safety.md](./03-safety.md) | UPBIT 안전장치 / SELL_ONLY 전환 |
| 실시간 fill | [04-realtime.md](./04-realtime.md) | UPBIT private WS / booster 재구독 |
| UI parity | [07-ui-parity.md](./07-ui-parity.md) | 잔고 평가 / 한국어 라벨 / AI disabled |

---

## ✅ 처리 완료 항목 (W6 land)

### 1. B6 — 도메스틱 부스터 등록 race ✅ Fix `d470d7a`

- `manual-order-reconciler.ts:301-325` — `reconcileLinkedLot`을 `onTradeExecution` 보다 먼저 실행
- **효과**: boosterService가 lotsRepo.snapshot() 읽을 때 lot 이미 SOLD 상태 → hasActiveCycle=false → 정상 등록
- 검증: onTradeExecution 콜백 내부에서 lot status='SOLD' 직접 검증 신규 테스트

### 2. C12-b — UPBIT lots 과도한 close ✅ Fix `d2d8eb4`

- `crypto-auto-repo.ts` syncLotsFromFillEvent — `executedVolume` 만큼 가장 오래된(낮은 nth) lot 부터 FIFO 차감
- `partialReduceLot` 신규 함수 추가 (qty만 감소, status='open' 유지)
- 검증: 5개 신규 테스트 (단일 close / 부분 차감 / 전량 / 초과 warning / no-op)

### 3. G — catch-up 다이얼로그 4건 강화 ✅ Fix `3efd22c`

- ✅ strategyEngine pause/resume API (onTick paused 상태면 즉시 return + log)
- ✅ IPC `appShell:catch-up-detected` push (renderer pull과 병행 fallback)
- ✅ `settings.catchUpPending` 영속화 (다음 부팅 재노출)
- ✅ 30초 timeout fallback (응답 없으면 timeoutDismiss → resume + 모달 unmount)
- catch-up-router 신규 mutations: dismiss / timeoutDismiss / applyDecision(isLastDecision)

### 4. H4 — PROD rate limit 보수 조정 ✅ Fix `797c0e7`

- `trading-runtime.ts:155` PROD 개장 18 → **12rps** (KIS 15rps 가이드라인 안전 margin)
- 신규 테스트 6개 (rate-limit + 회귀 방지)

### 5. C12-c — 이중 history Map ⚠️ docstring 명시 `7fa9634`

- 코드 통일 대신 docstring으로 두 Map의 의도 차이 명시 (시도 직전 카운트 vs placement 성공 후 카운트)
- 사용자 결정 필요: 한쪽으로 통일하려면 별도 작업

### 6. C12-a — UPBIT 다중 활성 계좌 ✅ Fix `190150b`

- 옵션 A 채택: account 전환 시 `cryptoBoosterService.dispose()` 호출 (메모리 누수 방지)
- 옵션 B (Map 확장으로 다중 계좌 동시 booster) 는 별도 큰 작업 backlog

### 7. MEDIUM 5건 ✅ Fix `b8174c5`, `7fa9634`

- ✅ booster gate optional → required (fail-closed) — `b8174c5`
- ✅ profitBooster.expiresAt `.min(0).max(2^31-1)` — `7fa9634` (setTimeout overflow 방어)
- ✅ CryptoExchangeError.raw zod fieldErrors 누설 redaction (issueCount만 기록, CWE-209) — `7fa9634`
- ✅ applyCryptoStrategyAutoMode renderer 측 로컬 중복 → shared import 통일 — `b8174c5`
- ✅ protectionErrorMessage 함수 3군데 중복 → `src/main/safety/protection-error-message.ts` 단일 helper — `b8174c5`

---

## 🟡 잔여 backlog (다음 세션)

| 항목 | 파일 | 우선순위 |
|---|---|---|
| Bd2 — multi-lot 동시 SELL booster 누락 | [02-sell-booster.md](./02-sell-booster.md) | HIGH |
| Bd4 — onTrigger 실패 시 retry/failed-queue 없음 | [02-sell-booster.md](./02-sell-booster.md) | HIGH |
| Bd6 — env 전환 후 WS 재구독 누락 | [02-sell-booster.md](./02-sell-booster.md) | LOW/MID |
| H3 — priority sort 미구현 (FIFO) | [08-stock-data.md](./08-stock-data.md) | MID |
| C12-c — 이중 history Map 통일 | [03-safety.md](./03-safety.md) | LOW |
| C12-a 옵션 B — UPBIT 다중 계좌 동시 booster | [04-realtime.md](./04-realtime.md) | LOW |
| G Phase B 회귀 방지 테스트 보강 | [06-boot.md](./06-boot.md) | MID |
| D5 rebind 내부 단위 테스트 보강 | [04-realtime.md](./04-realtime.md) | LOW |

---

## 정상 검증 (변경 불필요)

| 항목 | 파일 |
|---|---|
| 도메스틱 매수 wiring 정상 | [01-buy.md](./01-buy.md) |
| UPBIT 매수 wiring 정상 (C1-C5) | [01-buy.md](./01-buy.md) |
| 멀티계좌 booster 재구독 wiring 정상 | [04-realtime.md](./04-realtime.md) |
| 실전 전환 2단계 모달 100% 의도대로 | [03-safety.md](./03-safety.md) |
| 차트/호가 자동복구 정상 | [05-data-fetch.md](./05-data-fetch.md) |
| 예약매수 WatchEngine 위임 정상 | [08-stock-data.md](./08-stock-data.md) |
