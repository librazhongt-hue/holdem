import type { BetAction, Card, Difficulty, Personality, LogEntry } from '../engine/types';
import type { PlayerView } from '../engine/view';
import { evaluate, categoryOf } from '../engine/evaluator';
import { rankOf, suitOf, fullDeck } from '../engine/cards';
import { makeRng } from '../engine/rng';

/** 风格参数：vpip/pfr 为目标起手牌范围（6 人桌口径），其余影响翻后 */
export const PERSONALITIES: Record<string, Personality & { label: string }> = {
  rock: { label: '紧弱', vpip: 0.15, pfr: 0.1, aggression: 0.25, bluff: 0.02, mistake: 0.02, callingStation: 0.25 },
  tag: { label: '紧凶', vpip: 0.22, pfr: 0.2, aggression: 0.7, bluff: 0.08, mistake: 0.01, callingStation: 0.1 },
  lag: { label: '松凶', vpip: 0.31, pfr: 0.28, aggression: 0.8, bluff: 0.14, mistake: 0.02, callingStation: 0.15 },
  station: { label: '跟注站', vpip: 0.42, pfr: 0.07, aggression: 0.2, bluff: 0.03, mistake: 0.03, callingStation: 0.7 },
  maniac: { label: '疯子', vpip: 0.55, pfr: 0.44, aggression: 0.95, bluff: 0.25, mistake: 0.04, callingStation: 0.35 },
};

const DIFF_MISTAKE: Record<Difficulty, number> = { easy: 0.1, normal: 0.07, hard: 0 };

// ---------- 翻前：169 类起手牌按"对随机手胜率"排序得到百分位 ----------
let PCT: Float32Array | null = null; // index = r1*13+r2 (r1>=r2: 对子/不同花用 [hi][lo]，同花用 [lo][hi])
const classIdx = (h: Card[]) => {
  const a = rankOf(h[0]), b = rankOf(h[1]);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return suitOf(h[0]) === suitOf(h[1]) && a !== b ? lo * 13 + hi : hi * 13 + lo;
};
function buildPct() {
  const rng = makeRng(20261021);
  const eq: { i: number; e: number; combos: number }[] = [];
  for (let hi = 0; hi < 13; hi++) for (let lo = 0; lo <= hi; lo++) for (const suited of hi === lo ? [false] : [false, true]) {
    const h = [(hi << 2) | 0, (lo << 2) | (suited ? 0 : 1)];
    eq.push({ i: suited ? lo * 13 + hi : hi * 13 + lo, e: monteCarloEquity(h, [], 1, 400, rng), combos: hi === lo ? 6 : suited ? 4 : 12 });
  }
  eq.sort((a, b) => b.e - a.e);
  PCT = new Float32Array(169);
  let acc = 0;
  for (const x of eq) { acc += x.combos; PCT[x.i] = acc / 1326; } // 该手牌及更强手牌占全部组合的比例
}
/** 0 = 最强（AA），1 = 最弱 */
export function handPercentile(h: Card[]): number {
  if (!PCT) buildPct();
  return PCT![classIdx(h)];
}
/** 兼容旧接口：0..1 越大越强 */
export const preflopStrength = (h: Card[]) => 1 - handPercentile(h);

/** 蒙特卡洛胜率：只对未知牌随机假设；ranges[i] 为对手 i 的起手牌范围宽度（由公开行动推断） */
export function monteCarloEquity(hole: Card[], board: Card[], opponents: number, samples: number, rng: () => number, ranges?: number[], aggro?: number[]): number {
  const known = new Set([...hole, ...board]);
  const rest = fullDeck().filter((c) => !known.has(c));
  const need = 5 - board.length;
  const b = board.slice();
  const opp: Card[] = new Array(opponents * 2);
  let win = 0;
  const L = rest.length;
  for (let s = 0; s < samples; s++) {
    const d = rest.slice();
    let top = 0;
    const draw = () => { const j = top + Math.floor(rng() * (L - top)); const c = d[j]; d[j] = d[top]; d[top] = c; top++; return c; };
    for (let o = 0; o < opponents; o++) {
      const r = ranges?.[o] ?? 1;
      let c1 = draw(), c2 = draw();
      for (let tries = 0; r < 1 && tries < 25 && handPercentile([c1, c2]) > r; tries++) {
        // 拒绝采样：放回重抽
        top -= 2; c1 = draw(); c2 = draw();
      }
      // 翻后主动下注过的对手：多数时候至少有一对或像样听牌（约 25% 视为诈唬放行）
      const lv = aggro?.[o] ?? 0;
      const airPass = lv >= 4 ? 0.08 : 0.25 / Math.max(1, lv);
      for (let tries = 0; lv > 0 && board.length >= 3 && tries < 30 && !(lv >= 4 ? madePair(c1, c2, board) : hasSomething(c1, c2, board)) && rng() > airPass; tries++) {
        top -= 2; c1 = draw(); c2 = draw();
      }
      opp[o * 2] = c1; opp[o * 2 + 1] = c2;
    }
    for (let i = 0; i < need; i++) b[board.length + i] = draw();
    const mine = evaluate([...hole, ...b]);
    let ties = 0, lost = false;
    for (let o = 0; o < opponents; o++) {
      const v = evaluate([opp[o * 2], opp[o * 2 + 1], ...b]);
      if (v > mine) { lost = true; break; }
      if (v === mine) ties++;
    }
    if (!lost) win += 1 / (ties + 1);
  }
  b.length = board.length;
  return win / samples;
}

