import { describe, it, expect } from 'vitest';
import { buildPots, splitPot, reduce, totalChips } from '../src/engine';
import { game, act, A, rig } from './helpers';

describe('边池构建', () => {
  it('分层 + 弃牌者无资格', () => {
    const pots = buildPots([100, 300, 500, 500], [true, true, true, false]);
    // 层100: 4*100=400 [0,1,2]; 层300: 3*200=600 [1,2]; 层500: 2*200=400 [2]
    expect(pots).toEqual([
      { amount: 400, eligible: [0, 1, 2] },
      { amount: 600, eligible: [1, 2] },
      { amount: 400, eligible: [2] },
    ]);
  });
  it('弃牌者的钱进入对应层', () => {
    expect(buildPots([50, 200, 200], [false, true, true])).toEqual([{ amount: 450, eligible: [1, 2] }]);
  });
});

describe('边池分配实战', () => {
  it('短筹码赢主池，边池给次优', () => {
    let g = reduce(game([100, 500, 500], { button: 0 }), { type: 'startHand' });
    g = rig(g, ['As Ad', 'Ks Kd', 'Qs Qd'], '2c 7h 9d 3s 4c');
    g = act(g, A('allin', 'p0'), A('call', 'p1'), A('call', 'p2'));
    // flop: p1 bet 200, p2 call
    g = act(g, A('bet', 'p1', 200), A('call', 'p2'), A('check', 'p1'), A('check', 'p2'), A('check', 'p1'), A('check', 'p2'));
    const r = g.hand!.result!;
    expect(r.pots[0]).toMatchObject({ amount: 300, winners: ['p0'] });
    expect(r.pots[1]).toMatchObject({ amount: 400, winners: ['p1'] });
    expect(g.players.map((p) => p.stack)).toEqual([300, 600, 200]);
    expect(totalChips(g)).toBe(1100);
  });
});

describe('零头规则', () => {
  it('不可整除零头给按钮左手第一位有资格者', () => {
    expect([...splitPot(101, [0, 2], 0, 3)]).toEqual([[2, 51], [0, 50]]);
    expect([...splitPot(101, [0, 2], 1, 3)].find(([s]) => s === 2)![1]).toBe(51);
    expect([...splitPot(100, [1, 2, 0], 2, 3)]).toEqual([[0, 34], [1, 33], [2, 33]]);
  });
  it('实战平分奇数底池', () => {
    // SB 5 / BB 10，3 人：BTN p0 弃，SB p1 跟到10... 构造奇数池：p0 折叠前投入 5?
    let g = reduce(game([1000, 1000, 1000], { sb: 5, bb: 10, button: 0 }), { type: 'startHand' });
    g = rig(g, ['2c 3d', 'Ah Kd', 'As Kc'], 'Qs Js Th 4d 5c');
    // p0 call 10 再弃 → 死钱让底池为奇数需 p0 投入奇数：p0 raise 25 后弃
    g = act(g, A('raise', 'p0', 25), A('call', 'p1'), A('call', 'p2'));
    g = act(g, A('bet', 'p1', 13), A('call', 'p2'), A('fold', 'p0'));
    g = act(g, A('check', 'p1'), A('check', 'p2'), A('check', 'p1'), A('check', 'p2'));
    const r = g.hand!.result!;
    // 底池 25*3 + 13*2 = 101，p1/p2 顺子平分；按钮 p0 左手第一位为 p1 → 51
    expect(r.pots.reduce((a, p) => a + p.amount, 0)).toBe(101);
    expect(r.payouts).toEqual({ p1: 51, p2: 50 });
  });
});
