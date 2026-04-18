# 전략 파라미터 · 프리셋 · 변경 감사

NM-010. 자동매매 FSM 이 사용하는 `totalAmountKrw / maxStages / dropPct / profitPct / boosterPct / boosterAmountKrw` 를 UI 에서 편집하고 프리셋으로 재사용합니다.

상위 인덱스: [../README.md](../README.md)

## 1. 스키마

[src/shared/contracts/strategy.ts](../../src/shared/contracts/strategy.ts):

```ts
const StrategyProfileSchema = z.object({
  totalAmountKrw: z.number().int().positive(),
  maxStages: z.number().int().min(1).max(20),
  dropPct: z.number().positive().max(0.5),     // 0 < x ≤ 0.5
  profitPct: z.number().positive().max(0.5),
  boosterPct: z.number().min(-0.1).max(0.5).optional(),  // 음수는 "즉시 재진입"
  boosterAmountKrw: z.number().int().positive().optional(),
});
```

## 2. 저장 구조

[src/main/trading/strategy-repo.ts](../../src/main/trading/strategy-repo.ts) — settings 테이블에 JSON 직렬화.

| 키 패턴 | 용도 |
| --- | --- |
| `strategy.active` | 글로벌 기본 (`pdno=null`) |
| `strategy.active.{pdno}` | 종목별 override |
| `strategy.preset.{name}` | 명명된 프리셋 |

종목별이 없으면 글로벌 fallback — [account-router.getPositionOverlay](../../src/main/trpc/routers/account-router.ts) 참고.

## 3. tRPC API

[src/main/trpc/routers/strategy-router.ts](../../src/main/trpc/routers/strategy-router.ts) — 모두 `publicProcedure`.

| 엔드포인트 | 입력 | 결과 |
| --- | --- | --- |
| `strategy.getActive` | `{ pdno: string\|null }` | `{ profile: StrategyProfile \| null }` |
| `strategy.setActive` | `{ pdno, profile }` | `{ ok: true }` + 감사 로그 |
| `strategy.clearActive` | `{ pdno }` | `{ ok: true }` |
| `strategy.listPresets` | — | `{ presets: { name, profile }[] }` (이름 오름차순) |
| `strategy.savePreset` | `{ name: 1..50자, profile }` | `{ ok: true }` |
| `strategy.deletePreset` | `{ name }` | `{ ok: true }` |

### 사용 예

```ts
// 글로벌 기본
await trpc.strategy.setActive.mutate({
  pdno: null,
  profile: { totalAmountKrw: 5_000_000, maxStages: 5, dropPct: 0.03, profitPct: 0.05 },
});

// 특정 종목 override
await trpc.strategy.setActive.mutate({
  pdno: '005930',
  profile: { totalAmountKrw: 2_000_000, maxStages: 3, dropPct: 0.02, profitPct: 0.04 },
});

// 프리셋 저장/불러오기
await trpc.strategy.savePreset.mutate({ name: '대형주-보수', profile });
const { presets } = await trpc.strategy.listPresets.query();
```

## 4. 감사 로그 (diff)

모든 `setActive` / `clearActive` / `savePreset` / `deletePreset` 은 `FSM` 카테고리 이벤트를 남깁니다.

| 메시지 | 필드 |
| --- | --- |
| `strategy.updated` | `pdno ('__global__' or code)`, `before: StrategyProfile \| null`, `after: StrategyProfile` |
| `strategy.cleared` | `pdno`, `before` (null 이면 로그 생략) |
| `strategy.preset.saved` | `name`, `profile` |
| `strategy.preset.deleted` | `name` |

별개 `payload` 는 `event-logger.maskPayload` 기본 규칙으로 스크러빙 — 전략 필드에는 secret이 포함되지 않으므로 평문 기록됩니다.

## 5. UI — 설정 페이지

[src/renderer/src/pages/settings/ui/settings-page.tsx](../../src/renderer/src/pages/settings/ui/settings-page.tsx) 탭에서:

- **현재 전략 편집** — [StrategyForm](../../src/renderer/src/features/edit-strategy/ui/strategy-form.tsx)
  - 퍼센트 필드는 사용자 입력 `3` → 내부 `0.03` 으로 환산 (`useEditStrategy` 훅)
  - Zod 에러를 필드별로 inline 표시 (`validateProfile` — [validate.ts](../../src/renderer/src/features/edit-strategy/model/validate.ts))
- **프리셋 드롭다운** — 저장된 프리셋 리스트에서 선택 → 폼 자동 채움
- **저장/삭제** — `savePreset` / `deletePreset` 호출 후 목록 invalidate

## 6. 테스트 방법

| 레이어 | 경로 | 커버 |
| --- | --- | --- |
| Repo | [strategy-repo.test.ts](../../src/main/trading/strategy-repo.test.ts) (10) | 글로벌/종목별 라운드트립, diff 로그, 프리셋 저장/목록/삭제, 잘못된 range Zod 실패, 이름 길이 검증 |
| 검증 | [validate.test.ts](../../src/renderer/src/features/edit-strategy/model/validate.test.ts) (5) | Zod 필드별 에러 path → 폼 필드 매핑 |
| UI | [strategy-form.test.tsx](../../src/renderer/src/features/edit-strategy/ui/strategy-form.test.tsx) (5) | 필드 입력 → submit, 에러 표시, 퍼센트 환산 |

## 7. 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| `dropPct=0` | Zod 실패 (`positive()`) — "0% 이상이어야" |
| `dropPct=0.5` | 허용 (경계값, `max(0.5)`) |
| `dropPct=0.51` | Zod 실패 |
| `profitPct < 0` | 실패 |
| `boosterPct=-0.001` | 허용 — FSM/booster-watcher 에서 **즉시 트리거**로 해석 |
| `boosterAmountKrw` 없이 `boosterPct` 만 | 허용 — 부스터 재매수 시 금액은 `totalAmountKrw/maxStages` fallback (호출측 책임) |
| 프리셋 이름 빈 문자열 | `VALIDATION` — "프리셋 이름은 1~50자" |
| JSON 손상 (설정 DB 수동 수정 후) | `getActive` 가 `PARSE_FAILED` 반환 — UI 는 fallback 로 기본값 표시 |
| 종목별 전략 없음 + 글로벌 있음 | 차수 오버레이 / FSM 은 글로벌 사용 |
| 둘 다 없음 | overlay 의 `profitPct` 는 하드코딩 `0.05` fallback |
