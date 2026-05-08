# 03. 안전장치 플로우

autoBuyGuard / RateGuard / SafetyRegistry / 실전 전환 2단계 모달 / ProtectionGuard 통합.

---

## 도메스틱(KIS) 안전장치

### ASCII 흐름도

```
[매수 요청 진입점]
  executeStrategyOrder(source='STRATEGY')          executeWatchOrder(source='WATCH')
          │                                                   │
          ▼                                                   ▼
  autoBuyGuard.assertAutoBuyAllowed()         autoBuyGuard.assertAutoBuyAllowed()
    ├─ assertProtectionLimits                   ├─ assertProtectionLimits
    │    └─ ProtectionLimitsRepo 조회               │    └─ ProtectionLimitsRepo 조회
    ├─ assertTimeWindow                         ├─ assertTimeWindow
    │    └─ KST 분 단위 거래 시간 체크               │    └─ KST 분 단위 거래 시간 체크
    └─ assertRateGuard                          └─ assertRateGuard
         └─ 인메모리 슬라이딩 윈도우                      └─ 인메모리 슬라이딩 윈도우
              → 통과 시: broker.placeOrder()               → 통과 시: broker.placeOrder()
              → 차단 시: throw AutoOrderBlockedError       → 차단 시: throw AutoOrderBlockedError
```

### ProtectionGuard (도메스틱)

```
checkSafety() — StrategyExecutionEngine.onTick() 진입 시
  ├─ safetyRegistry.snap()          [master on/off + errorLock]
  ├─ assertProtectionLimits()       [일손실/누적손실 한도]
  └─ fail-closed gate               [✅ MEDIUM fix b8174c5: optional → required]
```

---

## UPBIT 안전장치

### ASCII 흐름도

```
[runLiveTick — plan-buy 경로]
  cryptoAutoBuyGuard.assertAutoBuyAllowed(source)
    ├─ assertProtectionLimits
    │    └─ 임계 초과 시:
    │         applyCryptoStrategyAutoMode('SELL_ONLY')
    │           + repo.upsertStrategy (DB persist)
    │           + onSellOnly.notify
    │               → notifySellOnlyAuto (OS notification)
    │               + broadcastToAllWindows('appShell:auto-sell-only')
    │                 → preload IPC → renderer toast
    │           + throw AutoOrderBlockedError
    └─ assertRateGuard
         → 통과 시: adapter.createOrder()

[checkAndPossiblyDisableAuto — createOrder 성공 이후]
  임계 초과 시: safetyRegistry.setMaster(false) (전역 OFF)

[Booster 경로]
  CryptoBoosterService.onTrigger
    → safetyRegistry.snap (master/errorLock 확인)
    → cryptoAutoBuyGuard.assertAutoBuyAllowed(source='BOOSTER')
```

### 🟡 C12-c — 이중 history Map (⚠️ docstring 명시 `7fa9634`)

`CryptoAutoBuyGuard.histories` (시도 직전 카운트) vs `createRateGuard.history` (placement 성공 후 카운트) — 두 Map의 의도 차이 docstring으로 명시. 한쪽 통일은 별도 작업.

---

## 실전 전환 2단계 모달 (NM-002)

### ASCII 흐름도

```
[진입점 1/2/3]
    ↓
[1단계: SwitchEnvDialog 또는 SwitchEnvSection]
    ├─ target === 'PROD' → ProdConfirmModal 팝업
    └─ target === 'MOCK' → 단순 확인 모달
    ↓
[2단계: ProdConfirmModal (PROD만)]
    ├─ 초기화: ack=F, phrase=''
    ├─ 사용자 입력: checkbox + "실전전환" 정확히 타이핑
    └─ usePhraseGate: canConfirm = ack AND phraseOk
    ↓ (분기)
    ├─ [확인] → setEnv.mutate('PROD')
    │    → logger.warn('AUTH/env.switch-to-prod')
    │    → pendingEnv = null
    │    → toast.warning (8초)
    │
    └─ [취소] → cancelEnvSwitch() 또는 reset()
         → if (PROD) logEnvSwitchCancelled.mutate()
         → logger.info('AUTH/env.switch-to-prod-cancelled')
         → pendingEnv = null → 모달 자동 닫기
```

### 진입점 (3곳)

1. **헤더 환경 배지** — `router-layout.tsx` `<SwitchEnvDialog open={shell.pendingEnv !== null} />`
2. **설정 패널** — `switch-env-section.tsx` inline expand form
3. **자격증명 저장** — `credentials-form.tsx` PROD 환경 저장 시 `ProdConfirmModal` 직접

### Audit log

| 이벤트 | 레벨 | 키 |
|---|---|---|
| PROD 전환 성공 | WARN | `AUTH/env.switch-to-prod` |
| PROD 전환 취소 | INFO | `AUTH/env.switch-to-prod-cancelled` |
| MOCK 전환 | INFO | `AUTH/env.switch-to-mock` |

### 검증 항목

| # | 항목 | 결과 | 신뢰도 |
|---|---|---|---|
| E1 | 컴포넌트 위치 (Dialog + Modal + usePhraseGate) | ✅ verified | 95% |
| E2 | 2단계 게이트 (체크박스 AND phrase) | ✅ verified | 98% |
| E3 | Audit log 발생 (setEnv + logEnvSwitchCancelled) | ✅ verified | 98% |
| E4 | 취소 경로 (헤더 + 설정 양쪽 logEnvSwitchCancelled 호출) | ✅ verified | 96% |
| E5 | 진입점 3곳 모두 | ✅ verified | 94% |

### 보안 불변식 검증

1. PROD 전환 = 실제 자금 거래 위험 → 2단계 보호 ✅
2. 체크박스 동의 → 의도 확인 ✅
3. "실전전환" 정확히 타이핑 → 주의 집중력 확인 ✅
4. `canConfirm = ack AND phraseOk` ✅
5. 취소 시에도 audit log → 시도 흔적 추적 ✅

**검증 결과**: ✅ **100% 의도대로 구현**.

---

## SafetyRegistry 전역 ON/OFF

```
safetyRegistry.setMaster(false)   ← 전역 OFF
  → 이후 모든 매수 요청 차단
  → booster onTrigger에서도 snap 후 차단

safetyRegistry.snap()             ← 현재 상태 조회
  → { master: bool, errorLock: bool }
  → master=false OR errorLock=true → 매수 불가
```

---

## Broker 비교

| 항목 | 도메스틱(KIS) | UPBIT |
|---|---|---|
| 안전장치 클래스 | `autoBuyGuard` | `cryptoAutoBuyGuard` |
| Protection 한도 | ProtectionLimitsRepo | ProtectionLimitsRepo (공유) |
| 시간 창 검사 | ✅ assertTimeWindow (KST 분) | 없음 |
| Rate Guard | 인메모리 슬라이딩 윈도우 | createRateGuard + histories Map |
| 임계 초과 반응 | throw AutoOrderBlockedError | SELL_ONLY 전환 + OS 알림 + throw |
| 전역 ON/OFF | safetyRegistry.master | safetyRegistry.master (공유) |
| 실전 전환 게이트 | 2단계 모달 (ack + phrase) | 2단계 모달 (공유) |
| gate 방식 | fail-closed (b8174c5 fix) | fail-closed |
