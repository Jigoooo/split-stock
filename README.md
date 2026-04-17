# split-stock

매직스플릿 방식(N분할 하향매수 + 차수 독립 익절)을 한국투자증권 KIS API 위에 재구현하는 Electron 데스크톱 앱.

> ⚠️ 본 저장소는 개발 초기 스캐폴딩 단계입니다. 실전 운영 전에는 `/.omc/prd.json`에 정의된 모든 User Story가 `passes: true` 상태여야 합니다.

## 핵심 설계

- **플랫폼**: Electron 33 + Vite 5 + React 19 + TypeScript 5 (strict)
- **빌드 툴**: `electron-vite` (alex8088) — main / preload / renderer 3-entry
- **IPC**: `trpc-electron` v11 + `@trpc/react-query` — main↔renderer 타입 세이프
- **상태 (renderer)**: TanStack Query v5 (trpc client 내장) + Zustand (UI 상태)
- **DB**: SQLite(`better-sqlite3`) + Drizzle ORM
- **검증**: Zod (모든 API 경계) + `neverthrow` Result 타입
- **테스트**: Vitest (main/renderer 프로젝트 분리) + Playwright-electron (E2E)
- **증권사 API**: 한국투자증권 KIS Developers (모의투자 VPS 우선)
- **Renderer 아키텍처**: FSD(Feature-Sliced Design) — `app/pages/widgets/features/entities/shared`

## 보안 원칙 (Security Invariants)

1. **자격증명 저장**: `electron.safeStorage.encryptString` 암호화 후 SQLite `credentials` 테이블에 BLOB으로 저장. 평문 저장 절대 금지.
2. **로그 마스킹**: App Key / App Secret / Access Token은 마지막 4자만 남기고 `*`로 마스킹(`maskSecret`).
3. **주문 호출 경로**: 오직 main 프로세스에서만 가능. Renderer는 tRPC 경유 요청만 발행.
4. **환경 분리**: `AppEnv = 'MOCK' | 'PROD'` 상단 배지로 항상 표시. 전환 시 확인 다이얼로그 필수.
5. **킬 스위치**: 글로벌 단축키 1개로 모든 자동매매 강제 중지(구현 예정 US-013).

## 디렉토리 구조 (현재)

```
split-stock/
├── .omc/                        # ralph / PRD / progress
│   ├── prd.json
│   └── progress.txt
├── electron.vite.config.ts
├── drizzle.config.ts
├── vitest.config.ts
├── biome.json
├── tsconfig.json (refs)
├── tsconfig.node.json           # main / preload / shared
├── tsconfig.web.json            # renderer
├── package.json
├── .npmrc                       # pnpm + Electron 호환
└── src/
    ├── main/
    │   ├── index.ts             # BrowserWindow 생성 + contextIsolation
    │   ├── db/
    │   │   ├── client.ts        # better-sqlite3 + drizzle
    │   │   ├── schema.ts        # 차수 장부 포함 8개 테이블
    │   │   └── bootstrap-schema.ts  # 테스트용 raw CREATE
    │   └── security/
    │       ├── mask-secret.ts
    │       ├── mask-secret.test.ts
    │       ├── credentials-repo.ts    # safeStorage + SQLite BLOB
    │       └── credentials-repo.test.ts
    ├── preload/
    │   └── index.ts             # exposeElectronTRPC + appEnv
    ├── renderer/
    │   ├── index.html
    │   ├── vitest.setup.ts
    │   └── src/
    │       ├── main.tsx
    │       └── app/             # FSD app 레이어
    │           ├── app.tsx
    │           ├── app.css      # 1rem = 10px (clamp 반응형)
    │           └── index.ts
    └── shared/
        └── contracts/           # Zod 스키마
            ├── app.ts           # AppEnv, Credentials, SafetyFlags
            ├── kis.ts           # KIS 요청/응답 스키마
            └── index.ts
```

## 파일/폴더 네이밍

- **전부 kebab-case** (`credentials-repo.ts`, `mask-secret.ts`, `app.tsx`).
- 컴포넌트/타입 심볼은 PascalCase (`App`, `Credentials`).
- Hook은 `useXxx` (`useBalance`).
- `hooks/`, `types/`, `components/`, `utils/`, `helpers/` 같은 essence 기반 폴더 금지 (FSD rules §7.3).

## 설치 & 실행 (pnpm)

```bash
# 1. pnpm 9+ 설치 (없다면)
corepack enable
corepack prepare pnpm@9.14.4 --activate

# 2. 의존성 설치 (.npmrc가 Electron 네이티브 모듈을 호이스트)
pnpm install

# 3. 네이티브 모듈(better-sqlite3)을 Electron ABI에 맞춰 리빌드
pnpm rebuild

# 4. Drizzle 마이그레이션 생성 (스키마 변경 시)
pnpm db:generate

# 5. 개발 서버
pnpm dev

# 6. 검증
pnpm typecheck
pnpm lint
pnpm test
```

## 반응형 폰트 스케일

`app.css`:
```css
:root {
  /* 9px ~ 11px 사이 뷰포트 반응 스케일 (1rem 기준) */
  font-size: clamp(56.25%, 0.35vw + 57.5%, 68.75%);
}
html, body { font-size: 1.4rem; /* 14px 상당 */ }
```
이후 모든 크기는 `rem` 단위로 작성 (`10px → 1rem`).

## Ralph 재개

다음 라운드에서 이어갈 스토리와 수락 기준은 `.omc/prd.json`에 정의되어 있다. 진행 내역은 `.omc/progress.txt`.

```
pnpm dlx claude-code /ralph
# 또는 이미 세션이 있으면 /ralph 명령
```

## 참고

- 매직스플릿 가이드북 원본: <https://wikidocs.net/book/8428>
- KIS Developers: <https://apiportal.koreainvestment.com/intro>
- KIS 공식 GitHub: <https://github.com/koreainvestment/open-trading-api>
- FSD 공식: <https://feature-sliced.design>
