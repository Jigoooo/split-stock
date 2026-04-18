# Renderer FSD · HTS 스타일 · 빌드 · 업데이터

US-001~004, US-008, US-009, US-014. Electron 3-entry 빌드와 FSD 기반 렌더러, HTS 밀도 스타일, electron-builder / electron-updater 를 정리합니다.

상위 인덱스: [../README.md](../README.md)

## 1. Renderer — FSD 레이어

[feature-sliced.design](https://feature-sliced.design/) rules 준수. `hooks/`, `components/`, `types/` 같은 essence 폴더 금지.

| 레이어 | 역할 | 이 프로젝트 슬라이스 |
| --- | --- | --- |
| `app/` | 앱 루트, providers, 글로벌 CSS | [`app/app.tsx`](../../src/renderer/src/app/app.tsx), `providers.tsx`, `app.css` |
| `pages/` | 라우팅 타겟. 페이지별 최상위 UI | `login`, `dashboard`, `logs`, `reports`, `settings` |
| `widgets/` | 복합 UI 블록 | (현재 없음 — 필요 시 추가) |
| `features/` | 사용자 행동 단위 | `save-credentials`, `switch-env`, `safety-switch`, `edit-strategy`, `search-stock`, `backup-restore` |
| `entities/` | 도메인 객체 + 원시 API keys | `account` (query keys) |
| `shared/` | 공용 trpc/query-client/스타일 유틸 | `shared/api/trpc.ts`, `shared/api/query-client.ts` |

각 슬라이스는 `index.ts` public API 가 있고 외부는 그것만 import.

## 2. 페이지 요약

| 페이지 | 책임 |
| --- | --- |
| `login/` | `LoginPage` — credentials 저장 폼 진입, 자격증명 없을 때만 노출 |
| `dashboard/` | 잔고 요약 KPI + 보유 종목 테이블 + 선택한 종목 일봉 차트 + 차수 오버레이 |
| `logs/` | `event_logs` tail, 레벨/카테고리 필터, 2초 polling |
| `reports/` | KPI + CSV 다운로드 (trades/lots/events) |
| `settings/` | 전략 편집 + 프리셋 + Sentry DSN + 백업/복원 + 자동취소 파라미터 |

탭 라우팅: [`app/app.tsx`](../../src/renderer/src/app/app.tsx) 가 `useState<'dashboard'|'logs'|'reports'|'settings'>` 로 관리 (별도 라우터 라이브러리 없음 — 앱 규모가 작아서 충분).

## 3. 주요 features

- [save-credentials](../../src/renderer/src/features/save-credentials/): `CredentialsForm` + `useSaveCredentials`
- [switch-env](../../src/renderer/src/features/switch-env/): `SwitchEnvDialog` (PROD 2단계)
- [safety-switch](../../src/renderer/src/features/safety-switch/): `SafetySwitchPanel` + `useKillSwitchHotkey`
- [edit-strategy](../../src/renderer/src/features/edit-strategy/): `StrategyForm` + `useEditStrategy` + `validateProfile`
- [search-stock](../../src/renderer/src/features/search-stock/): `SearchStockInput` + `useStockSearch` (400ms debounce)
- [backup-restore](../../src/renderer/src/features/backup-restore/): `BackupPanel` (export/import 버튼) + `CredentialsReentryBanner`

## 4. HTS 스타일

[src/renderer/src/app/app.css](../../src/renderer/src/app/app.css) + providers.tsx:

- **기준 폰트**: `1rem = 10px`, 반응형 `clamp(56.25%, 0.35vw + 57.5%, 68.75%)` → 대략 9~11px 스케일
- **본문**: `1.2rem` (12px 기본), KPI 수치 `1.6rem`
- **한국식 색상**: 상승 빨강 (`--up: #e53935`) / 하락 파랑 (`--down: #1e88e5`) / 보합 회색
- **유틸 클래스**
  - `.hts-table` — 얇은 구분선, zebra 없음 (HTS 느낌), 오른쪽 정렬 `.num`
  - `.hts-btn` / `.hts-btn--primary` — 작은 버튼
  - `.panel` / `.panel__title` / `.panel__body` — 카드
  - `.chip`, `.chip--up` / `.chip--down` — 상태 배지
  - `.env-badge--mock` (노랑) / `.env-badge--prod` (빨강)
  - `.modal-overlay` / `.modal` — 다이얼로그

## 5. IPC (trpc-electron v11)

- main: [main/index.ts](../../src/main/index.ts) 가 `createIPCHandler({ router: appRouter, windows:[win], createContext })`
- preload: `preload/index.ts` 가 `exposeElectronTRPC()` + custom IPC 으로 `appEnv` 주입
- renderer: [shared/api/trpc.ts](../../src/renderer/src/shared/api/trpc.ts) 가 `createTRPCReact<AppRouter>()` + `ipcLink` + superjson
- 쿼리 클라이언트: [shared/api/query-client.ts](../../src/renderer/src/shared/api/query-client.ts) — 기본 staleTime 등

## 6. 빌드 툴체인 (US-001, US-014)

### electron-vite 5 + Vite 8

[electron.vite.config.ts](../../electron.vite.config.ts) — main/preload/renderer 3-entry.

- **main / preload**: `build.rollupOptions.output.format='cjs'` + `entryFileNames='[name].cjs'` → ESM 환경(`"type":"module"`)에서 `__dirname` 참조 호환
- **renderer**: ESM 유지 (브라우저 기본)
- **external**: `['electron', 'better-sqlite3']` 필수 — 번들 인라인되면 native addon 실패
- **React Compiler**: `@rolldown/plugin-babel` + `reactCompilerPreset()` — `useMemo`/`useCallback` 자동 삽입

자세한 함정: [split-stock 빌드 함정 메모리](../../.omc/progress.txt) 참고.

### Scripts

[package.json](../../package.json):

| 스크립트 | 용도 |
| --- | --- |
| `pnpm dev` | electron-vite dev (hot reload) — `predev` 가 `electron-rebuild better-sqlite3` 자동 |
| `pnpm build` | typecheck → electron-vite build |
| `pnpm typecheck` | `tsc -b` (composite: tsconfig.node.json + tsconfig.web.json) |
| `pnpm lint` / `lint:fix` | Biome 2.4 |
| `pnpm test` | Vitest (main + renderer projects) |
| `pnpm test:e2e` | Playwright Electron |
| `pnpm db:generate` | drizzle-kit generate (스키마 변경 시) |
| `pnpm rebuild:node` / `:electron` | better-sqlite3 ABI 맞추기 |
| `pnpm build:mac/win/linux` | electron-builder 로 패키징 |

### electron-builder

[electron-builder.yml](../../electron-builder.yml):

```yaml
appId: app.split-stock
productName: split-stock

files:
  - out/**/*
  - drizzle/**/*
  - package.json

extraResources:
  - from: drizzle
    to: drizzle

asar: true

mac:
  target: [{ target: dmg, arch: [arm64, x64] }]
  hardenedRuntime: false  # 서명 없음 (dev 배포용)

win:
  target: [{ target: nsis, arch: [x64] }]

linux:
  target: [AppImage]

publish:
  provider: generic
  url: https://example.invalid/split-stock/updates
```

- **extraResources `drizzle/`** — 마이그레이션 파일을 `process.resourcesPath/drizzle` 로 복사하여 패키지 실행 시 [main/index.ts](../../src/main/index.ts) 의 `resolveMigrationsDir()` 가 찾도록.
- 서명은 dev 배포용이라 생략 (`signAndEditExecutable: false`).

## 7. 자동 업데이트

[src/main/updater.ts](../../src/main/updater.ts):

- `initAutoUpdater(isPackaged, logger)` — `!isPackaged` 면 `updater.skipped.dev` 로그 후 no-op.
- `electron-updater` 의 `autoUpdater` 이벤트 7종 (`checking-for-update`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, `error`) 을 전부 `SYS` 카테고리로 로깅.
- `checkForUpdatesAndNotify()` 가 기본. dev-only 채널이라 현재 실제 서버(`example.invalid`)는 존재하지 않음 — 실배포 시 `electron-builder.yml` 의 `publish.url` 교체.

## 8. 빌드 검증

```bash
pnpm typecheck   # tsc -b
pnpm lint        # biome check .
pnpm test        # vitest run
pnpm build       # electron-vite build

# 실제 패키지
pnpm build:mac   # release/*.dmg 생성
```

## 9. 테스트

- Vitest projects 분리: [vitest.config.ts](../../vitest.config.ts) — main 은 node, renderer 는 jsdom + jest-dom (setup: [vitest.renderer.setup.ts](../../vitest.renderer.setup.ts))
- Playwright Electron: [playwright.config.ts](../../playwright.config.ts) + [e2e/kill-switch.spec.ts](../../e2e/kill-switch.spec.ts)

## 10. 파일/폴더 네이밍

- 전부 **kebab-case** (`credentials-repo.ts`, `mask-secret.ts`, `app.tsx`)
- 컴포넌트 / 타입 심볼만 PascalCase (`SwitchEnvDialog`, `SafetyState`)
- Hook 은 `useXxx` (`useKillSwitchHotkey`)
- 테스트 파일은 `*.test.ts(x)` — 소스와 같은 폴더

## 11. 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| `type: module` + native addon (better-sqlite3) | CJS 포맷 + external 로 해결 — 번들 인라인 금지 |
| `import { app } from 'electron'` 런타임 undefined (rolldown CJS interop) | `createRequire(import.meta.url)('electron')` 로 직접 require — [main/index.ts](../../src/main/index.ts) |
| drizzle 마이그레이션 파일 미포함 | `extraResources` 로 `process.resourcesPath/drizzle` 에 복사 |
| dev HMR 시 hooks 루프 | React Compiler 가 `useMemo`/`useCallback` 자동 — 개발자가 수동 최적화 불필요 |
| 스크립트 pretest/predev/prebuild | better-sqlite3 ABI 불일치 방지용 자동 rebuild |
| 서명 없이 배포 | mac/win 서명 생략 (dev), 사용자에게 Gatekeeper 경고 표시됨 — 정식 배포 시 identity/certificateFile 설정 필요 |
