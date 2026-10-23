// 单文件版冒烟：file:// 打开 holdem-play.html，打一手单机；再试联机（房主+客人）
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const FILE = 'file://' + (process.env.FILE || '/workspace/holdem-play.html');
const turn = spawn('node', ['scripts/turn.cjs', '3478'], { stdio: 'ignore' });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const problems = [];
const watch = (p, n) => { p.on('pageerror', (e) => problems.push(`${n} pageerror: ${e}`)); p.on('console', (m) => { if (m.type() === 'error') problems.push(`${n} console: ${m.text()}`); }); };
try {
  const c = await b.newContext({ viewport: { width: 1440, height: 860 } });
  const p = await c.newPage(); watch(p, 'single');
  await p.goto(FILE + '?fast=1');
  await p.getByTestId('quick').click();
  for (let i = 0; i < 150 && !(await p.getByTestId('result').isVisible().catch(() => false)); i++) {
    for (const id of ['check', 'call']) { const el = p.getByTestId(id); if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); break; } }
    await p.waitForTimeout(300);
  }
  await p.getByTestId('result').waitFor({ timeout: 20000 });
  await p.reload(); await p.getByTestId('board').waitFor({ timeout: 5000 });
  console.log('单机：打完一手 + 刷新恢复 OK');
  // 联机（本机需本地 TURN，见 README）
  const q = '?fast=1&turn=' + encodeURIComponent('turn:127.0.0.1:3478') + '&turnUser=holdem&turnPass=holdem';
  const H = await (await b.newContext()).newPage(); watch(H, 'host');
  const G = await (await b.newContext()).newPage(); watch(G, 'guest');
  await H.goto(FILE + q); await H.getByTestId('online').click(); await H.getByTestId('create').click();
  const code = (await H.getByTestId('roomcode').innerText({ timeout: 20000 })).trim();
  await G.goto(FILE + q + '&room=' + code); await G.getByTestId('join').click();
  await H.waitForFunction(() => document.querySelectorAll('[data-testid=lobby-seat]').length === 2, null, { timeout: 30000 });
  await H.getByTestId('startroom').click();
  await G.getByTestId('handno').waitFor({ timeout: 15000 });
  console.log('联机（file://）：房间', code, '创建/加入/开局 OK');
  const real = problems.filter((x) => !/Failed to load resource.*404/.test(x));
  if (real.length) throw new Error(real.join('\n'));
  console.log('无控制台错误');
} finally { await b.close(); turn.kill(); setTimeout(() => process.exit(process.exitCode ?? 0), 100); }
