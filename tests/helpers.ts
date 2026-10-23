import { createGame, reduce, cards, type GameState, type Action } from '../src/engine';
export function game(stacks: number[], opts: { sb?: number; bb?: number; button?: number } = {}): GameState {
  const sb = opts.sb ?? 10, bb = opts.bb ?? 20;
  const g = createGame({ stakeId: 't', sb, bb, startingStack: 1000, rebuy: true }, stacks.map((_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true })), 42);
  g.players.forEach((p, i) => (p.stack = stacks[i]));
  // button 参数：startHand 会移动到下一位，故预设为前一位
  g.button = opts.button === undefined ? -1 : (opts.button - 1 + stacks.length) % stacks.length;
  return g;
}
/** 指定底牌与公共牌（board 按发出顺序，含烧牌自动处理） */
export function rig(g: GameState, holes: string[], board: string): GameState {
  const h = g.hand!;
  holes.forEach((s, i) => { if (h.holes[i]) h.holes[i] = cards(s); });
  const b = cards(board);
  const used = new Set([...h.holes.flat().filter((x) => x !== null) as number[], ...b]);
  const filler = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  // 弹出顺序：burn, f1,f2,f3, burn, t, burn, r
  const seq = [filler[0], b[0], b[1], b[2], filler[1], b[3], filler[2], b[4]];
  h.deck = [...filler.slice(3), ...seq.reverse()];
  return g;
}
export const act = (g: GameState, ...as: Action[]) => as.reduce(reduce, g);
export const A = (type: any, playerId: string, amount?: number) => ({ type, playerId, amount }) as Action;
