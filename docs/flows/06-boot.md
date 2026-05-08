# 06. 부팅 + catch-up 다이얼로그 플로우 (NM-016)

앱 부팅 순서 + catch-up 감지 다이얼로그. Phase B 4건 강화 후 상태 (`3efd22c`).

---

## 부팅 순서

### ASCII 흐름도

```
Electron main process 시작
  → bootstrapDeps()
       ├─ DB migrate
       ├─ repos 초기화
       ├─ strategyEngine 생성
       └─ currentStateSync.trigger('startup')
            → strategyEngine.refreshTrackedSymbols()  [즉시 가동 — catch-up 대기 없음]
  → bootStatus.phase = 'runtime-ready'
  → renderer polling (500ms) 감지
  → <MainWindowRuntimes> 마운트
  → <CatchUpRuntime accountId> 조건부 렌더링
```

---

## catch-up 다이얼로그 (Phase B 4건 강화 — `3efd22c`)

### ASCII 흐름도 (현재 구현 — `3efd22c` 이후)

```
<CatchUpRuntime> 마운트
  → trpc.catchUp.scan.useQuery 자동 발화
       (staleTime: Infinity, refetchOnWindowFocus: false)
  → catch-up-router.scan()
       → scanCatchUp()
            ├─ lotsRepo.listRows(accountId)   [ACTIVE_CYCLE_STATUSES 필터]
            ├─ strategyRepo로 profile 조회
            ├─ bus.getLatestTick(pdno).price  [현재가 — WS tick 캐시]
            └─ evaluateCatchUpForSymbol()     [top 차수 기준 chain 평가]

  → items.length > 0 이면:
       ├─ ✅ IPC push: appShell:catch-up-detected (Phase B 추가)
       │    → renderer fallback 없이도 즉시 인지 가능
       └─ ✅ strategyEngine.pause() 호출 (Phase B 추가)
            → onTick: paused 상태면 즉시 return + log
            → 사용자 결정 전 자동매수 진입 차단

  → createPortal(modal, document.body) 렌더링

  [사용자 결정]
  ├─ [적용]: trpc.catchUp.applyDecision mutation
  │           → event_logs 기록
  │           → isLastDecision 여부 확인
  │                → ✅ isLastDecision=true: strategyEngine.resume()
  │           → dismissed=true → 모달 unmount
  │
  └─ [나중에 결정]: trpc.catchUp.dismiss mutation
       → ✅ settings.catchUpPending 영속화 (Phase B 추가)
       │    → 다음 부팅 시 재표시
       → dismissed=true → 모달 unmount
       → strategyEngine.resume()  [일시정지 해제]

  [30초 timeout fallback — Phase B 추가]
  setTimeout(30_000)
    → catch-up-router.timeoutDismiss mutation
    → strategyEngine.resume()
    → 모달 unmount (응답 없으면 자동 해제)
```

### maxReachedNth 산출 로직

```
top = activeLots 중 가장 높은 nth 차수 (보유 최고 차수)
prevBuyPrice = top.buyPrice

loop nextRule:
  triggerPrice = Math.floor(prevBuyPrice * (1 - rule.triggerDropPct))
  if (currentPrice <= triggerPrice):
    reached = true
    prevBuyPrice = triggerPrice   [chain — 누적 하락 체크]
  else:
    break

maxReachedNth = top.nth + reached count
```

### catch-up-router mutations (Phase B 신규)

| mutation | 동작 |
|---|---|
| `dismiss` | settings.catchUpPending 영속화 + resume |
| `timeoutDismiss` | 30초 후 자동 해제 + resume |
| `applyDecision(isLastDecision)` | event_logs 기록 + isLastDecision=true 시 resume |

---

## Phase B 4건 강화 vs 기존 구현 대조

| 항목 | Phase B 이전 | Phase B 이후 (`3efd22c`) |
|---|---|---|
| strategyEngine pause | 없음 (즉시 가동) | ✅ catch-up 감지 시 pause → 결정 후 resume |
| IPC push | 없음 (tRPC pull만) | ✅ `appShell:catch-up-detected` push (pull과 병행 fallback) |
| settings 영속화 | 없음 (in-memory dismissed만) | ✅ `settings.catchUpPending` — 재부팅 후 재노출 |
| 30초 timeout | 없음 | ✅ timeoutDismiss → resume + 모달 unmount |

---

## LEAD 가설 vs 실제 코드 (Phase B 이전 원본 분석 기준)

| # | LEAD 가설 | Phase B 이전 실제 | Phase B 이후 (`3efd22c`) |
|---|---|---|---|
| G1 | bootstrap-deps 내 직접 scan | renderer mount 후 tRPC pull | tRPC pull + IPC push 병행 ✅ |
| G2 | maxReachedNth chain 로직 | 정확 (top.buyPrice × (1-pct), Math.floor) | 동일 ✅ |
| G3 | IPC `appShell:catch-up-detected` | 없음 | ✅ Phase B 추가 |
| G4 | features/catch-up-confirm/ 모달 | 일치 (`CatchUpRuntime`) | 동일 ✅ |
| G5 | strategyEngine pause | 없음, 즉시 가동 | ✅ Phase B 추가 |
| G6 | settings.catchUpPending 영속화 | 없음 | ✅ Phase B 추가 |
| G7 | 30초 timeout dismiss | 없음 | ✅ Phase B 추가 |

---

## 검증 결과

✅ Phase B 4건 모두 강화 완료 (`3efd22c`).
✅ maxReachedNth chain 로직 정상.
✅ catch-up 감지 → strategyEngine pause → 사용자 결정 → resume 전체 흐름 완성.
⚠️ G Phase B 회귀 방지 테스트 보강 backlog — multi-account / 차수 변형 시나리오 미커버.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `src/main/catch-up/catch-up-router.ts` | scan / dismiss / timeoutDismiss / applyDecision |
| `src/main/catch-up/scan-catch-up.ts` | maxReachedNth 산출 |
| `src/renderer/features/catch-up-confirm/` | CatchUpRuntime, 모달 UI |
| `src/main/strategy/strategy-execution-engine.ts` | pause / resume API |
| `src/preload/index.ts` | appShell:catch-up-detected IPC 구독 |