function madePair(c1: Card, c2: Card, board: Card[]): boolean {
  const r1 = rankOf(c1), r2 = rankOf(c2);
  return r1 === r2 || board.some((b) => rankOf(b) === r1 || rankOf(b) === r2);
}
function hasSomething(c1: Card, c2: Card, board: Card[]): boolean {
  const r1 = rankOf(c1), r2 = rankOf(c2);
  if (r1 === r2) return true;
  for (const b of board) { const rb = rankOf(b); if (rb === r1 || rb === r2) return true; }
  const all = [c1, c2, ...board];
  if (board.length < 5) { const d = draws(all); if (d.flush || d.oesd) return true; }
  return categoryOf(evaluate(all.length >= 5 ? all : all)) >= 4 && all.length >= 5;
}

// ---------- 翻后启发式（简单/普通） ----------
function draws(all: Card[]): { flush: boolean; oesd: boolean; gut: boolean } {
  const suits = [0, 0, 0, 0];
  all.forEach((c) => suits[suitOf(c)]++);
  const rs = new Set(all.map(rankOf));
  let oesd = false, gut = false;
  for (let lo = -1; lo <= 8; lo++) {
    let cnt = 0;
    for (let r = lo; r < lo + 5; r++) if (rs.has(r < 0 ? 12 : r)) cnt++;
    if (cnt === 4) { const missEnd = !rs.has(lo < 0 ? 12 : lo) || !rs.has(lo + 4); if (missEnd && lo >= 0 && lo <= 7) oesd = true; else gut = true; }
  }
  return { flush: Math.max(...suits) === 4, oesd, gut };
}

/** 返回 [成手强度 0..1, 听牌补充胜率] */
function postflopHeuristic(hole: Card[], board: Card[], crude: boolean): [number, number] {
  const sc = evaluate([...hole, ...board]);
  const cat = categoryOf(sc);
  let s = [0.12, 0.45, 0.68, 0.78, 0.84, 0.87, 0.93, 0.97, 0.99, 1][cat];
  if (crude) return [s, 0]; // 简单难度：只看牌型类别
  const boardSc = evaluate(board.length >= 5 ? board : board); // board 3~5 张
  const boardCat = board.length >= 5 ? categoryOf(boardSc) : boardPairCat(board);
  if (cat > 0 && cat <= boardCat) s = 0.2; // 牌力全在公共牌上
  const top = Math.max(...board.map(rankOf));
  if (cat === 1) {
    const pr = Math.floor(sc / 16 ** 4) % 16;
    const usesHole = hole.some((c) => rankOf(c) === pr);
    if (!usesHole) s = 0.2;
    else if (pr > top) s = 0.62; // 超对
    else if (pr === top) s = 0.52 + (Math.max(...hole.map(rankOf)) >= 10 ? 0.06 : 0); // 顶对（好踢脚）
    else s = 0.32; // 中/底对
  }
  if (cat === 2 && boardCat >= 1) s = hole.some((c) => board.some((b) => rankOf(b) === rankOf(c))) || rankOf(hole[0]) === rankOf(hole[1]) ? 0.55 : 0.3;
  // 公共牌危险：四张同花/顺面
  const suits = [0, 0, 0, 0]; board.forEach((c) => suits[suitOf(c)]++);
  if (cat < 5 && Math.max(...suits) >= 3) s -= 0.06 * (Math.max(...suits) - 2);
  let drawEq = 0;
  if (board.length < 5) {
    const d = draws([...hole, ...board]);
    const outs = (d.flush ? 9 : 0) + (d.oesd ? 8 : d.gut ? 4 : 0);
    drawEq = Math.min(0.45, outs * (board.length === 3 ? 0.04 : 0.02));
  }
  return [Math.max(0, Math.min(1, s)), drawEq];
}
function boardPairCat(board: Card[]) {
  const c = new Map<number, number>(); board.forEach((x) => c.set(rankOf(x), (c.get(rankOf(x)) ?? 0) + 1));
  const m = Math.max(...c.values());
  return m >= 3 ? 3 : m === 2 ? 1 : 0;
}

