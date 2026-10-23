export interface Pot { amount: number; eligible: number[] }

/** 按累计投入分层构建主池/边池；弃牌者的钱进池但无分配资格。相邻资格相同的层合并。 */
export function buildPots(committed: number[], contending: boolean[]): Pot[] {
  const levels = [...new Set(committed.filter((c, i) => c > 0 && contending[i]))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const lv of levels) {
    let amount = 0;
    for (const c of committed) amount += Math.max(0, Math.min(c, lv) - prev);
    const eligible = committed.map((c, i) => (contending[i] && c >= lv ? i : -1)).filter((i) => i >= 0);
    const last = pots[pots.length - 1];
    if (last && last.eligible.length === eligible.length && last.eligible.every((e, k) => e === eligible[k])) last.amount += amount;
    else if (amount > 0) pots.push({ amount, eligible });
    prev = lv;
  }
  // 弃牌者投入超过所有在局者最高层的部分（理论上已被退回，保底并入最后一池）
  const total = committed.reduce((a, b) => a + b, 0);
  const counted = pots.reduce((a, p) => a + p.amount, 0);
  if (total > counted && pots.length) pots[pots.length - 1].amount += total - counted;
  return pots;
}

/** 池内平分；零头按"按钮左手起第一位有资格的赢家"依次各给 1 */
export function splitPot(amount: number, winners: number[], button: number, n: number): Map<number, number> {
  const order = [...winners].sort((a, b) => ((a - button - 1 + n) % n) - ((b - button - 1 + n) % n));
  const base = Math.floor(amount / order.length);
  let rem = amount - base * order.length;
  const m = new Map<number, number>();
  for (const w of order) {
    m.set(w, base + (rem > 0 ? 1 : 0));
    if (rem > 0) rem--;
  }
  return m;
}
