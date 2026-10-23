// 联机 E2E：房主 + 2 位客人，三个独立浏览器上下文（互不共享 localStorage）
// 信令：公共 PeerJS 可达则用公共；否则（或 PEER=local）启动本地 peerjs-server。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const HANDS = Number(process.env.HANDS ?? 50);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const procs = [];
const startProc = (args, ready) => new Promise((ok, bad) => {
  const p = spawn('node', args, { stdio: 'pipe' }); procs.push(p);
  const on = (d) => { if (String(d).match(ready)) ok(p); };
  p.stdout.on('data', on); p.stderr.on('data', on);
  p.on('exit', (c) => bad(new Error('exit ' + c)));
});
await startProc(['node_modules/vite/bin/vite.js', 'preview', '--port', '4180', '--strictPort'], /4180/);

let peerParam = '';
let mode = process.env.PEER ?? 'auto';
if (mode === 'auto') {
  try { const r = await fetch('https://0.peerjs.com/peerjs/id', { signal: AbortSignal.timeout(5000) }); mode = r.ok ? 'public' : 'local'; } catch { mode = 'local'; }
}
if (mode === 'local') {
  await startProc(['node_modules/peer/dist/bin/peerjs.js', '--port', '9000'], /Started|9000/);
  peerParam = '&peer=localhost:9000/';
}
log('信令服务器：', mode === 'local' ? '本地 peerjs-server :9000' : '公共 0.peerjs.com');
// 本机浏览器受策略限制（WebRtcIPHandling=仅公网接口，且无 UDP 出网），用本地 TURN 中继提供候选；
// 真实部署中 TURN 为可选项，由“网络设置”或 VITE_TURN_* 配置。
if (process.env.TURN !== '0') { await startProc(['scripts/turn.cjs', '3478'], /TURN listening/); peerParam += '&turn=' + encodeURIComponent('turn:127.0.0.1:3478') + '&turnUser=holdem&turnPass=holdem'; }
const base = `http://localhost:4180/?fast=1&timeout=4&hostWait=8000${peerParam}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
// 自动玩：轮到自己时 过牌/跟注；能重买就重买（走真实 UI 按钮）
const AUTOPLAY = () => {
  setInterval(() => {
    if (window.__noauto) return;
    const b = (id) => document.querySelector(`[data-testid=${id}]`);
    for (const id of ['check', 'call', 'rebuy']) { const el = b(id); if (el && !el.disabled) { el.click(); break; } }
  }, 120 + Math.random() * 120);
};
async function ctx(name) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await c.addInitScript(AUTOPLAY);
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  return { c, p };
}
const handNo = async (p) => Number((await p.getByTestId('handno').innerText().catch(() => '0')).replace(/\D/g, '') || 0);
const t0 = Date.now();
try {
  const H = await ctx('host'), A = await ctx('guestA'), B = await ctx('guestB');
  await H.p.goto(base);
  await H.p.getByTestId('online').click();
  await H.p.getByTestId('name').fill('房主');
  await H.p.locator('input[type=number]').first().fill('4'); // 3 人类 + 1 AI
  await H.p.getByTestId('create').click();
  const code = (await H.p.getByTestId('roomcode').innerText({ timeout: 20000 })).trim();
  log('房间码', code);
  for (const [G, n] of [[A, '小A'], [B, '小B']]) {
    await G.p.goto(`${base}&room=${code}`);
    await G.p.getByTestId('name').fill(n);
    await G.p.getByTestId('join').click();
  }
  await H.p.waitForFunction(() => document.querySelectorAll('[data-testid=lobby-seat]').length === 3, null, { timeout: 30000 });
  log('3 人已入座，开局');
  await H.p.getByTestId('startroom').click();
  for (const G of [A, B]) await G.p.getByTestId('handno').waitFor({ timeout: 15000 });

  // 连续 50 手
  let last = 0, shot = false;
  while ((last = await handNo(H.p)) <= HANDS) {
    if (!shot && last >= 3 && (await H.p.locator('[data-testid=board] > div').count()) > 0) {
      // 截图：选一位客人视角，等待公共牌出现
      const hasBoard = await A.p.evaluate(() => [...document.querySelectorAll('[data-testid=board] [aria-label]')].length >= 3);
      if (hasBoard) { await A.p.screenshot({ path: 'screenshot-online.png' }); shot = true; log('已截图 screenshot-online.png'); }
    }
    if (Date.now() - t0 > 15 * 60000) throw new Error('超时：只打到第 ' + last + ' 手');
    await H.p.waitForTimeout(1000);
    if (last % 10 === 0) log('第', last, '手');
  }
  if (!shot) await A.p.screenshot({ path: 'screenshot-online.png' });
  const [ha, hb] = [await handNo(A.p), await handNo(B.p)];
  log(`完成 ${HANDS} 手：房主第 ${last} 手，客人 A 第 ${ha} 手，客人 B 第 ${hb} 手`);
  if (Math.abs(ha - last) > 1 || Math.abs(hb - last) > 1) throw new Error('客人与房主不同步');
  if (await A.p.getByTestId('banner').isVisible().catch(() => false)) throw new Error('出现断线提示');

  // 客人 B 断线：座位保留、超时照常推进
  await B.p.close();
  log('客人 B 关闭页面');
  await H.p.waitForFunction(() => document.body.innerText.includes('离线'), null, { timeout: 20000 });
  const before = await handNo(H.p);
  await H.p.waitForFunction((n) => Number(document.querySelector('[data-testid=handno]').innerText.replace(/\D/g, '')) >= n + 2, before, { timeout: 90000 });
  log('B 离线期间牌局继续：', before, '→', await handNo(H.p));
  // B 重连（同一浏览器上下文 → 同一 localStorage 凭证）
  B.p = await B.c.newPage();
  B.p.on('pageerror', (e) => errors.push(`guestB2: ${e}`));
  await B.p.goto(`${base}&room=${code}`);
  await B.p.getByTestId('join').click();
  await B.p.getByTestId('handno').waitFor({ timeout: 30000 });
  await H.p.waitForFunction(() => !document.body.innerText.includes('离线'), null, { timeout: 20000 });
  const myCards = await B.p.locator('[data-testid^=seat-]').evaluateAll((els) => els.map((e) => e.querySelectorAll('[aria-label]:not([aria-label="背面"])').length));
  log('B 重连成功，拿到新快照；各座位可见正面牌数：', JSON.stringify(myCards));

  // 房主离开：客人先显示重连中，hostWait(8s) 后提示房间关闭
  await H.p.close();
  log('房主关闭页面');
  await A.p.getByTestId('banner').waitFor({ timeout: 20000 });
  log('客人 A 提示：', await A.p.getByTestId('banner').innerText());
  await A.p.getByTestId('closed').waitFor({ timeout: 30000 });
  const closed = await A.p.getByTestId('closed').innerText();
  log('客人 A：', closed);
  if (closed !== '房主已离线，房间关闭') throw new Error('关闭提示不符');
  if (errors.length) throw new Error('页面错误：' + errors.join(' | '));
  log(`联机 E2E 通过，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} finally {
  await browser.close();
  procs.forEach((p) => p.kill());
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
