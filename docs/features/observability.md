# 관측성 — 이벤트 로그 · 파일 로테이션 · Sentry · 일일 리포트 · 백업/복원

NM-007 / NM-008 / NM-009 / NM-012. 운영/감사 품질을 위한 5개 서비스.

상위 인덱스: [../README.md](../README.md)

## 1. 이벤트 로거 (DB)

[src/main/logging/event-logger.ts](../../src/main/logging/event-logger.ts)

### 구조

```ts
interface EventLogEntry {
  level: 'INFO' | 'WARN' | 'ERROR';
  category: 'AUTH' | 'ORDER' | 'FSM' | 'WS' | 'SYS';
  message: string;
  payload?: Record<string, unknown>;
  secretKeys?: readonly string[];
}
```

모든 payload 는 `maskPayload` 로 재귀 스크러빙 — 기본 마스킹 키: `appKey`, `appSecret`, `token`, `access_token`, `password`, `authorization`. `hashIdentifier(raw)` 는 sha256 앞 12자로 ODNO/계좌 식별자를 익명화합니다.

### teeLoggers

```ts
const eventLogger = teeLoggers(dbLogger, fileLogger);
// 동일 entry 를 DB + 파일에 순차 기록. 각 sink 실패는 자기 내부에서 swallow.
```

### 테스트 방법

- [src/main/logging/event-logger.test.ts](../../src/main/logging/event-logger.test.ts) — maskPayload 재귀 / hashIdentifier 결정성 / DB 쓰기 실패 시 fallback console / teeLoggers 병렬 호출.

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| payload 배열 내부에 `{ token: 'abc...' }` | 재귀 마스킹 적용 |
| payload 가 Date 객체 | 그대로 전달 (JSON.stringify 가 ISO string 으로 변환) |
| DB insert 실패 (migrate 직후 락) | `console.error` fallback, throw 안 함 |
| `secretKeys` 오버라이드 | 기본 키 무시, 제공된 키만 마스킹 |

## 2. 파일 로테이션 (NM-008)

[src/main/logging/file-logger.ts](../../src/main/logging/file-logger.ts)

### 파일 구조

```
userData/logs/
├── 2026-04-17.log
├── 2026-04-18.log
└── ...
```

- 파일명 `YYYY-MM-DD.log`, append 모드.
- dev 에서는 `projectRoot/logs/dev/` 를 사용해 userData 를 오염시키지 않음 (main/index.ts 참조).

### 로테이션

```ts
rotateOldLogs(dir, retentionDays=40, nowMs)
```

순수 함수. retention 경과 파일 삭제 + 남은 파일 절대경로 정렬 반환. idempotent.

앱 부팅 시 1회 실행: `fileLogger.rotate()` in [main/index.ts](../../src/main/index.ts).

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 디렉토리 없음 | `existsSync` false → `mkdirSync(recursive)` 후 빈 상태로 시작 |
| 파일명이 패턴 불일치 (`2026-04.log`) | 무시 (삭제 대상 아님) |
| 경계일 (`retentionDays=40`, 정확히 40일 전) | cutoff `< fileDayMs` 이므로 경계일 파일 **보존** |
| `retentionDays <= 0` | 삭제 skip, 전체 파일 반환 |
| append 실패 (디스크 풀) | swallow — logger 는 throw 안 함 |

### 테스트 방법

[src/main/logging/file-logger.test.ts](../../src/main/logging/file-logger.test.ts) 8 cases — rotate 경계일/패턴 필터/idempotent/미존재 디렉토리/append/rotate 여러 번/summary/swallow.

## 3. Sentry (opt-in, NM-007)

[src/main/monitoring/sentry.ts](../../src/main/monitoring/sentry.ts) + [monitoring-router.ts](../../src/main/trpc/routers/monitoring-router.ts)

### 설정

| 키 | 의미 | 기본 |
| --- | --- | --- |
| `sentry.dsn` | Sentry DSN (URL) | 미설정 = 비활성 |
| `sentry.enableInDev` | `'true'` 면 dev 에서도 활성 | 미설정 = dev 비활성 |

tRPC: `monitoring.getDsn` / `setDsn({ dsn })` / `clearDsn` / `setEnableInDev({ enabled })`.

DSN 입력은 `max(500)` + refine (빈 문자열 또는 `http(s)://` URL). 빈 문자열은 delete 와 동일.

### 초기화 규칙

