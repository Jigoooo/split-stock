# 인증 · 자격증명 · 환경 전환

US-005 / US-006 / NM-002. KIS Developers API 사용을 위한 App Key/Secret 저장, OAuth 토큰 발급/캐시, 모의(MOCK) ↔ 실전(PROD) 환경 전환 전반을 담당합니다.

상위 인덱스: [../README.md](../README.md)

## 1. 자격증명 저장 (US-005)

### 사용 방법 (UI)

1. 앱을 실행하면 [로그인 페이지](../../src/renderer/src/pages/login/ui/login-page.tsx)가 뜹니다.
2. [CredentialsForm](../../src/renderer/src/features/save-credentials/ui/credentials-form.tsx) 에 다음을 입력합니다.
   - 환경 (MOCK / PROD 라디오)
   - App Key / App Secret (KIS Developers에서 발급)
   - 계좌번호 앞 8자리 (`CANO`)
   - 상품코드 뒤 2자리 (`ACNT_PRDT_CD`, 기본 `01`)
3. `저장하고 접속` 버튼을 누르면 `trpc.auth.setCredentials` 변이가 호출됩니다.
4. 저장은 `safeStorage.encryptString` 으로 OS 사용자 키에 종속된 BLOB으로 DB `credentials` 테이블에 기록됩니다.

### 사용 방법 (코드)

tRPC 라우터: [src/main/trpc/routers/auth-router.ts](../../src/main/trpc/routers/auth-router.ts)

```ts
// 저장
await trpc.auth.setCredentials.mutate({
  env: 'MOCK',
  appKey: '...',
  appSecret: '...',
  accountNo8: '12345678',
  accountProdCd: '01',
});

// 저장된 env 목록 (마스킹된 account 뒷 4자리)
const { entries } = await trpc.auth.listStored.query();

// 특정 env 삭제
await trpc.auth.clearCredentials.mutate({ env: 'MOCK' });
```

코어 구현: [CredentialsRepo](../../src/main/security/credentials-repo.ts)
- `saveCredentials(value)` — `CredentialsSchema.safeParse` → `safeStorage.encryptString(JSON.stringify(...))` → SQLite BLOB upsert
- `loadCredentials(env)` — `safeStorage.decryptString` 후 JSON → Zod 검증
- `clearCredentials(env)` — 해당 env 행 삭제
- 모든 함수는 `Result<T, CredentialsRepoError>` (neverthrow) 반환

### 인증 필요 여부

- `setCredentials` / `listStored` / `clearCredentials` 는 `publicProcedure`. 최초 로그인은 인증 상태가 없어도 호출해야 하므로 공개.
- 단, 저장 동작 자체가 safeStorage 접근을 요구하므로 main 프로세스 OS 사용자 컨텍스트가 필요합니다.

### 테스트 방법

- 단위 테스트: [src/main/security/credentials-repo.test.ts](../../src/main/security/credentials-repo.test.ts) — `SafeStorageLike` mock을 주입하여 DB 라운드트립/암호화 불가/스키마 실패 케이스 검증.
- 민감 값 마스킹: [src/main/security/mask-secret.test.ts](../../src/main/security/mask-secret.test.ts) — 8자 미만은 전체 `*`, 그 외 마지막 4자만 노출.
- 수동: `pnpm dev` 실행 후 실제 KIS 모의투자 키를 입력해 "저장하고 접속 → 대시보드 잔고 조회"까지 성공하는지 확인.

### 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| `safeStorage.isEncryptionAvailable() === false` | `ENCRYPTION_UNAVAILABLE` 에러 반환, DB에 쓰지 않음. 리눅스 키링 미설치 환경에서 발생. |
| App Key 10자 미만 | `CredentialsSchema` Zod 실패 → `VALIDATION` 에러 |
| 계좌번호에 숫자 외 문자 | `\d{8}` 정규식 실패 → `VALIDATION`. 입력 UI는 `replace(/\D/g, '')` 로 사전 필터링. |
| 이미 같은 env 존재 | upsert (업데이트). `accountProdCd`/`appKey` 변경 반영. |
| 복호화 실패 (다른 OS 사용자에서 가져온 DB) | `DECRYPT_FAILED` — [observability.md](./observability.md) 백업/복원 배너가 재입력 안내 |
| 평문 보존 금지 | 로그에 남길 때는 `maskSecret(value)` 또는 `maskPayload(obj, DEFAULT_SECRET_KEYS)` 경유. `event-logger` 가 기본 스크러빙. |

## 2. OAuth 토큰 발급 / 캐시 / 갱신 (US-006)

### 사용 방법 (코드)

엔진: [AuthService](../../src/main/kis/auth.ts)

```ts
const auth = new AuthService(httpByEnv, tokenStore);
const r = await auth.getValidToken('MOCK', appKey, appSecret);
if (r.isOk()) {
  const { token, expiresAt } = r.value;
}
```

### 동작 규약

1. `TokenStore.load(env)` 로 캐시 조회.
2. 만료까지 **여유가 6시간 초과**면 캐시 반환. 그 이하/없음이면 `/oauth2/tokenP` 호출.
3. `KisTokenResponseSchema.safeParse` → 성공 시 `{ token, tokenType, issuedAt, expiresAt }` 산출.
4. `TokenStore.save(env, ...)` 로 DB upsert.
5. 네트워크/레이트리밋 실패는 500ms × 2^attempt 지수백오프로 최대 `maxRetries` (기본 3) 재시도. 그 외 에러(401 등)는 즉시 반환.

### 인증 필요 여부

