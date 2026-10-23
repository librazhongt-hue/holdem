import type { Card } from './types';
import { rankOf, suitOf } from './cards';

export const CATEGORY_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺', '皇家同花顺'];

/** 5 张牌 → 可比较分数：category * 16^5 + 依次 kicker */
export function evaluate5(cs: Card[]): number {
  const ranks = cs.map(rankOf).sort((a, b) => b - a);
  const flush = cs.every((c) => suitOf(c) === suitOf(cs[0]));
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3) straightHigh = 3; // A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pack = (cat: number, ks: number[]) => {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 16 + (ks[i] ?? 0);
    return v;
  };
  const gr = groups.map((g) => g[0]);
  if (straightHigh >= 0 && flush) return pack(straightHigh === 12 ? 9 : 8, [straightHigh]);
  if (groups[0][1] === 4) return pack(7, gr);
  if (groups[0][1] === 3 && groups[1][1] === 2) return pack(6, gr);
  if (flush) return pack(5, ranks);
  if (straightHigh >= 0) return pack(4, [straightHigh]);
  if (groups[0][1] === 3) return pack(3, gr);
  if (groups[0][1] === 2 && groups[1][1] === 2) return pack(2, gr);
  if (groups[0][1] === 2) return pack(1, gr);
  return pack(0, ranks);
}

const pk = (cat: number, a = 0, b = 0, c = 0, d = 0, e = 0) => ((((cat * 16 + a) * 16 + b) * 16 + c) * 16 + d) * 16 + e;
function straightHigh(mask: number): number {
  for (let h = 12; h >= 4; h--) if (((mask >> (h - 4)) & 31) === 31) return h;
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3; // A-2-3-4-5
  return -1;
}
function topBits(mask: number, k: number, out: number[]) {
  for (let r = 12; r >= 0 && out.length < k; r--) if (mask & (1 << r)) out.push(r);
  return out;
}
const cnt = new Int8Array(13);
const sc = new Int8Array(4);
const sm = new Int32Array(4);
/** 5~7 张最优 5 张牌力（直接按计数计算，结果与枚举 21 种组合完全一致，用于高速蒙特卡洛） */
export function evaluate(cs: Card[]): number {
  cnt.fill(0); sc.fill(0); sm.fill(0);
  let mask = 0;
  for (const c of cs) { const r = c >> 2, su = c & 3; cnt[r]++; sc[su]++; sm[su] |= 1 << r; mask |= 1 << r; }
  for (let su = 0; su < 4; su++) if (sc[su] >= 5) {
    const sh = straightHigh(sm[su]);
    if (sh >= 0) return pk(sh === 12 ? 9 : 8, sh);
    const t = topBits(sm[su], 5, []);
    return pk(5, t[0], t[1], t[2], t[3], t[4]);
  }
  let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = cnt[r];
    if (n === 4) q = r;
    else if (n === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (n === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
  }
  if (q >= 0) return pk(7, q, topBits(mask & ~(1 << q), 1, [])[0]);
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return pk(6, t1, Math.max(t2, p1));
  const sh = straightHigh(mask);
  if (sh >= 0) return pk(4, sh);
  if (t1 >= 0) { const k = topBits(mask & ~(1 << t1), 2, []); return pk(3, t1, k[0], k[1]); }
  if (p2 >= 0) return pk(2, p1, p2, topBits(mask & ~(1 << p1) & ~(1 << p2), 1, [])[0]);
  if (p1 >= 0) { const k = topBits(mask & ~(1 << p1), 3, []); return pk(1, p1, k[0], k[1], k[2]); }
  const k = topBits(mask, 5, []);
  return pk(0, k[0], k[1], k[2], k[3], k[4]);
}

/** 参考实现：枚举全部 5 张组合（测试用） */
export function evaluateBrute(cs: Card[]): number {
  if (cs.length === 5) return evaluate5(cs);
  let best = -1;
  const n = cs.length;
  const pick: Card[] = [];
  const rec = (start: number) => {
    if (pick.length === 5) { const v = evaluate5(pick); if (v > best) best = v; return; }
    for (let i = start; i <= n - (5 - pick.length); i++) { pick.push(cs[i]); rec(i + 1); pick.pop(); }
  };
  rec(0);
  return best;
}

export const categoryOf = (score: number) => Math.floor(score / 16 ** 5);
export const handName = (score: number) => CATEGORY_NAMES[categoryOf(score)];

/** 不足 5 张时（翻牌前）的描述 */
export function describeHand(cs: Card[]): string {
  if (cs.length >= 5) return handName(evaluate(cs));
  if (cs.length === 2) return rankOf(cs[0]) === rankOf(cs[1]) ? '一对' : '高牌';
  return '';
}