[main/index.ts](../../src/main/index.ts) `app.whenReady` 진입 직후:

```ts
const result = await initSentryFromSettings({ settingsRepo, isPackaged });
// result: { active:true, dsn, environment } | { active:false, reason:'no_dsn'|'dev_disabled' }
```

- DSN 없음 → `no_dsn` (no-op).
- `!isPackaged` + `enableInDev !== 'true'` → `dev_disabled`.
- 활성 시 `@sentry/electron/main` dynamic import → `Sentry.init({ dsn, environment: 'production'|'development', beforeSend: scrubSentryEvent })`.
- dynamic import 실패 → `active:false, reason:'no_dsn'` (safety: 테스트/headless 환경에서 electron 미가동 시 안전).

### scrubSentryEvent

`event.extra / request / user / contexts / tags` 전부 `maskPayload` 재귀 스크러빙 → 토큰/키 누출 방지.

### 테스트 방법

[src/main/monitoring/sentry.test.ts](../../src/main/monitoring/sentry.test.ts) 8 cases — scrub (extra/user/contexts/tags 재귀) / init (DSN 없음 / isPackaged=true / dev 비활성 / dev opt-in / beforeSend 훅 실제 호출).

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| DSN 후에 clear | `sentry.dsn.updated (cleared:true)` 로그 후 다음 시작에 비활성 |
| DSN 정상 URL | packaged 에서만 자동 활성화 (dev 는 opt-in 필요) |
| event.extra = undefined | 그대로 유지 (null check) |
| `@sentry/electron` 모듈 미존재 | import 실패 → `no_dsn` 반환, 앱은 계속 부팅 |

## 4. 일일 리포트 + CSV Export (NM-009)

### 계산

[src/main/reporting/daily-report.ts](../../src/main/reporting/daily-report.ts):

```ts
computeDailyReport(db, { from, to }) => DailyReportSummary
```

`DailyReportSummary`:

| 필드 | 의미 |
| --- | --- |
| `totalTrades` | `trades` 테이블 `executedAt` between 에 해당하는 체결 수 |
| `soldLots` | `lots.status='SOLD'` + `soldAt` between |
| `realizedPnlKrw` | Σ `(sellPrice - buyPrice) * qty` |
| `winRate` | winners / soldLots (0~1) |
| `avgHoldingDays` | `(soldAt - boughtAt) / 86400000` 평균 |
| `maxDrawdownKrw` | 시간순 누적손익 peak→trough 최대 낙폭 |

계산 부분은 [`computeDailyReportFromLots`](../../src/main/reporting/daily-report.ts) 로 분리되어 **순수 함수** — DB 의존 없이 테스트 가능.

### CSV Export

- `exportTradesCsv(db, range)` — 체결 내역 (executedAt / pdno / side / qty / price / orderId)
- `exportLotsCsv(db, range)` — 차수별 전체 (matched on `boughtAt`)
- `exportEventsCsv(db, { from, to, level?, category? })` — 로그 필터

공용: [src/shared/reporting/csv.ts](../../src/shared/reporting/csv.ts) `toCsv(rows, columns, { bom, eol })` — RFC 4180 (콤마/따옴표/줄바꿈 이스케이프), 엑셀 한글 호환용 `\uFEFF` BOM 옵션.

### tRPC

```ts
// 요약
const summary = await trpc.reports.getSummary.query({ from, to });

// CSV
const { csv } = await trpc.reports.exportCsv.query({
  kind: 'trades',  // 'trades' | 'lots' | 'events'
  from, to,
  level: 'ERROR',         // kind='events' 일 때만 허용
  category: 'ORDER',      // kind='events' 일 때만 허용
});
```

라우터 Zod discriminated union 으로 kind 별 허용 필드 구분 ([reports-router.ts](../../src/main/trpc/routers/reports-router.ts)).

### UI — 리포트 페이지

[src/renderer/src/pages/reports/ui/reports-page.tsx](../../src/renderer/src/pages/reports/ui/reports-page.tsx):

- 기간 `<input type="date">` from/to
- KPI 카드 6종 (전체 체결/매도 차수/실현손익/승률/평균보유일/최대 drawdown)
- CSV 다운로드: `Blob` URL 생성 후 `<a download>` 트리거

### 테스트 방법

