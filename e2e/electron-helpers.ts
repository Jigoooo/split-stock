import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test';

/**
 * Electron + Playwright 정식 헬퍼.
 *
 * 사용 예:
 * ```ts
 * test('샘플', async () => {
 *   await using session = await launchElectron();
 *   await session.screenshot('boot');
 *   await session.win.locator('[data-testid="x"]').click();
 *   await session.screenshot('after-click');
 * });
 * ```
 *
 * - 빠른 길 (CDP port 노출) 회피 — `_electron.launch()` 정식 API 사용.
 * - 빌드 산출물 `out/main/index.cjs` 를 main entry 로 부팅.
 * - screenshot 은 `playwright-report/screenshots/{specName}/{label}.png` 에 저장.
 */

export interface ElectronSession extends AsyncDisposable {
  app: ElectronApplication;
  win: Page;
  /**
   * 라벨링된 스크린샷 저장. `playwright-report/screenshots/{specName}/{label}.png`.
   */
  screenshot: (label: string) => Promise<string>;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  /** spec 별 screenshot 디렉터리 분리 — 기본값은 'default'. */
  specName?: string;
  /** 추가 launch args. */
  args?: string[];
  /** 환경 변수 — 디버깅용. */
  env?: Record<string, string>;
}

const DEFAULT_MAIN_ENTRY = resolve(process.cwd(), 'out/main/index.cjs');
const SCREENSHOT_ROOT = resolve(process.cwd(), 'playwright-report/screenshots');

/**
 * Electron 앱 부팅 + 첫 윈도우 반환.
 *
 * `await using` 패턴 권장 — Symbol.asyncDispose 로 자동 close.
 */
export async function launchElectron(options: LaunchOptions = {}): Promise<ElectronSession> {
  const specName = options.specName ?? 'default';
  const screenshotDir = resolve(SCREENSHOT_ROOT, specName);
  mkdirSync(screenshotDir, { recursive: true });

  // process.env 의 값은 string | undefined — Playwright 의 env 는 Record<string, string> 요구.
  // undefined 항목은 제외하고 병합.
  const mergedEnv: Record<string, string> | undefined =
    options.env !== undefined
      ? Object.fromEntries(
          [...Object.entries(process.env), ...Object.entries(options.env)].filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined;
  const app = await electron.launch({
    args: [DEFAULT_MAIN_ENTRY, ...(options.args ?? [])],
    ...(mergedEnv !== undefined ? { env: mergedEnv } : {}),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await app.close();
  };

  const screenshot = async (label: string): Promise<string> => {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    const path = resolve(screenshotDir, `${safeLabel}.png`);
    await win.screenshot({ path, fullPage: false });
    return path;
  };

  return {
    app,
    win,
    screenshot,
    close,
    [Symbol.asyncDispose]: close,
  };
}

/**
 * 활성 종목 셀렉터 click — 종목 row data-testid 또는 텍스트로 찾기.
 * Q1/Q2 매매내역 패널 시각 검증용.
 */
export async function selectSymbolByText(win: Page, label: string): Promise<void> {
  await win.getByText(label, { exact: false }).first().click();
}
