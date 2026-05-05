# E2E (Playwright + Electron)

`_electron.launch()` 정식 API 기반 시각/UX 검증.

## 빠른 시작

```bash
# 1. 산출물 빌드 — main(./out/main/index.cjs) + renderer 모두 필요
pnpm build

# 2. 전체 e2e
pnpm test:e2e

# 3. 단일 spec
pnpm test:e2e e2e/main-page.spec.ts

# 4. 특정 테스트만
pnpm test:e2e -g "메인 페이지 부팅"
```

## 헬퍼

[`electron-helpers.ts`](./electron-helpers.ts) — `launchElectron()` 으로 부팅 + 스크린샷.

```ts
import { launchElectron } from './electron-helpers';

test('샘플', async () => {
  const session = await launchElectron({ specName: 'my-spec' });
  try {
    await session.screenshot('boot');
    await session.win.locator('[data-testid="something"]').click();
    await session.screenshot('after-click');
  } finally {
    await session.close();
  }
});
```

### 스크린샷 위치

`playwright-report/screenshots/{specName}/{label}.png` 에 저장 (gitignore 됨).

## 디버깅

### Headless toggle

Electron `_electron.launch()` 는 기본적으로 헤드 보이는 모드. 환경 변수로 제어:

```bash
# 백그라운드(no UI)
DISPLAY= pnpm test:e2e

# 디버그 (Playwright Inspector)
PWDEBUG=1 pnpm test:e2e
```

### 콘솔 로그

```ts
session.win.on('console', (msg) => console.log('[renderer]', msg.text()));
session.app.on('console', (msg) => console.log('[main]', msg.text()));
```

### CDP (필요 시)

기본 `_electron.launch()` 는 CDP 자동 연결. 별도 port 노출 불필요.

## 회귀 검증 패턴

Q1/Q2 매매내역 panel 변경 시 stock/crypto 양쪽 screenshot 비교:

```ts
test('stock 매매내역 5탭', async () => {
  const session = await launchElectron({ specName: 'stock-trade-history' });
  // ... 종목 선택, 탭 전환
  await session.screenshot('strategy-tab');
  await session.screenshot('all-tab');
  await session.close();
});
```
