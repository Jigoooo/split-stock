# G. catch-up 부팅 통합 다이얼로그 (NM-016)

## 🟡 LEAD 가설 5건 부정 — 원래 도메인 계획 대비 부분 구현

원래 계획(`kis-hashed-barto.md` Phase B)에는:
- strategyEngine pause 메커니즘
- IPC `appShell:catch-up-detected` push
- [나중에 결정] settings.catchUpPending 영속화
- 30초 timeout fallback

**현재 구현은 informational UI 수준** (modal 결정이 실제 fsm 동작에 영향 없음).

## 실제 흐름 (코드 기반)

```
앱 부팅
  → bootstrapDeps() — DB migrate, repos, strategyEngine 생성
  → currentStateSync.trigger('startup') → strategyEngine.refreshTrackedSymbols() 즉시
     ※ strategyEngine 이미 가동 — catch-up 대기 없음
  → bootStatus.phase = 'runtime-ready'
  → renderer polling(500ms) 감지
  → <MainWindowRuntimes> 마운트 → <CatchUpRuntime accountId> 조건부 렌더링
  → trpc.catchUp.scan.useQuery 자동 발화 (staleTime: Infinity, refetchOnWindowFocus: false)
  → catch-up-router.scan() → scanCatchUp()
     ├ lotsRepo.listRows(accountId) — ACTIVE_CYCLE_STATUSES 필터
     ├ strategyRepo로 profile 조회
     ├ bus.getLatestTick(pdno).price — 현재가 (WS tick 캐시)
     └ evaluateCatchUpForSymbol() — top 차수 기준 chain 평가
  → items.length > 0 이면 createPortal(modal, document.body) 렌더링
  → 사용자 결정
     ├ [적용]: trpc.catchUp.applyDecision mutation (event_logs 기록만, MVP)
     │          → dismissed=true → 모달 unmount
     └ [나중에 결정]: dismissed=true → 모달 unmount
                    → 영속화 없음, 재시작 시 재표시
  ※ 30초 timeout 없음. strategyEngine pause 없음. appShell IPC push 없음.
```

## maxReachedNth 산출 로직 (정상)

```
top = activeLots 중 가장 높은 nth 차수 (1차 아닌 보유 최고 차수)
prevBuyPrice = top.buyPrice
loop nextRule:
  triggerPrice = Math.floor(prevBuyPrice * (1 - rule.triggerDropPct))
  if (currentPrice <= triggerPrice):
    reached = true
    prevBuyPrice = triggerPrice  // chain
  else:
    break
maxReachedNth = top.nth + reached count
```

## 검증 항목

| # | LEAD 가설 | 실제 | 상태 |
|---|---|---|---|
| G1 | bootstrap-deps 내 직접 scan | renderer mount 후 tRPC pull | ❌ 불일치 |
| G2 | maxReachedNth chain 로직 | 정확 (top.buyPrice × (1-pct), Math.floor) | ✅ 일치 |
| G3 | IPC `appShell:catch-up-detected` | **없음** (tRPC pull 방식) | ❌ 불일치 |
| G4 | features/catch-up-confirm/ 모달 | 일치 (`CatchUpRuntime`) | ✅ 일치 |
| G5 | strategyEngine pause | **없음**, 즉시 가동 | ❌ 불일치 |
| G6 | settings.catchUpPending 영속화 | **없음** (in-memory dismissed만) | ❌ 불일치 |
| G7 | 30초 timeout dismiss | **없음** | ❌ 불일치 |

## 도메인 의도 vs 현재 구현 차이 영향

**의도** (Phase B):
- 다중 종목이 catch-up 상태일 때 사용자가 결정하기 전에 자동매매가 진입하지 않도록 일시정지

**현재 구현**:
- modal 표시는 되지만, 그 사이에 fsm은 정상 가동
- 사용자가 modal 보는 동안 가격이 trigger 도달하면 자동 매수 발사
- modal 결정은 단순 informational + event_logs 기록만

## 검증 결과

🟡 **5/7 가설 부정**. 도메인 계획 대비 informational UI 수준 구현.

**사용자 확인 필요**:
1. 현재 informational 수준 구현이 의도였나, 아니면 land 미완성인가?
2. strategyEngine pause + IPC push + 영속화 + timeout 4개를 다음 phase로 추가할 것인가?
