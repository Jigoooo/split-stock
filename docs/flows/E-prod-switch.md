# E. 실전 전환 2단계 모달 (NM-002)

## 정확한 흐름

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

## 진입점 (3곳)

1. **헤더 환경 배지** — `router-layout.tsx` `<SwitchEnvDialog open={shell.pendingEnv !== null} />`
2. **설정 패널** — `switch-env-section.tsx` inline expand form
3. **자격증명 저장** — `credentials-form.tsx` PROD 환경 저장 시 `ProdConfirmModal` 직접

## Audit log

- 성공: `AUTH/env.switch-to-prod` (WARN)
- 취소: `AUTH/env.switch-to-prod-cancelled` (INFO) — W5-C 추가
- MOCK 전환: `AUTH/env.switch-to-mock` (INFO)

## 검증 항목

| # | 항목 | 결과 | 신뢰도 |
|---|---|---|---|
| E1 | 컴포넌트 위치 (Dialog + Modal + usePhraseGate) | ✅ verified | 95% |
| E2 | 2단계 게이트 (체크박스 AND phrase) | ✅ verified | 98% |
| E3 | Audit log 발생 (setEnv + logEnvSwitchCancelled) | ✅ verified | 98% |
| E4 | 취소 경로 (헤더 + 설정 양쪽 logEnvSwitchCancelled 호출) | ✅ verified | 96% |
| E5 | 진입점 3곳 모두 | ✅ verified | 94% |

## 보안 불변식 검증

1. PROD 전환 = 실제 자금 거래 위험 → 2단계 보호 ✅
2. 체크박스 동의 → 의도 확인 ✅
3. "실전전환" 정확히 타이핑 → 주의 집중력 확인 ✅
4. canConfirm = ack AND phraseOk ✅
5. 취소 시에도 audit log → 시도 흔적 추적 ✅

## 검증 결과

✅ **100% 의도대로 구현**. 정정 사항 없음.
