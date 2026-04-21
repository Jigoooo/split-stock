# split-stock 기능 문서

매직스플릿 방식(N분할 하향매수 + 차수별 독립 익절)을 한국투자증권 KIS Developers API 위에 Electron 데스크톱 앱으로 재구현한 프로젝트입니다. 본 디렉토리는 지금까지 구현된 기능을 도메인별로 묶어 **사용방법 / 실제 테스트 방법 / 인증 필요 여부 / 의도된 엣지 케이스** 관점에서 정리합니다.

> 스택 개요: Electron 41 + Vite 8(rolldown) + React 19 + TypeScript 6(strict, composite) + SQLite(better-sqlite3) + Drizzle ORM + trpc-electron v11 + Zod + neverthrow. 자세한 내용은 [features/ui-and-build.md](features/ui-and-build.md) 참조.

## 개발 흐름 요약

- 진행 기록: [.omc/progress.txt](../.omc/progress.txt)
- PRD / 수락 기준: [.omc/prd.json](../.omc/prd.json)
- 다음 마일스톤 백로그: 개인 메모리 `split-stock-next-milestone.md`
- 커밋 히스토리: `git log --oneline` (Session 1~7 완료)

## 기능 요약 테이블

| 기능 도메인 | 핵심 경로 | 인증 필요 | 상세 문서 |
| --- | --- | --- | --- |
| 인증 / 자격증명 / 환경 전환 | [src/main/security/credentials-repo.ts](../src/main/security/credentials-repo.ts), [src/main/kis/auth.ts](../src/main/kis/auth.ts), [src/renderer/src/features/switch-env/](../src/renderer/src/features/switch-env/) | — (저장 시점은 없음) | [features/authentication.md](features/authentication.md) |
| 시세 조회 / 종목 검색 / 티어드 감시 / 차트 | [src/main/kis/domestic-stock.ts](../src/main/kis/domestic-stock.ts), [src/main/kis/ws-client.ts](../src/main/kis/ws-client.ts), [src/main/kis/ws-frame-parser.ts](../src/main/kis/ws-frame-parser.ts), [src/main/trading/tiered-quote-feed.ts](../src/main/trading/tiered-quote-feed.ts), [src/main/trading/stock-master-repo.ts](../src/main/trading/stock-master-repo.ts) | 대부분 필요 (검색은 public) | [features/market-data.md](features/market-data.md) |
| 주문 실행 / 미체결 자동취소 | [src/main/kis/order.ts](../src/main/kis/order.ts), [src/main/trpc/routers/order-router.ts](../src/main/trpc/routers/order-router.ts), [src/main/trading/pending-order-watcher.ts](../src/main/trading/pending-order-watcher.ts) | 필요 | [features/order-execution.md](features/order-execution.md) |
| 자동감시 보드 / 전역 ON/OFF / pause-resume / outcome 알림 | [src/main/trading/watch-engine.ts](../src/main/trading/watch-engine.ts), [src/main/trpc/routers/watch-router.ts](../src/main/trpc/routers/watch-router.ts), [src/renderer/src/pages/main/ui/watch-board.tsx](../src/renderer/src/pages/main/ui/watch-board.tsx) | 필요 (주문 경유) | [features/auto-watch.md](features/auto-watch.md) |
| 실시간 트레이딩 패널 (호가/체결/주문/단축키) | [src/main/realtime/](../src/main/realtime/), [src/main/trpc/routers/realtime-router.ts](../src/main/trpc/routers/realtime-router.ts), [src/renderer/src/widgets/trading-panel/](../src/renderer/src/widgets/trading-panel/), [src/renderer/src/features/order-ticket/](../src/renderer/src/features/order-ticket/) | 필요 | [features/realtime-trading.md](features/realtime-trading.md) |
| 자동매매 FSM / 차수 장부 / 부스터 / 예약매수 / 리스플릿 | [src/main/trading/fsm.ts](../src/main/trading/fsm.ts), [src/main/trading/lots-repo.ts](../src/main/trading/lots-repo.ts), [src/main/trading/booster-watcher.ts](../src/main/trading/booster-watcher.ts), [src/main/trading/prebuy-repo.ts](../src/main/trading/prebuy-repo.ts), [src/main/trading/respiit-planner.ts](../src/main/trading/respiit-planner.ts) | 필요 (주문 경유) | [features/auto-trading.md](features/auto-trading.md) |
| 안전 3계층 / 킬스위치 / 로그 뷰어 | [src/main/safety/safety-state.ts](../src/main/safety/safety-state.ts), [src/main/trpc/routers/logs-router.ts](../src/main/trpc/routers/logs-router.ts), [src/renderer/src/features/safety-switch/](../src/renderer/src/features/safety-switch/) | — | [features/safety.md](features/safety.md) |
| 전략 파라미터 / 프리셋 / 감사 | [src/main/trading/strategy-repo.ts](../src/main/trading/strategy-repo.ts), [src/shared/contracts/strategy.ts](../src/shared/contracts/strategy.ts), [src/renderer/src/features/edit-strategy/](../src/renderer/src/features/edit-strategy/) | — (로컬 설정) | [features/strategy.md](features/strategy.md) |
| 관측성 — 이벤트 로그 / 파일 로테이션 / Sentry / 리포트 / 백업 | [src/main/logging/](../src/main/logging/), [src/main/monitoring/sentry.ts](../src/main/monitoring/sentry.ts), [src/main/reporting/daily-report.ts](../src/main/reporting/daily-report.ts), [src/main/backup/backup.ts](../src/main/backup/backup.ts) | — (로컬) | [features/observability.md](features/observability.md) |
| Renderer FSD / 페이지 / HTS 스타일 | [src/renderer/src/](../src/renderer/src/) | — | [features/ui-and-build.md](features/ui-and-build.md) |
| 빌드 / 업데이터 / 패키징 | [electron-builder.yml](../electron-builder.yml), [src/main/updater.ts](../src/main/updater.ts) | — | [features/ui-and-build.md](features/ui-and-build.md) |

