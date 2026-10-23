import { describe, it, expect } from 'vitest';
import { createGame, reduce, viewFor, totalChips, makeRng, type GameState } from '../src/engine';
import { decide } from '../src/ai/ai';
import { makeRoster } from '../src/ai/roster';

export function simulate(hands: number, players: number, seed: number, difficulty: 'easy' | 'normal' | 'hard') {
  const rng = makeRng(seed);
  const roster = makeRoster('Bot0', players, difficulty, rng).map((p, i) => i === 0 ? { ...p, isBot: true, personality: { aggression: 0.5, bluff: 0.1, mistake: 0.05, callingStation: 0.3 }, difficulty } : p);
  let g: GameState = createGame({ stakeId: 'standard', sb: 10, bb: 20, startingStack: 1000, rebuy: true }, roster, seed);
  let played = 0, actions = 0;
  for (let k = 0; k < hands; k++) {
    for (const p of g.players) if (p.stack === 0 && !p.pendingRebuy) g = reduce(g, { type: 'rebuy', playerId: p.id });
    const expected = g.players.reduce((a, p) => a + p.totalBuyIn, 0);
    g = reduce(g, { type: 'startHand' });
    while (g.hand!.street !== 'complete') {
      const seat = g.hand!.toAct;
      const pl = g.players[seat];
      const v = viewFor(g, pl.id);
      // 视角过滤：AI 看不到他人底牌
      v.hand!.holes.forEach((h, i) => { if (i !== seat) expect(h).toBeNull(); });
      g = reduce(g, decide(v, { personality: pl.personality!, difficulty: pl.difficulty! }, rng));
      actions++;
      if (actions > 1e6) throw new Error('死循环');
      expect(totalChips(g)).toBe(expected);
    }
    expect(g.players.reduce((a, p) => a + p.stack, 0)).toBe(expected);
    expect(g.players.every((p) => p.stack >= 0)).toBe(true);
    played++;
  }
  return { played, actions, g };
}

describe('AI 对战回归', () => {
  it('6 人 normal 300 手：筹码守恒、无异常', () => {
    const r = simulate(300, 6, 7, 'normal');
    expect(r.played).toBe(300);
  });
  it('2~10 人各 60 手 easy', () => {
    for (let n = 2; n <= 10; n++) expect(simulate(60, n, 100 + n, 'easy').played).toBe(60);
  });
  it('hard（蒙特卡洛）4 人 40 手', () => {
    expect(simulate(40, 4, 9, 'hard').played).toBe(40);
  }, 60000);
  it('同一 seed 可重放', () => {
    const a = simulate(30, 5, 123, 'normal').g, b = simulate(30, 5, 123, 'normal').g;
    expect(a).toEqual(b);
  });
});

