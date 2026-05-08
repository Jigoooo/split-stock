# split-stock 기능 흐름도 (코드 검증 완료)

8개 scientist agent 병렬 검증 결과. 각 파일에 [LEAD 가설] vs [실제 코드] 명시.

## 흐름 인덱스

| ID | 영역 | 주요 발견 |
|---|---|---|
| [A](./A-domestic-buy.md) | 도메스틱(KIS) 자동매매 매수 | 6개 가설 정정 (placeBuyOrder 추상화 등) |
| [B](./B-domestic-sell-booster.md) | 도메스틱 매도 + 부스터 | 🔴 **B6 잠재 타이밍 버그** (booster 등록 skip) |
| [C](./C-upbit-auto.md) | UPBIT 자동매매 (E2-1+E2-2+post-E2) | 🔴 **C12-b syncLotsFromFillEvent 차수 매매 위반** |
| [D](./D-multi-account-rebind.md) | 멀티계좌 booster 재구독 | 정상 wiring 확인 |
| [E](./E-prod-switch.md) | 실전 전환 2단계 모달 | ✅ 100% 의도대로 구현 |
| [F](./F-chart-orderbook-recovery.md) | 차트/호가 자동복구 (NM-014) | 채널명/파일명/jitter 정정 |
| [G](./G-catch-up.md) | catch-up 부팅 다이얼로그 (NM-016) | 🟡 5개 가설 부정 (pause/IPC/timeout 미구현) |
| [H](./H-stock-master-prebuy.md) | 종목 마스터 + 티어드 감시 + 예약매수 | 🟡 priority sort 없음 / 18rps 초과 |

## ✅ 처리 완료 항목 (W6 land)

### 1. B6 — 도메스틱 부스터 등록 race ✅ Fix `d470d7a`
- `manual-order-reconciler.ts:301-325` — reconcileLinkedLot 을 onTradeExecution 보다 먼저 실행
- 검증: 신규 테스트 — onTradeExecution 콜백 내부에서 lot status='SOLD' 직접 검증

### 2. C12-b — UPBIT lots 과도한 close ✅ Fix `d2d8eb4`
- `crypto-auto-repo.ts` syncLotsFromFillEvent — `executedVolume` 만큼 가장 오래된(낮은 nth) lot 부터 FIFO 차감
- partialReduceLot 신규 함수 추가 (qty 만 감소, status='open' 유지)
- 검증: 5개 신규 테스트 (단일 close / 부분 차감 / 전량 / 초과 warning / no-op)

### 3. G — catch-up 다이얼로그 4건 강화 ✅ Fix `3efd22c`
- ✅ strategyEngine pause/resume API (`onTick` paused 상태면 즉시 return + log)
- ✅ IPC `appShell:catch-up-detected` push (renderer pull 과 병행 fallback)
- ✅ [나중에 결정] settings.catchUpPending 영속화 (다음 부팅 재노출)
- ✅ 30초 timeout fallback (응답 없으면 timeoutDismiss → strategyEngine.resume + 모달 unmount)
- catch-up-router 신규 mutations: dismiss / timeoutDismiss / applyDecision(isLastDecision)

### 4. H4 — PROD rate limit 보수 조정 ✅ Fix `797c0e7`
- `trading-runtime.ts:155` PROD 개장 18 → **12rps** (KIS 15rps 가이드라인 안전 margin)
- 신규 테스트 6개 (rate-limit + 회귀 방지)

### 5. C12-c — 이중 history Map ⚠️ docstring 명시 `7fa9634`
- 코드 통일 대신 docstring 으로 두 Map 의 의도 차이 명시 (시도 직전 카운트 vs placement 성공 후 카운트)
- 사용자 결정 필요: 한쪽으로 통일하려면 별도 작업

## ✅ 추가 처리 (md 외 backlog)

### C12-a — UPBIT 다중 활성 계좌 ✅ Fix `190150b`
- 옵션 A 채택: account 전환 시 cryptoBoosterService.dispose() 호출 (메모리 누수 방지)
- 옵션 B (Map 확장으로 다중 계좌 동시 booster) 는 별도 큰 작업 backlog

### MEDIUM 5건 ✅ Fix `b8174c5`, `7fa9634`
- ✅ booster gate optional → required (fail-closed) — `b8174c5`
- ✅ profitBooster.expiresAt `.min(0).max(2^31-1)` — `7fa9634` (setTimeout overflow 방어)
- ✅ CryptoExchangeError.raw zod fieldErrors 누설 redaction (issueCount 만 기록, CWE-209) — `7fa9634`
- ✅ applyCryptoStrategyAutoMode renderer 측 로컬 중복 → shared import 통일 — `b8174c5`
- ✅ protectionErrorMessage 함수 3군데 중복 → `src/main/safety/protection-error-message.ts` 단일 helper — `b8174c5`

## 🟡 잔여 backlog (다음 세션)

- **H 우선순위 정렬** (`tiered-quote-feed.ts`) — 현재 FIFO. 트리거 근접 종목 우선화 가산 작업.
- **C12-c 한쪽 통일** — 사용자 결정 필요 시 별도 작업.
- **C12-a 옵션 B** — UPBIT 다중 계좌 동시 booster 지원.
- **G B5 reconcileLinkedLot timing test 보강** — fix 후 회귀 방지 테스트는 1건 추가됐으나 multi-account / 차수 변형 시나리오 미커버.

## 정상 검증 (변경 불필요)

- **A 도메스틱 매수** — 가설 명칭 정정 외 흐름 정상
- **D 멀티계좌 재구독** — wiring 단절 없음
- **E 실전 전환** — 100% 의도대로
- **F 차트/호가** — 동작 정상 (채널명만 정정)
