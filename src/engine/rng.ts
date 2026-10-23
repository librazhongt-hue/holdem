/** mulberry32：状态即 32 位整数，纯函数式推进 */
export function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [v, s >>> 0];
}

export function shuffle<T>(arr: T[], seed: number): [T[], number] {
  const a = arr.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    const [r, ns] = nextRandom(s);
    s = ns;
    const j = Math.floor(r * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return [a, s];
}

/** 给引擎之外（AI/模拟）用的可变 RNG */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    const [v, ns] = nextRandom(s);
    s = ns;
    return v;
  };
}
