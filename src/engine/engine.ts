import type { Action, BetAction, GameState, HandState, LogEntry, PlayerConfig, TableConfig, HandResult, PotResult, ShownHand } from './types';
import { fullDeck } from './cards';
import { shuffle } from './rng';
import { evaluate, handName } from './evaluator';
import { buildPots, splitPot } from './pots';

export class EngineError extends Error {}

const clone = <T>(x: T): T => structuredClone(x);

export function createGame(config: TableConfig, players: PlayerConfig[], seed: number): GameState {
  if (players.length < 2 || players.length > 10) throw new EngineError('人数需在 2~10 之间');
  if (!(config.sb < config.bb)) throw new EngineError('SB 必须小于 BB');
  if (config.startingStack < config.bb * 10) throw new EngineError('起始筹码需 ≥ 10BB');
  return {
    seed: seed >>> 0,
    config,
    players: players.map((p) => ({ ...p, stack: config.startingStack, buyIns: 1, totalBuyIn: config.startingStack, eliminated: false, pendingRebuy: false })),
    handNo: 0,
    button: -1,
    hand: null,
  };
}

export const seatOf = (s: GameState, id: string) => s.players.findIndex((p) => p.id === id);
const nextSeat = (from: number, n: number, ok: (i: number) => boolean): number => {
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (ok(i)) return i;
  }
  return -1;
};

export interface Legal {
  canFold: boolean;
  canCheck: boolean;
  /** 需补的跟注额（已按筹码截断） */
  callAmount: number;
  canRaise: boolean;
  /** 以"加注到"总额表示 */
  minRaiseTo: number;
  maxRaiseTo: number;
  isOpenBet: boolean;
}

export function legalFor(h: HandState, stack: number, seat: number): Legal | null {
  if (h.street === 'complete' || h.toAct !== seat) return null;
  const toCall = h.currentBet - h.bets[seat];
  const maxTo = h.bets[seat] + stack;
  const rights = h.lastActedLevel[seat] < 0 || h.currentBet - h.lastActedLevel[seat] >= h.minRaise;
  const canRaise = rights && maxTo > h.currentBet;
  return {
    canFold: true,
    canCheck: toCall <= 0,
    callAmount: Math.min(Math.max(0, toCall), stack),
    canRaise,
    minRaiseTo: Math.min(h.currentBet + h.minRaise, maxTo),
    maxRaiseTo: maxTo,
    isOpenBet: h.currentBet === 0,
  };
}

export function legalActions(s: GameState, playerId: string): Legal | null {
  const i = seatOf(s, playerId);
  if (!s.hand || i < 0) return null;
  return legalFor(s.hand, s.players[i].stack, i);
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'startHand':
      return startHand(state);
    case 'rebuy':
      return rebuy(state, action.playerId);
    default:
      return betAction(state, action);
  }
}

export function isHandLive(s: GameState) {
  return !!s.hand && s.hand.street !== 'complete';
}

function rebuy(state: GameState, id: string): GameState {
  const s = clone(state);
  const i = seatOf(s, id);
  const p = s.players[i];
  if (!p) throw new EngineError('未知玩家');
  if (!s.config.rebuy) throw new EngineError('本桌未开启重买');
  if (p.stack > 0 || p.pendingRebuy) throw new EngineError('筹码未归零，无需重买');
  // 记录买入，下一手开始时生效（若本手仍在进行且该玩家已全下，其本手照常结算）
  p.pendingRebuy = true;
  p.eliminated = false;
  p.buyIns += 1;
  p.totalBuyIn += s.config.startingStack;
  return s;
}

