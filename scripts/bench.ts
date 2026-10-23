/**
 * AI 基准：npm run bench -- [deals=2000] [out=bench.json]
 * - bb/100 ± 95% CI；复式发牌（同一副牌左右交换座位）+ 按钮轮转降方差；以"一组复式发牌"为独立样本计算 CI
 * - 每手重置 100BB，避免筹码深度漂移
 * - 风格统计：VPIP / PFR / AF（翻后 (下注+加注)/跟注）/ 每 100 手重买次数（标准场 50BB 连续会话）
 */
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createGame, reduce, viewFor, makeRng, type GameState, type Difficulty, type PlayerConfig } from '../src/engine';
import { decide, PERSONALITIES } from '../src/ai/ai';

const STYLES = Object.keys(PERSONALITIES);
type Side = { diff: Difficulty };
interface Style { hands: number; vpip: number; pfr: number; bets: number; calls: number; folds: number; rebuys: number; decideMs: number; decisions: number; maxMs: number }
const newStyle = (): Style => ({ hands: 0, vpip: 0, pfr: 0, bets: 0, calls: 0, folds: 0, rebuys: 0, decideMs: 0, decisions: 0, maxMs: 0 });

function cfg(id: string, diff: Difficulty, style: string): PlayerConfig {
  const { label: _l, ...p } = PERSONALITIES[style];
  return { id, name: id, isBot: true, personality: p, difficulty: diff, style };
}

function playHand(g: GameState, button: number, rngSeed: number, styles: Record<string, Style>): GameState {
  g.button = (button - 1 + g.players.length) % g.players.length;
  g = reduce(g, { type: 'startHand' });
  const rng = makeRng(rngSeed);
  const vp = new Set<string>(), pf = new Set<string>();
  while (g.hand!.street !== 'complete') {
    const pl = g.players[g.hand!.toAct];
    const t = performance.now();
    const a = decide(viewFor(g, pl.id), { personality: pl.personality!, difficulty: pl.difficulty! }, rng);
    const ms = performance.now() - t;
    const st = styles[pl.style!];
    st.decideMs += ms; st.decisions++; st.maxMs = Math.max(st.maxMs, ms);
    const pre = g.hand!.street === 'preflop';
    const prevBet = g.hand!.currentBet;
    g = reduce(g, a);
    const last = g.hand!.log.filter((l) => l.playerId === pl.id && l.kind !== 'win' && l.kind !== 'refund').pop()!;
    const raised = (last.kind === 'bet' || last.kind === 'raise' || (last.kind === 'allin' && (last.amount ?? 0) > prevBet));
    if (pre) {
      if (last.kind !== 'fold' && last.kind !== 'check') vp.add(pl.id);
      if (raised) pf.add(pl.id);
    } else {
      if (raised) st.bets++;
      else if (last.kind === 'call' || last.kind === 'allin') st.calls++;
    }
    if (last.kind === 'fold') st.folds++;
  }
  g.players.forEach((p, i) => {
    if (!g.hand!.inHand[i]) return;
    const st = styles[p.style!]; st.hands++;
    if (vp.has(p.id)) st.vpip++;
    if (pf.has(p.id)) st.pfr++;
  });
  return g;
}

/** 一个对局：A/B 两方，n 座；返回 A 方每手平均 bb 的逐样本序列 */
function runMatch(dA: Difficulty, dB: Difficulty, n: number, deals: number, seed0: number) {
  const styles: Record<string, Style> = Object.fromEntries(STYLES.map((s) => [s, newStyle()]));
  const samples: number[] = [];
  for (let d = 0; d < deals; d++) {
    const seed = (seed0 * 7919 + d * 104729) >>> 0;
    let sumA = 0, handsA = 0;
    const button = d % n;
    for (let mirror = 0; mirror < 2; mirror++) {
      const players = Array.from({ length: n }, (_, i) => {
        const isA = (i % 2 === 0) !== (mirror === 1);
        const style = n === 2 ? STYLES[d % STYLES.length] : STYLES[(i + d) % STYLES.length]; // HU 两边同风格
        return { ...cfg('s' + i, isA ? dA : dB, style), name: isA ? 'A' : 'B' };
      });
      let g = createGame({ stakeId: 'b', sb: 10, bb: 20, startingStack: 2000, rebuy: true }, players, seed);
      g = playHand(g, button, seed ^ 0x5bd1e995, styles);
      g.players.forEach((p, i) => { if (p.name === 'A') { sumA += g.hand!.result!.net[p.id] / 20; handsA++; } void i; });
    }
    samples.push((sumA / handsA) * 100); // 该复式组 A 方 bb/100
  }
  const m = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - m) ** 2, 0) / (samples.length - 1));
  return { bb100: m, ci95: (1.96 * sd) / Math.sqrt(samples.length), hands: deals * 2, styles };
}

