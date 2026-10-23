import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4183', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('4183') && r()));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:4183/'); // 默认“正常”速度（2–3 秒）
await p.getByTestId('quick').click();
const t0 = Date.now();
let done = false;
while (!done && Date.now() - t0 < 120000) {
  const call = p.getByTestId('call'), check = p.getByTestId('check');
  if (await call.isVisible().catch(() => false)) await call.click().catch(() => {});
  else if (await check.isVisible().catch(() => false)) await check.click().catch(() => {});
  const th = await p.getByTestId('thinking').count();
  const bub = await p.getByTestId('bubble').count();
  if (th === 1 && bub >= 3) { await p.waitForTimeout(700); if (await p.getByTestId('thinking').count()) { await p.screenshot({ path: 'screenshot-bubbles.png' }); done = true; console.log('截图 OK：思考中 1，气泡', await p.getByTestId('bubble').count()); } }
  await p.waitForTimeout(300);
}
// 测量一次 AI 思考时长
const s = Date.now(); await p.getByTestId('thinking').waitFor({ timeout: 20000 }); const s2 = Date.now();
await p.getByTestId('thinking').waitFor({ state: 'detached', timeout: 20000 });
console.log('AI 思考时长约', ((Date.now() - s2) / 1000).toFixed(1), 's（检测起点后）');
if (errs.length) console.log('ERR', errs);
await b.close(); srv.kill(); process.exit(0);