function startHand(state: GameState): GameState {
  if (isHandLive(state)) throw new EngineError('当前手牌未结束');
  const s = clone(state);
  const { sb, bb } = s.config;
  for (const p of s.players) {
    if (p.pendingRebuy) {
      p.stack += s.config.startingStack;
      p.pendingRebuy = false;
    }
    if (p.stack <= 0 && !s.config.rebuy) p.eliminated = true;
  }
  const n = s.players.length;
  const seated = s.players.map((p) => p.stack > 0 && !p.eliminated);
  if (seated.filter(Boolean).length < 2) throw new EngineError('可参与玩家不足 2 人');

  const button = nextSeat(s.button < 0 ? n - 1 : s.button, n, (i) => seated[i]);
  const headsUp = seated.filter(Boolean).length === 2;
  const sbSeat = headsUp ? button : nextSeat(button, n, (i) => seated[i]);
  const bbSeat = nextSeat(sbSeat, n, (i) => seated[i]);

  const [deck, seed] = shuffle(fullDeck(), s.seed);
  s.seed = seed;
  s.handNo += 1;
  s.button = button;
  const h: HandState = {
    handNo: s.handNo,
    button, sbSeat, bbSeat,
    deck,
    holes: s.players.map(() => null),
    board: [],
    street: 'preflop',
    inHand: seated,
    bets: Array(n).fill(0),
    committed: Array(n).fill(0),
    folded: Array(n).fill(false),
    allIn: Array(n).fill(false),
    acted: Array(n).fill(false),
    lastActedLevel: Array(n).fill(-1),
    currentBet: 0,
    minRaise: bb,
    toAct: -1,
    actionSeq: 0,
    startStacks: s.players.map((p) => p.stack),
    log: [],
  };
  // 从按钮左手开始，每人发 2 张
  for (let r = 0; r < 2; r++) {
    let i = button;
    for (let k = 0; k < n; k++) {
      i = (i + 1) % n;
      if (!seated[i]) continue;
      (h.holes[i] ??= []).push(h.deck.pop()!);
    }
  }
  const post = (seat: number, amt: number, kind: 'sb' | 'bb') => {
    const p = s.players[seat];
    const a = Math.min(amt, p.stack);
    p.stack -= a;
    h.bets[seat] += a;
    h.committed[seat] += a;
    if (p.stack === 0) h.allIn[seat] = true;
    h.log.push({ street: 'preflop', playerId: p.id, kind, amount: a });
  };
  post(sbSeat, sb, 'sb');
  post(bbSeat, bb, 'bb');
  h.currentBet = Math.max(h.bets[sbSeat], h.bets[bbSeat], bb);
  s.hand = h;
  h.toAct = findNextToAct(h, bbSeat);
  if (h.toAct < 0) finishStreet(s);
  return s;
}

const canAct = (h: HandState, i: number) => h.inHand[i] && !h.folded[i] && !h.allIn[i];
const needsAct = (h: HandState, i: number) => canAct(h, i) && (!h.acted[i] || h.bets[i] < h.currentBet);

function findNextToAct(h: HandState, after: number): number {
  const n = h.inHand.length;
  const actors = h.inHand.map((_, i) => i).filter((i) => canAct(h, i));
  // 只剩 ≤1 名可行动玩家且其投入已达当前下注 → 无需再行动
  if (actors.length === 0) return -1;
  if (actors.length === 1 && h.bets[actors[0]] >= h.currentBet) return -1;
  return nextSeat(after, n, (i) => needsAct(h, i));
}

function betAction(state: GameState, a: BetAction): GameState {
  const s = clone(state);
  const h = s.hand;
  if (!h || h.street === 'complete') throw new EngineError('当前没有进行中的手牌');
  const seat = seatOf(s, a.playerId);
  if (seat < 0 || seat !== h.toAct) throw new EngineError('未轮到该玩家行动');
  const p = s.players[seat];
  const legal = legalFor(h, p.stack, seat)!;
  const put = (amt: number) => {
    p.stack -= amt;
    h.bets[seat] += amt;
    h.committed[seat] += amt;
    if (p.stack === 0) h.allIn[seat] = true;
  };
  let type = a.type;
  let logged: LogEntry = { street: h.street, playerId: p.id, kind: type };
  const raiseTo = (to: number) => {
    const prevBet = h.currentBet;
    const inc = to - prevBet;
    put(to - h.bets[seat]);
    if (inc >= h.minRaise) h.minRaise = inc; // 完整加注：更新最小加注增量
    // 不足额全下：只抬高 currentBet，不更新 minRaise；已行动者因 lastActedLevel 判定无加注权
    h.currentBet = to;
    for (let i = 0; i < h.inHand.length; i++) if (i !== seat) h.acted[i] = false;
  };
  switch (type) {
    case 'fold':
      h.folded[seat] = true;
      break;
    case 'check':
      if (!legal.canCheck) throw new EngineError('需要跟注，不能过牌');
      break;
    case 'call':
      if (legal.canCheck) throw new EngineError('无需跟注');
      put(legal.callAmount);
      logged.amount = legal.callAmount;
      if (h.allIn[seat]) logged.kind = 'allin';
      break;
    case 'bet':
    case 'raise': {
      if (!legal.canRaise) throw new EngineError('当前无加注权');
      const to = Math.floor(a.amount ?? NaN);
      if (!Number.isFinite(to)) throw new EngineError('缺少加注金额');
      if (to > legal.maxRaiseTo) throw new EngineError('加注超过筹码');
      if (to < legal.minRaiseTo) throw new EngineError(`加注至少到 ${legal.minRaiseTo}`);
      raiseTo(to);
      logged = { ...logged, kind: legal.isOpenBet ? 'bet' : 'raise', amount: to };
      if (h.allIn[seat]) logged.kind = 'allin';
      break;
    }
    case 'allin': {
      const to = legal.maxRaiseTo;
      if (to <= h.currentBet || !legal.canRaise) {
        // 筹码不足跟注 / 无加注权：全下即跟注
        if (legal.canCheck && to <= h.currentBet) throw new EngineError('无需全下');
        put(legal.callAmount);
        logged.amount = h.bets[seat];
        if (!h.allIn[seat]) logged.kind = 'call';
      } else {
        raiseTo(to);
        logged.amount = to;
      }
      break;
    }
    default:
      throw new EngineError('未知行动');
  }
  h.acted[seat] = true;
  h.lastActedLevel[seat] = h.currentBet;
  h.actionSeq++;
  h.log.push(logged);
  void type;

  const contenders = h.inHand.map((_, i) => i).filter((i) => h.inHand[i] && !h.folded[i]);
  if (contenders.length === 1) {
    refundUncalled(s);
    settle(s, false);
    return s;
  }
  h.toAct = findNextToAct(h, seat);
  if (h.toAct < 0) finishStreet(s);
  return s;
}

