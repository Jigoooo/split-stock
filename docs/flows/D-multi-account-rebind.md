# D. 멀티계좌 booster 재구독 (post-E2 HIGH-1)

## 정확한 흐름

```
[사용자: env/account 배지 클릭]
        │
        ▼
auth-router.ts:65  ctx.setEnvAndAccount({ env, accountId })
        │
        ▼
context.ts:364  setEnvAndAccount()
  1. activeAccountId = next.accountId    [원자 교체]
  2. currentEnv = next.env
  3. clearBrokerCache()
  4. syncWatchEngine(next.accountId)
  5. syncAccountRealtimeSubscription()   [KIS/KIWOOM realtime 재구독]
  6. onActiveAccountChanged?.(next.accountId)   [콜백 동기 발화]
        │
        ▼
bootstrap-deps.ts:519-521  rebindCryptoBoosterSubscription(accountId)
        │
        ├── [이전 unsub 있으면] cryptoBoosterUnsub()  [이전 계좌 해제]
        │
        └── [accountId !== null]
              cryptoRealtime.bus.subscribePrivateOrder(accountId, handler)
                │
                ▼
              cryptoBoosterUnsub = Unsubscribe  [handle 저장]

[새 계좌 UPBIT fill event 수신]
cryptoRealtime.applyPrivateOrder(session, event)
  → bus.publishPrivateOrder(event)
  → subscribePrivate 내부 Set listener 발화
  → cryptoAutoRepo.syncLotsFromFillEvent(event)
  → cryptoBoosterService.handleCryptoFill(event)  [C 플로우 진입]
```

## 검증 항목

| # | 항목 | 결과 | 신뢰도 |
|---|---|---|---|
| D1 | onActiveAccountChanged hook 등록 | ✅ context.ts:173, bootstrap-deps.ts:518-521 | 100% |
| D2 | rebindCryptoBoosterSubscription unsub 패턴 | ✅ closure 변수 + 표준 unsub-then-resubscribe | 100% |
| D3 | setEnvAndAccount 트리거 wiring (3 진입점) | ✅ auth-router.ts:65, 103, account-shared.ts:52-55 | 100% |
| D4 | unsubscribe handle 보관/호출 | ✅ Map.delete 표준 패턴 | 100% |
| D5 | 단위 테스트 | ⚠️ context.test.ts:137-188 콜백 발화 테스트만 (rebind 내부 미커버) | 95% |
| D6 | 흐름 단절 지점 | ✅ 없음 (gap A/B 는 의도된 설계) | 95% |

### D5 커버리지 갭 (개선 권고)
- `rebindCryptoBoosterSubscription` 내부 동작 (이전 unsub 호출, syncLotsFromFillEvent 연계, handleCryptoFill 전달) 직접 검증 테스트 없음
- end-to-end (auth-router → factory → callback → booster) 통합 테스트 없음

### 구조적 주의점
- `cryptoRealtime.bus` 가 공유 싱글톤 — 다중 계좌 병렬 구독 요구 시 단일 handle 패턴이 병목 (현재 단일 activeAccountId 설계상 문제 없음)

## 검증 결과

✅ wiring 단절 없음. 정상 동작.
⚠️ 단위 테스트 보강 권고 (D5).