- `auth.getValidToken` 자체는 App Key/Secret 이 곧 "인증 재료". 저장된 자격증명이 있어야 호출 가능.
- tRPC 의 `authedProcedure` 는 `ctx.currentEnv` 가 세팅된 상태를 요구합니다(아래 환경 전환 참조).

### 테스트 방법

- [src/main/kis/auth.test.ts](../../src/main/kis/auth.test.ts) — `undici MockAgent` 로 다음 커버:
  - 토큰 발급 성공 → 두 번째 호출 캐시 히트
  - 만료 여유 2시간 → 재발급
  - 500 × 3회 실패 → `NETWORK` 에러
  - 401 → 재시도 없이 `AUTH_FAILED`
  - 응답 스키마 누락 → `VALIDATION`
  - `TokenStore.isReusable` 기준 6h 경계

### 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 만료 6h 이내 (예: 2h 남음) | 재사용 불가 판정 → 재발급 | 
| 재발급 1분 1회 KIS 제한 | 서버가 `RATE_LIMITED` 로 응답하면 지수백오프로 대기 후 재시도 |
| 응답 스키마 변경 (`expires_in` 누락) | `VALIDATION` 에러 — 즉시 중단, 재시도 없음 |
| **PROD/MOCK 서버 URL 혼선 (이전 버전 버그)** | 본 문서화 세션에서 수정. `httpByEnv.MOCK` / `httpByEnv.PROD` 두 인스턴스를 모두 주입받아 `issueOnce(env, ...)` 에서 env 에 해당하는 URL로 호출. |

## 3. 환경 전환 (MOCK ↔ PROD, NM-002)

### 사용 방법 (UI)

헤더의 `<select>` 드롭다운 (저장된 env 가 2개 이상일 때만 표시) 에서 대상 env 를 선택하면 [SwitchEnvDialog](../../src/renderer/src/features/switch-env/ui/switch-env-dialog.tsx) 가 열립니다.

- **MOCK 전환**: 1단계 — 단순 설명 + `전환` 버튼.
- **PROD 전환**: 2단계
  1. 빨간 `PROD` 배지 미리보기 + "돌이킬 수 없습니다" 경고 → `다음` 클릭.
  2. 체크박스 "실전 모드임을 이해했고 계속 진행하는 데 동의합니다" + **`실전전환` 문구 정확히 타이핑** → 둘 다 만족해야 `전환` 활성화.

전환 문구 상수: [`PROD_CONFIRM_PHRASE = '실전전환'`](../../src/renderer/src/features/switch-env/model/constants.ts)

### 사용 방법 (코드)

```ts
await trpc.auth.setEnv.mutate('PROD');
// 성공 시:
//  - settings.last_active_env = 'PROD' 저장 (재시작 후 복원)
//  - event_logs 에 AUTH/env.switch-to-prod (WARN) 또는 env.switch-to-mock (INFO) 기록
```

### 인증 필요 여부

- `setEnv` 는 해당 env 의 credentials 가 DB에 저장되어 있어야 성공. 없으면 `PRECONDITION_FAILED`.
- 자동 복원: 앱 시작 시 [main/index.ts](../../src/main/index.ts) 에서 `SETTING_KEYS.LAST_ACTIVE_ENV` 읽고 해당 env credentials 가 남아 있으면 `factory.setEnv(...)` 로 세팅.

### 테스트 방법

- [src/renderer/src/features/switch-env/ui/switch-env-dialog.test.tsx](../../src/renderer/src/features/switch-env/ui/switch-env-dialog.test.tsx):
  - MOCK 1단계 확인 → 즉시 `전환` 가능
  - PROD 1단계 → 체크 없이 2단계 진입
  - PROD 2단계: 체크박스 ON + 문구 `실전전환` 정확히 일치해야 `전환` 활성
  - 다이얼로그 닫히면 step/ack/phrase 모두 초기화
- 수동: `pnpm dev` 에서 MOCK/PROD 양쪽 credentials 저장 후 헤더 셀렉트로 전환 → `event_logs` 에 `env.switch-to-prod(WARN)` 기록 확인 (로그 탭).

### 의도된 엣지 케이스

| 케이스 | 기대 동작 |
| --- | --- |
| 타이핑 오타 (`실저너환`, 영문 `silecho`) | `전환` 버튼 비활성 |
| 체크박스만 ON, 타이핑 공백 | `전환` 버튼 비활성 |
| 다이얼로그 취소 / 재오픈 | 내부 state(`step`/`ack`/`phrase`) 리셋 |
| 저장된 PROD credentials 없음 | `setEnv` 가 `PRECONDITION_FAILED` 반환, 에러는 React Query 에러로 노출 |
| 킬 스위치가 이미 ON인 상태 | 환경 전환 자체는 가능하지만 실제 주문 시도는 `SafetyState.canTrade` 에서 차단 — [safety.md](./safety.md) |

## 4. 로그아웃

- `trpc.auth.logout.mutate({ clearStored: false })` — 현재 env 비활성화만. 자격증명은 보존되어 다음에 `setEnv` 만으로 복귀.
- `trpc.auth.logout.mutate({ clearStored: true })` — 해당 env 의 credentials DB 삭제.

## 5. 보안 불변식 요약

- App Key/Secret/Access Token 은 **항상 암호화** 후 저장. 평문 파일/stdout 금지.
- 로그 필드 `appKey`, `appSecret`, `token`, `access_token`, `password`, `authorization` 은 `event-logger` / `file-logger` 공용 [`maskPayload`](../../src/main/logging/event-logger.ts) 가 자동 스크러빙.
- 주문 호출은 오직 main 프로세스에서만 가능 — renderer 에서는 tRPC 경유 요청만.
- PROD 전환은 2단계 다이얼로그 + 타이핑 검증 필수.
