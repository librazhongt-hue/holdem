import { describe, it, expect } from 'vitest';
import { reduce, viewFor } from '../src/engine';
import { game, act, A } from './helpers';
import { MemoryNet, FakeScheduler } from '../src/net/memory';
import { DEFAULT_ROOM } from '../src/net/protocol';

describe('每手结束后显示所有人手牌', () => {
  it('进行中绝不公开；弃牌结束后公开全部（含弃牌者）', () => {
    let g = reduce(game([1000, 1000, 1000], { button: 0 }), { type: 'startHand' });
    g = act(g, A('fold', 'p0'));
    const live = viewFor(g, 'p1', { revealAll: true });
    expect(live.hand!.holes.filter(Boolean).length).toBe(1);
    g = act(g, A('fold', 'p1')); // p2 弃牌胜
    expect(g.hand!.street).toBe('complete');
    const v = viewFor(g, 'p1', { revealAll: true });
    expect(v.hand!.holes.every((h) => h && h.length === 2)).toBe(true);
    expect(v.hand!.folded).toEqual([true, true, false]);
    // 关闭时仍只看到自己
    expect(viewFor(g, 'p1').hand!.holes.filter(Boolean).length).toBe(1);
  });
  it('联机：开局后不可改；手牌进行中消息不泄露，结束后公开', () => {
    const s = new FakeScheduler(); const net = new MemoryNet(s);
    const host = net.createHost('1', { ...DEFAULT_ROOM, maxPlayers: 3, revealAll: true, aiDelayMs: [5, 10], nextHandDelayMs: 50 });
    net.addClient('c1', 'a');
    host.start();
    expect(() => host.setConfig({ revealAll: false })).toThrow();
    let sawReveal = false;
    for (let i = 0; i < 3000 && host.game!.handNo < 6; i++) {
      const g = host.game!, h = g.hand!;
      if (h.street !== 'complete') {
        const p = g.players[h.toAct];
        const can = h.bets[h.toAct] >= h.currentBet;
        if (p.id === host.hostId) host.hostAct({ type: can ? 'check' : 'fold', playerId: p.id });
        else net.clients.get('c1')!.room.act({ type: can ? 'check' : 'fold', playerId: p.id });
      }
      s.advance(20);
    }
    for (const { msg } of net.log) {
      if (msg.t !== 'room' || !msg.view?.hand) continue;
      const v = msg.view, h = v.hand!;
      const visible = h.holes.filter(Boolean).length;
      if (h.street !== 'complete') {
        const shown = Object.keys(h.result?.shown ?? {}).length;
        expect(visible).toBeLessThanOrEqual(1 + shown);
      } else if (visible === h.inHand.filter(Boolean).length && h.folded.some(Boolean)) sawReveal = true;
    }
    expect(sawReveal).toBe(true);
  });
});
