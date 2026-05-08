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

## 🔴 즉시 검증/조치 권고 (CRITICAL)

### 1. B6 — 도메스틱 부스터 등록 race
- **위치**: `manual-order-reconciler.ts:301-318`
- **문제**: `onTradeExecution` 이 `reconcileLinkedLot` 보다 **먼저** 발화 → BoosterService.handleTradeExecution 진입 시점에 lot 이 아직 `SELLING` 상태 → `hasActiveCycle()` 가 true → 부스터 등록 **skip**.
- **영향**: 도메스틱 1차 매도 후 booster 가 항상 동작 안할 가능성.
- **검증 방법**: Mock 계좌로 booster 활성화한 종목 1차 매도 → log 에서 `booster.registered` 발생 여부 확인.

### 2. C12-b — UPBIT lots 과도한 close
- **위치**: `crypto-auto-repo.ts:877-891` `syncLotsFromFillEvent`
- **문제**: 단일 SELL fill (전량) 이벤트로 해당 (account, market) **모든 open live lots close**. 차수 매매 (1차/2차/3차 독립) 의미 위반.
- **영향**: UPBIT 에서 1차만 매도해도 2/3차 lot 도 장부상 close 처리됨.
- **검증 방법**: UPBIT Mock 환경에서 1차 매수 → 2차 매수 → 1차만 매도 → DB 의 lots 테이블에서 2차 lot status 확인 (open 유지돼야 정상).

## 🟡 backlog 등록 권고

### 3. G — catch-up 다이얼로그 설계 vs 구현 차이
원래 도메인 계획 (kis-hashed-barto.md Phase B):
- ❌ strategyEngine pause 메커니즘 (응답 전까지 자동매매 일시정지)
- ❌ IPC `appShell:catch-up-detected` push (현재는 renderer pull)
- ❌ [나중에 결정] settings 영속화
- ❌ 30초 timeout fallback

현재 구현은 **informational UI** 수준 (modal 결정이 실제 fsm 동작에 영향 없음). 계획 의도가 충분히 반영됐는지 사용자 확인 필요.

### 4. H4 — PROD 18rps KIS 15rps 가이드라인 초과
- **위치**: `trading-runtime.ts:155`
- **위험**: PROD 운영 시 KIS RATE_LIMITED 에러 발생 가능
- **권고**: 18 → 15 또는 12 로 보수적 조정

### 5. C12-c — CryptoAutoBuyGuard.histories vs createRateGuard.history 이중 Map
- 동일 매수 사건에 대해 별도 카운팅. 의도성 불명.
- 권고: 한쪽만 사용하도록 정리 또는 명시적 의도 주석.

## 정상 검증 (변경 불필요)

- **A 도메스틱 매수** — 가설 명칭 정정 외 흐름 정상
- **D 멀티계좌 재구독** — wiring 단절 없음
- **E 실전 전환** — 100% 의도대로
- **F 차트/호가** — 동작 정상 (채널명만 정정)