> "인증 필요"의 의미: tRPC `authedProcedure` 또는 KIS REST 호출 전 `credentials + 발급 토큰`이 필요한지. 로컬 상태 조작(안전 스위치, 설정, 로그 조회)은 로컬 DB만 사용하므로 표에서 "—"로 표기합니다.

## 공통 테스트 방법

전체 프로젝트는 2계층 테스트 + E2E로 구성되어 있습니다.

```bash
# 단위 / 통합 (Vitest 4.1 — main/node + renderer/jsdom projects)
pnpm test

# 특정 영역만 감시
pnpm test:watch -- src/main/trading

# Playwright Electron E2E (킬 스위치 등)
pnpm test:e2e

# 타입 + 린트
pnpm typecheck
pnpm lint
```

Vitest 프로젝트 분리: [vitest.config.ts](../vitest.config.ts) — main은 node 환경, renderer는 jsdom + jest-dom. 통합 실행 시 두 프로젝트 모두 실행됩니다.

## Session 1~8 누적 검증 (2026-04-18)

| 지표 | 수치 |
| --- | --- |
| 테스트 파일 | 35 |
| 테스트 케이스 | 222 (모두 PASS) |
| TypeScript 에러 | 0 (`tsc -b`) |
| Biome 린트 에러 | 0 (155 파일) |
| 렌더러 번들 (production) | ≈ 1.1 MB + CSS |

## Known Issues & 본 문서화 세션에서 수정된 항목

- **[FIXED in this session]** `AuthService`가 단일 `KisHttpClient`만 받아 PROD 환경 전환 후에도 토큰 발급이 MOCK URL로 감. 수정 범위:
  - [src/main/kis/auth.ts](../src/main/kis/auth.ts): `httpByEnv: Record<AppEnv, KisHttpClient>` 주입으로 변경, `issueOnce(env, ...)`에서 env별 클라이언트 사용
  - [src/main/index.ts](../src/main/index.ts): `new AuthService(httpByEnv, tokenStore)` 로 전체 전달
  - [src/main/kis/auth.test.ts](../src/main/kis/auth.test.ts): MOCK/PROD 양쪽 dispatch 테스트 추가

- **[관찰됨, 본 세션에서 스코프 외]** `dashboard-page`의 `getPositionOverlay` 호출에서 `accountId`가 `1`로 하드코드. `accounts` 테이블에 계좌가 실제 등록되는 플로우가 아직 없으므로 다중 계좌 도입 전까지는 허용.

## 디렉토리 인덱스

- [features/authentication.md](features/authentication.md) — US-005, US-006, NM-002
- [features/market-data.md](features/market-data.md) — US-007, US-011, NM-003, NM-011, NM-013
- [features/order-execution.md](features/order-execution.md) — US-010, NM-001
- [features/auto-watch.md](features/auto-watch.md) — CUSTOM / PREBUY / BOOSTER 자동감시 제어, 알림, 히스토리
- [features/realtime-trading.md](features/realtime-trading.md) — NM-014 (WS parser/FeedBus/RealtimeService + 호가/체결/주문/단축키)
- [features/auto-trading.md](features/auto-trading.md) — US-012, NM-004, NM-005, NM-006
- [features/safety.md](features/safety.md) — US-013
- [features/strategy.md](features/strategy.md) — NM-010
- [features/observability.md](features/observability.md) — NM-007, NM-008, NM-009, NM-012
- [features/ui-and-build.md](features/ui-and-build.md) — US-001~004, US-008~009, US-014