/** 从公开行动推断对手翻前范围宽度（只用公开日志） */
function inferRanges(view: PlayerView, oppIds: string[]): number[] {
  return oppIds.map((id) => {
    let r = 1;
    let raises = 0;
    for (const l of view.hand!.log as LogEntry[]) {
      if (l.playerId !== id || l.street !== 'preflop') continue;
      if (l.kind === 'raise' || l.kind === 'bet' || l.kind === 'allin') raises++;
      else if (l.kind === 'call') r = Math.min(r, 0.4);
    }
    if (raises === 1) r = 0.2; else if (raises >= 2) r = 0.07;
    // 翻后每次主动下注/加注收紧
    const post = (view.hand!.log as LogEntry[]).filter((l) => l.playerId === id && l.street !== 'preflop' && (l.kind === 'bet' || l.kind === 'raise' || l.kind === 'allin')).length;
    return Math.max(0.05, r * Math.pow(0.85, post));
  });
}

export interface AiProfile { personality: Personality; difficulty: Difficulty }

/** AI 决策：输入仅为该 AI 自己的 PlayerView */
export function decide(view: PlayerView, profile: AiProfile, rng: () => number): BetAction {
  const h = view.hand!;
  const legal = view.legal!;
  const me = view.mySeat;
  const id = view.viewerId!;
  const hole = h.holes[me]!;
  const p = profile.personality;
  const diff = profile.difficulty;
  const stack = view.players[me].stack;
  const pot = h.committed.reduce((a, b) => a + b, 0);
  const n = h.inHand.length;
  const active = h.inHand.map((x, i) => x && !h.folded[i]);
  const oppSeats = active.map((x, i) => (x && i !== me ? i : -1)).filter((i) => i >= 0);
  const bb = view.config.bb;
  const call = legal.callAmount;
  const act = (type: BetAction['type'], amount?: number): BetAction => ({ type, playerId: id, amount });
  const passive = () => (call > 0 ? act('fold') : act('check'));
  const callOrCheck = () => (call > 0 ? act('call') : act('check'));
  const raiseTo = (to: number): BetAction => {
    if (!legal.canRaise) return callOrCheck();
    to = Math.round(Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, to)));
    if (to >= legal.maxRaiseTo * 0.8) return act('allin');
    return act(legal.isOpenBet ? 'bet' : 'raise', to);
  };
  const potRaise = (frac: number) => raiseTo(h.currentBet + (pot + call) * frac);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];

  // 失误：随机偏离（简单难度更多）
  const mistake = DIFF_MISTAKE[diff] + p.mistake * 0.5;
  if (rng() < mistake) {
    const r = rng();
    if (r < 0.6) return callOrCheck();
    if (r < 0.8) return passive();
    return potRaise(0.5 + rng() * 0.5);
  }

  // ---------------- 翻前 ----------------
  if (h.board.length === 0) {
    const pct = handPercentile(hole);
    const seatsLeft = active.filter(Boolean).length;
    const posFromBtn = (h.button - me + n) % n; // 0=按钮，1=CO…
    const posMul = posFromBtn === 0 ? 1.45 : posFromBtn === 1 ? 1.2 : me === h.sbSeat ? 0.95 : me === h.bbSeat ? 1 : 0.8;
    const shortHanded = Math.min(2.2, Math.max(1, 6 / Math.max(2, n))); // 人少范围更宽（单挑约 ×2.2）
    const vpip = Math.min(0.95, (p.vpip ?? 0.25) * posMul * shortHanded);
    const pfr = Math.min(vpip, (p.pfr ?? 0.15) * posMul * shortHanded);
    const raisesSoFar = h.log.filter((l) => l.street === 'preflop' && (l.kind === 'raise' || l.kind === 'bet' || (l.kind === 'allin' && (l.amount ?? 0) > bb))).length;
    const limpers = h.log.filter((l) => l.street === 'preflop' && l.kind === 'call').length;
    const toCallBB = call / bb;
    void seatsLeft;
    if (raisesSoFar === 0) {
      if (pct <= pfr) return raiseTo(bb * (pick([2.2, 2.5, 3]) + limpers) + (n === 2 ? 0 : 0));
      if (call === 0) return act('check'); // BB option
      // 平跟：跟注站/紧弱倾向 limp；其余在范围内基本只开加
      const limpRange = pfr + (vpip - pfr) * (0.35 + p.callingStation * 0.65);
      if (pct <= limpRange || (me === h.sbSeat && pct <= vpip * 1.1 && n > 2)) return act('call');
      return passive();
    }
    // 面对加注：3bet / 跟注 / 弃牌，按价格与风格
    const priceMul = Math.max(0.25, Math.min(1.2, 3 / Math.max(1, toCallBB))); // 越贵越紧
    const threeBet = pfr * (0.22 + p.aggression * 0.12) * (raisesSoFar >= 2 ? 0.35 : 1);
    const callR = vpip * (0.5 + p.callingStation * 0.4) * priceMul * (raisesSoFar >= 2 ? 0.45 : 1);
    if (pct <= threeBet || (rng() < p.bluff * 0.25 && pct < 0.5 && raisesSoFar === 1)) return potRaise(pick([0.8, 1, 1.1]));
    if (call >= stack && pct <= Math.max(0.05, callR * 0.6)) return act('allin');
    if (pct <= Math.max(threeBet, callR) || (me === h.bbSeat && toCallBB <= 2.5 && pct <= vpip * 1.3)) return act('call');
    return passive();
  }

  // ---------------- 翻后 ----------------
  const facingBets = h.log.filter((l) => l.street === h.street && l.playerId !== id && (l.kind === 'bet' || l.kind === 'raise' || l.kind === 'allin')).length;
  let equity: number;
  if (diff === 'hard') {
    const ranges = inferRanges(view, oppSeats.map((i) => view.players[i].id));
    // 对手翻后参与度：主动下注/加注计 2，跟注计 1（只用公开日志）
    const aggro = oppSeats.map((i) => h.log.reduce((a, l) => a + (l.playerId === view.players[i].id && l.street !== 'preflop' ? (l.kind === 'bet' || l.kind === 'raise' || l.kind === 'allin' ? 2 : l.kind === 'call' ? 1 : 0) : 0), 0));
    equity = monteCarloEquity(hole, h.board, oppSeats.length, 500, rng, ranges, aggro);
  } else {
    const [made, drawEq] = postflopHeuristic(hole, h.board, diff === 'easy');
    // 多人底池与对手主动下注都意味着需要更强的牌
    equity = Math.min(1, made + drawEq * (diff === 'normal' ? 0.8 : 0.8)) - Math.max(0, oppSeats.length - 1) * 0.06 - (diff === 'normal' ? facingBets * 0.02 : 0);
  }
  const potOdds = call > 0 ? call / (pot + call) : 0;
  const spr = stack / Math.max(1, pot);
  const valueThresh = diff === 'hard' ? 0.6 + 0.05 * Math.min(3, oppSeats.length - 1) : 0.66;
  const strong = equity >= valueThresh + (1 - p.aggression) * 0.1;
  // 价值下注/加注，尺寸随牌力与随机变化
  if (strong && legal.canRaise && (call === 0 || rng() < 0.35 + p.aggression * 0.45)) {
    if (call === 0 && rng() > 0.25 + p.aggression * 0.75 && equity < 0.9) return act('check'); // 慢打
    const frac = equity > 0.88 ? pick([0.66, 0.75, 1, 1.25]) : pick([0.33, 0.5, 0.66, 0.75]);
    if (spr < 1.2) return act('allin');
    return potRaise(call > 0 ? frac + 0.3 : frac);
  }
  // 诈唬 / 半诈唬（无人下注时，单挑或少人更多）
  if (call === 0 && legal.canRaise) {
    const semi = diff !== 'easy' && equity > 0.3 && equity < valueThresh && h.street !== 'river';
    const bluffP = p.bluff * (oppSeats.length === 1 ? 1 : 0.35) + (semi ? 0.15 * p.aggression : 0);
    if (rng() < bluffP) return potRaise(pick([0.33, 0.5, 0.66, 0.75]));
    // 中等牌力偶尔薄价值/保护
    if (equity > 0.5 && rng() < p.aggression * 0.35) return potRaise(pick([0.33, 0.5]));
    return act('check');
  }
  if (call === 0) return act('check');
  // 面对下注：按胜率与赔率；easy 更容易被价格诱惑，跟注站倾向更跟
  const margin = (diff === 'easy' ? -0.04 : diff === 'normal' ? 0.03 : 0.07) - p.callingStation * 0.12;
  const big = call > stack * 0.5 || call > pot * 0.9 ? (diff === 'hard' ? 0.06 : 0.06) : 0;
  if (equity >= potOdds + margin + big) return act(call >= stack ? 'allin' : 'call');
  if (diff === 'hard' && rng() < p.bluff * 0.15 && legal.canRaise && oppSeats.length === 1 && h.street !== 'river') return potRaise(1);
  return act('fold');
}
