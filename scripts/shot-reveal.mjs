import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4182', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('4182') && r()));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:4182/?fast=1');
await p.getByText('每手结束后显示所有人手牌').click();
await p.getByText('自动开始下一手').click(); // 关闭自动下一手，便于截图
await p.getByTestId('quick').click();
for (let hand = 0; hand < 10; hand++) {
  for (let i = 0; i < 200 && !(await p.getByTestId('result').isVisible().catch(() => false)); i++) {
    for (const id of ['check', 'call']) { const el = p.getByTestId(id); if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); break; } }
    await p.waitForTimeout(250);
  }
  const folded = await p.locator('[title="已弃牌"]').count();
  if (folded >= 2) { await p.screenshot({ path: 'screenshot-reveal.png' }); console.log('截图 OK，已弃牌但公开的座位：', folded); break; }
  await p.getByTestId('next').click();
}
if (errs.length) console.log('ERR', errs);
await b.close(); srv.kill(); process.exit(0);
