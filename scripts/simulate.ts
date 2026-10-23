// 独立 AI 对战回归：npm run sim -- [手数] [人数] [seed]
import { createGame, reduce, viewFor, totalChips, makeRng } from '../src/engine';
import { decide } from '../src/ai/ai';
import { makeRoster } from '../src/ai/roster';
const [hands = 1000, n = 6, seed = 2026] = process.argv.slice(2).map(Number);
const rng = makeRng(seed);
const roster = makeRoster('Bot0', n, 'normal', rng).map((p, i) => (i === 0 ? { ...p, isBot: true, personality: { aggression: 0.5, bluff: 0.1, mistake: 0.05, callingStation: 0.3 }, difficulty: 'normal' as const } : p));
let g = createGame({ stakeId: 'standard', sb: 10, bb: 20, startingStack: 1000, rebuy: true }, roster, seed);
let actions = 0, showdowns = 0, splits = 0, sidePots = 0;
const t0 = Date.now();
for (let k = 0; k < hands; k++) {
  for (const p of g.players) if (p.stack === 0 && !p.pendingRebuy) g = reduce(g, { type: 'rebuy', playerId: p.id });
  const expected = g.players.reduce((a, p) => a + p.totalBuyIn, 0);
  g = reduce(g, { type: 'startHand' });
  while (g.hand!.street !== 'complete') {
    const pl = g.players[g.hand!.toAct];
    g = reduce(g, decide(viewFor(g, pl.id), { personality: pl.personality!, difficulty: pl.difficulty! }, rng));
    actions++;
    if (totalChips(g) !== expected) throw new Error(`筹码不守恒 hand ${g.handNo}`);
  }
  const r = g.hand!.result!;
  if (r.showdown) showdowns++;
  if (r.pots.some((p) => p.winners.length > 1)) splits++;
  if (r.pots.length > 1) sidePots++;
  if (g.players.reduce((a, p) => a + p.stack, 0) !== expected) throw new Error('结算后筹码不守恒');
}
console.log(JSON.stringify({ hands, players: n, actions, showdowns, splitPots: splits, handsWithSidePots: sidePots, buyIns: g.players.map((p) => `${p.name}:${p.buyIns}`), ms: Date.now() - t0, chipConservation: 'OK' }));
