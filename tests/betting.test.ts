import { describe, it, expect } from 'vitest';
import { legalActions, reduce, totalChips } from '../src/engine';
import { game, act, A } from './helpers';

describe('单挑行动顺序', () => {
  it('按钮=SB，翻前先动；翻后 BB 先动', () => {
    let g = reduce(game([1000, 1000], { button: 0 }), { type: 'startHand' });
    const h = g.hand!;
    expect(h.button).toBe(0); expect(h.sbSeat).toBe(0); expect(h.bbSeat).toBe(1);
    expect(h.bets).toEqual([10, 20]);
    expect(h.toAct).toBe(0);
    g = act(g, A('call', 'p0'));
    expect(g.hand!.toAct).toBe(1); // BB option
    expect(legalActions(g, 'p1')!.canRaise).toBe(true);
    g = act(g, A('check', 'p1'));
    expect(g.hand!.street).toBe('flop');
    expect(g.hand!.toAct).toBe(1);
  });
  it('按钮每手移动', () => {
    let g = reduce(game([1000, 1000, 1000], { button: 0 }), { type: 'startHand' });
    expect([g.hand!.button, g.hand!.sbSeat, g.hand!.bbSeat, g.hand!.toAct]).toEqual([0, 1, 2, 0]);
    g = act(g, A('fold', 'p0'), A('fold', 'p1'));
    g = reduce(g, { type: 'startHand' });
    expect([g.hand!.button, g.hand!.sbSeat, g.hand!.bbSeat, g.hand!.toAct]).toEqual([1, 2, 0, 1]);
  });
  it('多人翻后由按钮左手第一位活跃玩家先动', () => {
    let g = reduce(game([1000, 1000, 1000, 1000], { button: 0 }), { type: 'startHand' });
    g = act(g, A('call', 'p3'), A('call', 'p0'), A('fold', 'p1'), A('check', 'p2'));
    expect(g.hand!.street).toBe('flop');
    expect(g.hand!.toAct).toBe(2); // SB(p1) 已弃牌 → p2
  });
});

describe('最小加注', () => {
  it('最小加注 = 上次加注增量且 ≥ BB', () => {
    let g = reduce(game([1000, 1000, 1000], { button: 0 }), { type: 'startHand' });
    expect(legalActions(g, 'p0')!.minRaiseTo).toBe(40);
    expect(() => act(g, A('raise', 'p0', 30))).toThrow();
    g = act(g, A('raise', 'p0', 70)); // 增量 50
    expect(legalActions(g, 'p1')!.minRaiseTo).toBe(120);
    g = act(g, A('raise', 'p1', 120));
    expect(legalActions(g, 'p2')!.minRaiseTo).toBe(170);
  });
  it('翻后开局下注最小为 BB', () => {
    let g = reduce(game([1000, 1000], { button: 0 }), { type: 'startHand' });
    g = act(g, A('call', 'p0'), A('check', 'p1'));
    const l = legalActions(g, 'p1')!;
    expect(l.isOpenBet).toBe(true); expect(l.minRaiseTo).toBe(20);
    expect(() => act(g, A('bet', 'p1', 10))).toThrow();
  });
});

