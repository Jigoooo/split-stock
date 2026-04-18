import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('앱 부팅 + 킬 스위치 단축키로 master OFF', async () => {
  const mainEntry = resolve(process.cwd(), 'out/main/index.cjs');
  const app = await electron.launch({ args: [mainEntry] });
  const win = await app.firstWindow();
  await expect(win.locator('.app-header h1')).toHaveText('split-stock');

  await win.keyboard.press('ControlOrMeta+Shift+K');

  await win.waitForTimeout(2500);
  await app.close();
});
