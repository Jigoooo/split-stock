# 안전 3계층 · 킬스위치 · 로그 뷰어

US-013. 자동매매 사고 방지를 위한 3중 잠금 + 글로벌 킬스위치 + 실시간 로그 뷰어.

상위 인덱스: [../README.md](../README.md)

## 1. 안전 3계층 상태

[src/main/safety/safety-state.ts](../../src/main/safety/safety-state.ts)

```ts
interface SafetySnapshot {
  master: boolean;                // 1계층: 전역 자동매매 ON/OFF
  bySymbol: Record<string, boolean>; // 2계층: 종목별 ON/OFF
  errorLock: {                    // 3계층: 오류 자동 잠금
    active: boolean;
    reason: string | null;
    triggeredAt: number | null;
  };
  updatedAt: number;
}
```

### `canTrade(pdno)` 판정 (AND 조건)

```
canTrade = !errorLock.active
         && master === true
         && bySymbol[pdno] !== false   // undefined(미지정)는 기본 허용
```

### API

| 메서드 | 설명 | 이벤트 로그 |
| --- | --- | --- |
| `setMaster(on)` | 1계층 ON/OFF | `SYS / safety.master.{on|off}` (INFO) |
| `toggleSymbol(pdno, on)` | 2계층 변경 | `SYS / safety.symbol.{on|off}` (INFO) |
| `triggerKillSwitch(reason)` | master=false + errorLock 활성 | `SYS / safety.kill_switch.triggered` (ERROR) |
| `recordError(reason)` | master=false + errorLock 활성 (자동) | `SYS / safety.error_lock.engaged` (ERROR) |
| `clearErrorLock()` | errorLock 해제. master 는 복구되지 않음 — 수동 재활성 필요 | `SYS / safety.error_lock.cleared` (INFO) |
| `subscribe(listener)` | 스냅샷 변경 구독 → unsubscribe 함수 반환 | — |

### 사용 방법 (코드)

```ts
const safety = createSafetyState({ logger, initial: { master: false } });
safety.setMaster(true);
safety.toggleSymbol('005930', true);

if (!safety.canTrade('005930')) return; // 주문 skip

// 증거금 부족 등 비즈니스 에러 발생 시
safety.recordError('증거금 부족 — KIS 응답 rt_cd=7');
```

## 2. tRPC 라우터

[src/main/trpc/routers/safety-router.ts](../../src/main/trpc/routers/safety-router.ts) — 모두 `publicProcedure`.

| 엔드포인트 | 입력 | 반환 |
| --- | --- | --- |
| `safety.getState` | — | `SafetySnapshot` |
| `safety.setMaster` | `{ on: boolean }` | 변경된 스냅샷 |
| `safety.toggleSymbol` | `{ pdno: /^\d{6}$/, on: boolean }` | 변경된 스냅샷 |
| `safety.triggerKillSwitch` | `{ reason: string }` (기본 `'사용자 단축키'`) | 변경된 스냅샷 |
| `safety.clearErrorLock` | — | 변경된 스냅샷 |

## 3. UI — 안전 스위치 패널

[src/renderer/src/features/safety-switch/](../../src/renderer/src/features/safety-switch/)

- `SafetySwitchPanel` — master 토글 / 종목별 토글 표시 / 오류락 상태 + 해제 버튼.
- `useKillSwitchHotkey()` (renderer 보조) — `Ctrl/Cmd+Shift+K` 로 `trpc.safety.triggerKillSwitch({ reason: '렌더러 단축키' })` 트리거.

## 4. 글로벌 단축키 (main 프로세스)

[main/index.ts](../../src/main/index.ts) 부팅 시:

```ts
const { globalShortcut } = await import('electron');
globalShortcut.register('CommandOrControl+Shift+K', () => {
  safety.triggerKillSwitch('글로벌 단축키');
});
```

- 다른 앱이 점유 중이면 등록 실패 → 무시 (렌더러 훅이 대체 동작).
- `app.on('will-quit')` 에서 `globalShortcut.unregisterAll()` 로 정리.

## 5. 로그 뷰어 (event_logs)

### 라우터

[src/main/trpc/routers/logs-router.ts](../../src/main/trpc/routers/logs-router.ts)

```ts
const { entries } = await trpc.logs.tail.query({
  limit: 100,
  level: 'WARN',      // optional
  category: 'ORDER',  // optional
  beforeId: 12345,    // 페이지네이션 (커서)
});
```

- 정렬: `eventLogs.id DESC` (최신부터).
- 필터는 SQL 이 아니라 결과 array 에서 추가 filter — 작은 tail 규모에는 충분.
- `payloadJson` 은 마스킹된 JSON 문자열.

### 페이지

[src/renderer/src/pages/logs/ui/logs-page.tsx](../../src/renderer/src/pages/logs/ui/logs-page.tsx):
- 2초 polling (`refetchInterval: 2000`)
- 레벨/카테고리 select 필터
- payload 는 pretty-print 로 펼침/접기

## 6. 테스트 방법

- 단위: [src/main/safety/safety-state.test.ts](../../src/main/safety/safety-state.test.ts) 8 cases — 초기값/setMaster/toggleSymbol/triggerKill/recordError/clearErrorLock/canTrade 각 조합/subscribe 해지.
- E2E: [e2e/kill-switch.spec.ts](../../e2e/kill-switch.spec.ts) — playwright-electron 으로 로그인 → 대시보드 → 단축키 → master=false 가 UI에 반영되는지 확인.
- 수동: `pnpm dev` → `Ctrl+Shift+K` 누르고 로그 탭에서 `SYS/safety.kill_switch.triggered` (ERROR) 확인.

## 7. 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| master=false 일 때 canTrade 호출 | false 반환 — 상위 FSM이 주문 skip |
| errorLock 활성 + master=true | canTrade=false (errorLock 우선) |
| errorLock 해제 후에도 master 자동 ON 되지 않음 | 사용자가 수동으로 master 재활성 필요 (의도적 — "안 좋은 상황을 알고 다시 켠다") |
| bySymbol 미지정 | 기본 허용 (undefined 처리) |
| 같은 값으로 setMaster 호출 (on→on) | 스냅샷 변경 없이 동일 snapshot 반환 |
| listener 에서 throw | 다음 listener 정상 호출 (Array.from 으로 복사 후 순회) |
| 글로벌 단축키를 다른 앱이 점유 | 등록 실패 무시 — 렌더러 훅이 대체 |

## 8. 호출측 책임

- 주문 직전: `if (!safety.canTrade(pdno)) return;`
- KIS 비즈니스 에러(`API_BUSINESS`) 중 증거금 부족 등 자동매매 중단 신호 감지 시 `safety.recordError(reason)` 호출.
- UI 에서는 `SafetySnapshot.errorLock.reason` 노출 — 사용자가 원인 파악 후 수동 해제.