describe('不足额 all-in 不重开加注权', () => {
  it('已行动者只能跟注/弃牌', () => {
    let g = reduce(game([1000, 1000, 130], { button: 0 }), { type: 'startHand' });
    // p0 BTN raise to 100 (增量80)，p1 SB call，p2 BB all-in 130（增量30 < 80）
    g = act(g, A('raise', 'p0', 100), A('call', 'p1'), A('allin', 'p2'));
    expect(g.hand!.currentBet).toBe(130);
    const l = legalActions(g, 'p0')!;
    expect(l.canRaise).toBe(false);
    expect(l.callAmount).toBe(30);
    expect(() => act(g, A('raise', 'p0', 300))).toThrow();
    g = act(g, A('call', 'p0'));
    expect(legalActions(g, 'p1')!.canRaise).toBe(false);
  });
  it('未行动者仍可加注；完整加注 all-in 重开', () => {
    let g = reduce(game([1000, 1000, 1000, 200], { button: 0 }), { type: 'startHand' });
    // p3 UTG raise 60（增量40），p0 all-in? p0 1000; 让 p3 短:
    g = act(g, A('raise', 'p3', 60));
    g = act(g, A('call', 'p0'));
    // p1 SB 未行动 → 可加注
    expect(legalActions(g, 'p1')!.canRaise).toBe(true);
    g = act(g, A('raise', 'p1', 100)); // 增量40 = 完整加注
    g = act(g, A('call', 'p2'));
    // p3 剩 140 筹码，全下 200 ：增量 100 ≥ 40 → 完整加注，重开
    g = act(g, A('allin', 'p3'));
    expect(legalActions(g, 'p0')!.canRaise).toBe(true);
  });
  it('多个短 all-in 累计达完整加注则重开', () => {
    let g = reduce(game([150, 190, 1000, 1000, 1000], { button: 0 }), { type: 'startHand' });
    // 顺序：UTG p3, p4, BTN p0, SB p1, BB p2
    g = act(g, A('raise', 'p3', 100), A('call', 'p4')); // 完整加注增量 80
    g = act(g, A('allin', 'p0')); // 150，短 all-in（+50）
    expect(g.hand!.minRaise).toBe(80);
    g = act(g, A('allin', 'p1')); // 190，短 all-in（+40），累计 +90 ≥ 80
    g = act(g, A('fold', 'p2'));
    expect(g.hand!.toAct).toBe(3);
    expect(legalActions(g, 'p3')!.canRaise).toBe(true);
  });
  it('单个短 all-in 不足完整加注时不重开', () => {
    let g = reduce(game([150, 1000, 1000, 1000, 1000], { button: 0 }), { type: 'startHand' });
    g = act(g, A('raise', 'p3', 100), A('call', 'p4'), A('allin', 'p0'), A('fold', 'p1'), A('fold', 'p2'));
    expect(g.hand!.toAct).toBe(3);
    expect(legalActions(g, 'p3')!.canRaise).toBe(false);
    expect(legalActions(g, 'p3')!.callAmount).toBe(50);
  });
  it('筹码不足跟注时只能 all-in，视为有效跟注', () => {
    let g = reduce(game([1000, 1000, 50], { button: 0 }), { type: 'startHand' });
    g = act(g, A('raise', 'p0', 200), A('fold', 'p1'));
    const l = legalActions(g, 'p2')!;
    expect(l.callAmount).toBe(30); expect(l.canRaise).toBe(false);
    g = act(g, A('allin', 'p2'));
    expect(g.hand!.street).toBe('complete'); // 自动发完
    expect(totalChips(g)).toBe(2050);
  });
});

describe('未跟注部分退回', () => {
  it('弃牌获胜时退回多余下注', () => {
    let g = reduce(game([1000, 1000], { button: 0 }), { type: 'startHand' });
    g = act(g, A('raise', 'p0', 500), A('fold', 'p1'));
    expect(g.players[0].stack).toBe(1020);
    expect(g.players[1].stack).toBe(980);
  });
  it('大筹码 all-in 对小筹码只计入可跟部分', () => {
    let g = reduce(game([1000, 300], { button: 0 }), { type: 'startHand' });
    g = act(g, A('allin', 'p0'), A('call', 'p1'));
    expect(g.hand!.committed).toEqual([300, 300]);
    expect(g.players[0].stack + g.players[1].stack).toBe(1300);
  });
});

describe('错误行动', () => {
  it('非当前玩家行动被拒绝', () => {
    const g = reduce(game([1000, 1000, 1000], { button: 0 }), { type: 'startHand' });
    expect(() => act(g, A('call', 'p1'))).toThrow();
    expect(() => act(g, A('check', 'p0'))).toThrow();
  });
});
