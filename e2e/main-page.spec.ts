import { expect, test } from '@playwright/test';
import { launchElectron } from './electron-helpers';

/**
 * 메인 페이지 부팅 시각 검증 — Q-DEBUG 의 정식 셋업 검증 spec.
 *
 * 빠른 길 (CDP port 노출) 회피 — `_electron.launch()` 정식 API + screenshot 헬퍼 사용.
 */

test('메인 페이지 부팅 — 헤더 노출 + 스크린샷', async () => {
  const session = await launchElectron({ specName: 'main-page' });
  try {
    await expect(session.win.locator('.app-header h1')).toHaveText('split-stock');
    await session.screenshot('boot');
  } finally {
    await session.close();
  }
});