- [src/shared/reporting/csv.test.ts](../../src/shared/reporting/csv.test.ts) 6 cases — 이스케이프 (콤마/따옴표/줄바꿈/숫자 유지/Date ISO/BOM)
- [src/main/reporting/daily-report.test.ts](../../src/main/reporting/daily-report.test.ts) 8 cases — 빈 기간/단일 거래/다중 거래 drawdown/winRate 경계/CSV export 3종.

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| `from > to` | `reports.getSummary` / `exportCsv` 모두 `BAD_REQUEST` |
| 기간 내 체결 0건 | 모든 KPI 0, drawdown 0 |
| CSV 에 한글 + 콤마 + 줄바꿈 혼재 | RFC 4180 이스케이프 + BOM 으로 엑셀에서 정상 렌더 |
| `lots.sellPrice` null 인 SOLD (데이터 이상) | realizedPnl 에서 제외 (`null` 필터) |

## 5. 백업/복원 (NM-012)

[src/main/backup/backup.ts](../../src/main/backup/backup.ts)

### 내보내기

```ts
const { path, sha256, bytes } = exportDatabase(srcPath, destPath, logger);
```

- `fs.copyFileSync` + sha256 해시 + `SYS / backup.exported (INFO)` 로그 (sha256 앞 12자).
- tRPC: `backup.exportDatabase` — `dialog.showSaveDialog` 로 사용자 경로 선택, 소스는 `userData/split-stock.db`.

### 가져오기

```ts
const { backupBeforeRestore, sha256 } = importDatabase({
  srcPath,
  userDataPath,
  settingsRepo,
  logger,
});
```

1. 기존 DB 를 `split-stock.backup-before-restore-{ISO}.db` 로 rename (롤백 대비).
2. `srcPath` 를 `userData/split-stock.db` 로 복사.
3. `userData/split-stock.import-manifest.json` 작성 (importedAt/sourcePath/sha256/backupBeforeRestore).
4. settings `backup.importedFlag='true'` + `backup.lastImportAt=nowMs`.
5. `SYS / backup.imported (WARN)` 로그.

tRPC: `backup.importDatabase` → `dialog.showOpenDialog` → `importDatabase` → 반환에 `restartRequired: true`. 렌더러는 `backup.restartApp` 호출 권장 (better-sqlite3 핸들 무효화).

### 재입력 안내 배너

```ts
needsCredentialsReentry(settingsRepo) // importedFlag==='true'
clearImportedFlag(settingsRepo, logger) // auth.setCredentials 성공 시 자동 호출
```

UI: [CredentialsReentryBanner](../../src/renderer/src/features/backup-restore/ui/credentials-reentry-banner.tsx) — 5초 polling, "배너 숨김" 버튼으로 수동 해제 가능.

### 보안 불변식 (재강조)

- `credentials` BLOB 은 `safeStorage` 가 **OS 사용자 키**로 암호화. 다른 머신 / 계정으로 가져온 DB 는 복호화 불가.
- 그래서 복원 직후엔 배너가 뜨고 사용자가 App Key/Secret 을 재저장해야 합니다.

### 테스트 방법

[src/main/backup/backup.test.ts](../../src/main/backup/backup.test.ts) 7 cases:

- export 해시 결정성 (같은 파일 두 번 해시 동일)
- export 소스 없음 → throw
- import 가 기존 DB 를 backup-before-restore 로 rename
- manifest JSON 생성
- importedFlag 토글 (`needsCredentialsReentry` true → auth.setCredentials 후 false)
- source 파일 누락 → throw
- 기존 DB 없는 깨끗한 userData 에서도 import 성공

### 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 다이얼로그 취소 | `backupRouter` 가 `{ canceled: true }` 반환 — 파일 시스템 변경 없음 |
| 복원 전 기존 DB 없음 | rename 스킵, `copyFile` 만 수행 |
| 복원 후 앱 미재시작 | better-sqlite3 핸들이 오래된 파일을 쥐고 있음 → 쿼리 결과 이상 가능. `backup.restartApp` 로 해결 |
| credentials BLOB 복호화 실패 | `CredentialsRepoError.DECRYPT_FAILED` → 배너는 이미 켜져 있으므로 사용자가 재입력 |
| 동시 import 2회 | 두 번째 import 의 `backup-before-restore` 파일이 첫 번째의 결과를 덮어쓸 수 있음 → 파일명에 ISO 타임스탬프가 있어 사실상 충돌 낮음. 실제 동시 호출은 tRPC 가 main 단일 스레드이므로 순차 실행 |