/** 连续会话（标准场 50BB，可重买）测重买率 */
function runRebuy(hands: number, diff: Difficulty, seed: number) {
  const styles: Record<string, Style> = Object.fromEntries(STYLES.map((s) => [s, newStyle()]));
  let g = createGame({ stakeId: 'standard', sb: 10, bb: 20, startingStack: 1000, rebuy: true }, Array.from({ length: 6 }, (_, i) => cfg('r' + i, diff, STYLES[i % STYLES.length])), seed);
  const per: Record<string, { rebuys: number; hands: number }> = Object.fromEntries(STYLES.map((s) => [s, { rebuys: 0, hands: 0 }]));
  for (let h = 0; h < hands; h++) {
    for (const p of g.players) if (p.stack === 0 && !p.pendingRebuy) { g = reduce(g, { type: 'rebuy', playerId: p.id }); per[p.style!].rebuys++; }
    g = playHand(g, (g.button + 1) % 6, seed + h, styles);
    g.players.forEach((p) => per[p.style!].hands++);
  }
  return Object.fromEntries(Object.entries(per).map(([k, v]) => [k, (v.rebuys / v.hands) * 100]));
}

const JOBS: Record<string, () => unknown> = {};
const ONLY = process.env.BENCH_ONLY;
const deals = Number(process.argv[2] === '--job' ? process.argv[4] : process.argv[2] ?? 2000);
for (const n of [2, 6]) for (const [a, b] of [['hard', 'normal'], ['hard', 'easy'], ['normal', 'easy']] as const)
  JOBS[`${a} vs ${b} ${n === 2 ? 'HU' : '6-max'}`] = () => runMatch(a, b, n, n === 2 ? deals : Math.round(deals / 2), n * 31 + a.length * 7 + b.length);
if (ONLY) for (const k of Object.keys(JOBS)) if (!k.includes(ONLY)) delete JOBS[k];
JOBS['rebuy normal'] = () => runRebuy(Math.round(deals / 2), 'normal', 99);

if (process.argv[2] === '--job') {
  const r = JOBS[process.argv[3]]();
  process.send!(r);
  process.exit(0);
} else {
  const out = process.argv[3] ?? 'bench.json';
  const t0 = Date.now();
  const res: Record<string, any> = {};
  await Promise.all(Object.keys(JOBS).map((k) => new Promise<void>((ok) => {
    const c = fork(new URL(import.meta.url).pathname, ['--job', k, String(deals)], { execArgv: ['--import', 'tsx'] });
    c.on('message', (m) => { res[k] = m; ok(); });
  })));
  // 汇总风格
  const agg: Record<string, Style> = Object.fromEntries(STYLES.map((s) => [s, newStyle()]));
  for (const [k, v] of Object.entries(res)) if (k.includes('6-max')) for (const [s, st] of Object.entries(v.styles as Record<string, Style>)) {
    const t = agg[s]; for (const f of Object.keys(t) as (keyof Style)[]) t[f] = f === 'maxMs' ? Math.max(t[f], st[f]) : t[f] + st[f];
  }
  console.log(`\n对局（每手 100BB，复式发牌）  用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('| 对局 | 手数 | A 方 bb/100 | 95% CI | 显著 |\n|---|---|---|---|---|');
  for (const k of Object.keys(JOBS)) if (!k.startsWith('rebuy')) { const r = res[k]; console.log(`| ${k} | ${r.hands} | ${r.bb100.toFixed(1)} | ±${r.ci95.toFixed(1)} | ${Math.abs(r.bb100) > r.ci95 ? '是' : '否'} |`); }
  console.log('\n| 风格 | VPIP | PFR | AF | 弃牌/全部决策 | 重买/100手 | 平均决策ms | 最大ms |\n|---|---|---|---|---|---|---|---|');
  for (const s of STYLES) { const t = agg[s]; console.log(`| ${PERSONALITIES[s].label}(${s}) | ${(100 * t.vpip / t.hands).toFixed(0)}% | ${(100 * t.pfr / t.hands).toFixed(0)}% | ${(t.bets / Math.max(1, t.calls)).toFixed(2)} | ${(100 * t.folds / t.decisions).toFixed(0)}% | ${(res['rebuy normal'][s]).toFixed(1)} | ${(t.decideMs / t.decisions).toFixed(2)} | ${t.maxMs.toFixed(0)} |`); }
  writeFileSync(out, JSON.stringify({ deals, res, agg }, null, 2));
}
