import type { Difficulty, PlayerConfig } from '../engine/types';
import { PERSONALITIES } from './ai';

const NAMES = ['阿龙', '小美', '老王', '大熊', '静静', '阿杰', '老K', '飞鱼', '团子', '铁头', '小雨', '豆豆'];

export function makeRoster(humanName: string, total: number, difficulty: Difficulty, rng: () => number): PlayerConfig[] {
  const keys = Object.keys(PERSONALITIES);
  const names = NAMES.slice().sort(() => rng() - 0.5);
  const list: PlayerConfig[] = [{ id: 'p0', name: humanName, isBot: false }];
  for (let i = 1; i < total; i++) {
    const k = keys[Math.floor(rng() * keys.length)];
    const { label: _l, ...pers } = PERSONALITIES[k];
    list.push({ id: 'p' + i, name: names[i - 1], isBot: true, personality: pers, difficulty, style: k });
  }
  return list;
}
