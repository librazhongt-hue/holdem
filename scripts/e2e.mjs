// 无头冒烟：npm run build 后执行。用 vite preview 起服务，系统 Chrome 驱动。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4179', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('4179') && r()));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://localhost:4179/?fast=1');
  await page.getByTestId('quick').click();
  await page.getByTestId('board').waitFor();
  // 打完一手：轮到我时 跟注/过牌，直到出现结算
  for (let i = 0; i < 120; i++) {
    if (await page.getByTestId('result').isVisible().catch(() => false)) break;
    for (const id of ['check', 'call']) {
      const b = page.getByTestId(id);
      if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
    }
    await page.waitForTimeout(400);
  }
  await page.getByTestId('result').waitFor({ timeout: 20000 });
  await page.screenshot({ path: 'screenshot-result.png' });
  // 等自动下一手并截取进行中的牌桌
  if (await page.getByTestId('rebuy').isEnabled()) await page.getByTestId('rebuy').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=result]'), null, { timeout: 8000 })
    .catch(() => page.getByTestId('next').click());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshot.png' });
  // 刷新恢复
  await page.reload();
  await page.getByTestId('board').waitFor({ timeout: 5000 });
  const hand = await page.locator('header').innerText();
  console.log('E2E OK, header after reload:', hand.replace(/\s+/g, ' '));
  if (errors.length) throw new Error('页面错误: ' + errors.join('; '));
} finally {
  await browser.close();
  srv.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 100);
}