function refundUncalled(s: GameState) {
  const h = s.hand!;
  const order = h.bets.map((b, i) => [b, i]).sort((a, b) => b[0] - a[0]);
  const [top, ti] = order[0];
  const second = order[1]?.[0] ?? 0;
  if (top > second) {
    const d = top - second;
    h.bets[ti] -= d;
    h.committed[ti] -= d;
    s.players[ti].stack += d;
    if (s.players[ti].stack > 0) h.allIn[ti] = false;
    h.log.push({ street: h.street, playerId: s.players[ti].id, kind: 'refund', amount: d });
  }
}

const NEXT: Record<string, HandState['street']> = { preflop: 'flop', flop: 'turn', turn: 'river' };

function dealStreet(h: HandState) {
  const street = NEXT[h.street];
  h.deck.pop(); // 烧牌
  const k = street === 'flop' ? 3 : 1;
  const cs: number[] = [];
  for (let i = 0; i < k; i++) cs.push(h.deck.pop()!);
  h.board.push(...cs);
  h.street = street;
  h.log.push({ street, kind: 'board', cards: cs });
}

function finishStreet(s: GameState) {
  const h = s.hand!;
  refundUncalled(s);
  const n = h.inHand.length;
  while (true) {
    if (h.street === 'river') {
      settle(s, true);
      return;
    }
    h.bets = Array(n).fill(0);
    h.acted = Array(n).fill(false);
    h.lastActedLevel = Array(n).fill(-1);
    h.currentBet = 0;
    h.minRaise = s.config.bb;
    dealStreet(h);
    h.toAct = findNextToAct(h, h.button);
    if (h.toAct >= 0) return;
  }
}

function settle(s: GameState, showdown: boolean) {
  const h = s.hand!;
  const n = h.inHand.length;
  const contending = h.inHand.map((x, i) => x && !h.folded[i]);
  const scores = h.holes.map((hc, i) => (contending[i] && showdown && hc ? evaluate([...hc, ...h.board]) : -1));
  const pots = buildPots(h.committed, contending);
  const payouts: Record<string, number> = {};
  const potResults: PotResult[] = [];
  for (const pot of pots) {
    const best = Math.max(...pot.eligible.map((i) => scores[i]));
    const winners = pot.eligible.filter((i) => scores[i] === best);
    const m = splitPot(pot.amount, winners, h.button, n);
    const shares: Record<string, number> = {};
    for (const [i, amt] of m) {
      const id = s.players[i].id;
      shares[id] = amt;
      payouts[id] = (payouts[id] ?? 0) + amt;
      s.players[i].stack += amt;
    }
    potResults.push({ amount: pot.amount, eligible: pot.eligible.map((i) => s.players[i].id), winners: winners.map((i) => s.players[i].id), shares });
  }
  const shown: Record<string, ShownHand> = {};
  if (showdown) for (let i = 0; i < n; i++) if (contending[i] && h.holes[i]) shown[s.players[i].id] = { cards: h.holes[i]!, score: scores[i], name: handName(scores[i]) };
  const net: Record<string, number> = {};
  s.players.forEach((p, i) => { if (h.inHand[i]) net[p.id] = p.stack - h.startStacks[i]; });
  const result: HandResult = { pots: potResults, payouts, net, showdown, shown, board: h.board.slice() };
  for (const [id, amt] of Object.entries(payouts)) h.log.push({ street: h.street, playerId: id, kind: 'win', amount: amt });
  h.result = result;
  h.street = 'complete';
  h.toAct = -1;
  for (const p of s.players) if (p.stack <= 0 && !s.config.rebuy) p.eliminated = true;
}

export function totalChips(s: GameState): number {
  const inPlay = s.hand && s.hand.street !== 'complete' ? s.hand.committed.reduce((a, b) => a + b, 0) : 0;
  return s.players.reduce((a, p) => a + p.stack, 0) + inPlay;
}
