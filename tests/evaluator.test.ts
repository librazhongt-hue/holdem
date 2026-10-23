import { describe, it, expect } from 'vitest';
import { evaluate, evaluateBrute, handName, cards, makeRng, shuffle, fullDeck } from '../src/engine';
const ev = (s: string) => evaluate(cards(s));
describe('牌力评估', () => {
  it('识别全部牌型', () => {
    expect(handName(ev('As Ks Qs Js Ts 2d 3c'))).toBe('皇家同花顺');
    expect(handName(ev('9s Ks Qs Js Ts 2d 3c'))).toBe('同花顺');
    expect(handName(ev('9s 9d 9h 9c Ts 2d 3c'))).toBe('四条');
    expect(handName(ev('9s 9d 9h Tc Ts 2d 3c'))).toBe('葫芦');
    expect(handName(ev('2s 7s 9s Js Ks 2d 3c'))).toBe('同花');
    expect(handName(ev('5s 6d 7h 8c 9s 2d Kc'))).toBe('顺子');
    expect(handName(ev('9s 9d 9h 2c Ts 4d Kc'))).toBe('三条');
    expect(handName(ev('9s 9d Th 2c Ts 4d Kc'))).toBe('两对');
    expect(handName(ev('9s 9d Ah 2c Ts 4d Kc'))).toBe('一对');
    expect(handName(ev('9s 7d Ah 2c Ts 4d Kc'))).toBe('高牌');
  });
  it('A-2-3-4-5 为最小顺子', () => {
    expect(ev('As 2d 3h 4c 5s')).toBeLessThan(ev('2s 3d 4h 5c 6s'));
    expect(handName(ev('As 2d 3h 4c 5s'))).toBe('顺子');
    expect(handName(ev('As 2s 3s 4s 5s'))).toBe('同花顺');
    expect(ev('As 2s 3s 4s 5s')).toBeLessThan(ev('2s 3s 4s 5s 6s'));
  });
  it('kicker 依次比较 / 平局', () => {
    expect(ev('As Ad Kh Qc 9s')).toBeGreaterThan(ev('Ah Ac Kd Qs 8s'));
    expect(ev('As Ad Kh Qc 9s')).toBe(ev('Ah Ac Kd Qs 9d'));
    expect(ev('Ks Kd 3h 3c As')).toBeGreaterThan(ev('Kh Kc 3d 3s Qs'));
    expect(ev('Ts Td Th 2c 2s')).toBeGreaterThan(ev('9s 9d 9h Ac As'));
    expect(ev('As Js 9s 5s 3s')).toBeGreaterThan(ev('Ks Qs Js 9s 7s'));
    // 公共牌即最大牌型 → 平局
    expect(ev('2c 3d As Ks Qs Js Ts')).toBe(ev('4c 5d As Ks Qs Js Ts'));
  });
  it('7 张选最优（三条+三条=葫芦，三对取两大对）', () => {
    expect(handName(ev('9s 9d 9h 4c 4s 4d Kc'))).toBe('葫芦');
    expect(ev('9s 9d 4h 4c Ks Kd 2c')).toBe(ev('9h 9c Kh Kc 4s 2d 3s'));
  });
});

describe('快速评估器与 21 组合枚举一致', () => {
  it('随机 20000 手 5/6/7 张', () => {
    let seed = 1;
    for (let i = 0; i < 20000; i++) {
      const [d, ns] = shuffle(fullDeck(), seed); seed = ns;
      const k = 5 + (i % 3);
      expect(evaluate(d.slice(0, k))).toBe(evaluateBrute(d.slice(0, k)));
    }
    void makeRng;
  });
});
