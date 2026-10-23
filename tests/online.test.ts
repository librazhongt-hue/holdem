import { describe, it, expect } from 'vitest';
import { MemoryNet, FakeScheduler } from '../src/net/memory';
import { DEFAULT_ROOM, HOST_CONN, type HostMsg } from '../src/net/protocol';

const cfg = { ...DEFAULT_ROOM, maxPlayers: 4, aiDelayMs: [10, 20] as [number, number], nextHandDelayMs: 50 };

function setup() {
  const s = new FakeScheduler();
  const net = new MemoryNet(s);
  const host = net.createHost('123456', cfg, 7);
  const a = net.addClient('cA', '小A');
  const b = net.addClient('cB', '小B');
  return { s, net, host, a, b };
}
/** 让所有人类自动跟/过牌 */
function autoplay(net: MemoryNet) {
  const host = net.host;
  const g = host.game!;
  const h = g.hand!;
  if (h.street === 'complete') return;
  const p = g.players[h.toAct];
  const canCheck = h.bets[h.toAct] >= h.currentBet;
  const action = { type: canCheck ? 'check' : 'call', playerId: p.id } as const;
  if (p.id === host.hostId) host.hostAct(action);
  else for (const [, c] of net.clients) if (c.room.cred.playerId === p.id && c.online) c.room.act(action);
}

describe('联机：房间 / 入座 / 开局', () => {
  it('加入、AI 补位、开局后锁定设置与禁止新加入', () => {
    const { net, host, a } = setup();
    expect(a.status).toBe('lobby');
    expect(host.seats.map((x) => x.kind)).toEqual(['human', 'human', 'human']);
    host.setConfig({ publicProfit: false });
    host.start();
    expect(host.seats.length).toBe(4);
    expect(host.seats[3].kind).toBe('ai');
    expect(() => host.setConfig({ maxPlayers: 5 })).toThrow();
    const late = net.addClient('cC', '迟到');
    expect(late.status).toBe('closed');
    expect(late.closedReason).toContain('已开始');
  });
  it('房间满员拒绝', () => {
    const s = new FakeScheduler(); const net = new MemoryNet(s);
    net.createHost('1', { ...cfg, maxPlayers: 2 });
    net.addClient('c1', 'x');
    expect(net.addClient('c2', 'y').closedReason).toBe('房间已满');
  });
});

describe('联机：信息安全', () => {
  it('客户端从不收到 seed / 牌堆 / 他人底牌', () => {
    const { s, net, host } = setup();
    host.start();
    for (let i = 0; i < 400; i++) { autoplay(net); s.advance(30); }
    expect(host.game!.handNo).toBeGreaterThan(5);
    for (const { to, msg } of net.log) {
      const j = JSON.stringify(msg);
      expect(j).not.toContain('"seed"');
      expect(j).not.toContain('"deck"');
      if (msg.t !== 'room' || !msg.view?.hand) continue;
      const v = msg.view;
      const showdown = v.hand!.result?.shown ?? {};
      v.hand!.holes.forEach((hc, i) => {
        if (i !== v.mySeat && !showdown[v.players[i].id]) expect(hc).toBeNull();
      });
      // 默认只看到自己的买入/盈亏
      v.players.forEach((p, i) => { if (i !== v.mySeat) expect(p.totalBuyIn).toBeUndefined(); });
      void to;
    }
  });
  it('公开他人盈亏开关', () => {
    const s = new FakeScheduler(); const net = new MemoryNet(s);
    const host = net.createHost('1', { ...cfg, publicProfit: true });
    const a = net.addClient('c1', 'x');
    host.start();
    expect(a.view!.players.every((p) => p.totalBuyIn !== undefined)).toBe(true);
  });
});

describe('联机：去重 / 防冒名 / 超时', () => {
  it('(playerId, handNo, actionSeq) 去重；不能替他人行动', () => {
    const { net, host } = setup();
    host.start();
    const g = host.game!;
    const toAct = g.players[g.hand!.toAct];
    const seq = g.hand!.actionSeq;
    const other = [...net.clients.entries()].find(([, c]) => c.room.cred.playerId !== toAct.id)!;
    host.onMessage(other[0], { t: 'action', action: { type: 'fold', playerId: toAct.id }, handNo: 1, actionSeq: seq });
    expect(host.game!.hand!.actionSeq).toBe(seq);
    const conn = toAct.id === host.hostId ? HOST_CONN : [...net.clients.entries()].find(([, c]) => c.room.cred.playerId === toAct.id)?.[0];
    if (!conn) return; // AI 首动时跳过
    const m = { t: 'action', action: { type: 'call', playerId: toAct.id }, handNo: 1, actionSeq: seq } as const;
    host.onMessage(conn, m); host.onMessage(conn, m);
    expect(host.game!.hand!.actionSeq).toBe(seq + 1);
  });
  it('30s 超时自动过牌/弃牌，截止时间来自房主时钟', () => {
    const { s, host, a } = setup();
    host.start();
    // 推进到轮到人类
    for (let i = 0; i < 50 && host.seats.find((x) => x.playerId === host.game!.players[host.game!.hand!.toAct].id)!.kind === 'ai'; i++) s.advance(25);
    const seq = host.game!.hand!.actionSeq;
    const left = host.deadline! - s.now();
    expect(left).toBeGreaterThan(29900); expect(left).toBeLessThanOrEqual(30000);
    expect(a.localDeadline()).toBe(host.deadline); // 假时钟下无漂移
    s.advance(left - 1);
    expect(host.game!.hand!.actionSeq).toBe(seq);
    s.advance(2);
    expect(host.game!.hand!.actionSeq).toBe(seq + 1);
    const last = host.game!.hand!.log.filter((l) => l.kind === 'check' || l.kind === 'fold').pop();
    expect(last).toBeTruthy();
  });
});

describe('联机：断线 / 重连 / 重买', () => {
  it('断线保留座位，重连拿到全新过滤快照（含自己的底牌）', () => {
    const { s, net, host, a } = setup();
    host.start();
    const pid = a.cred.playerId!;
    const cred = { ...a.cred };
    net.drop('cA');
    expect(host.seats.find((x) => x.playerId === pid)!.connected).toBe(false);
    s.advance(65000); // 期间超时照常推进
    expect(host.game!.players.some((p) => p.id === pid)).toBe(true);
    const a2 = net.addClient('cA2', '小A', undefined, cred);
    expect(a2.cred.playerId).toBe(pid);
    expect(a2.view!.mySeat).toBe(host.game!.players.findIndex((p) => p.id === pid));
    expect(host.seats.find((x) => x.playerId === pid)!.connected).toBe(true);
    if (host.game!.hand!.inHand[a2.view!.mySeat]) expect(a2.view!.hand!.holes[a2.view!.mySeat]).not.toBeNull();
  });
  it('错误 token 不能冒名重连', () => {
    const { net, host, a } = setup();
    host.start();
    const evil = net.addClient('cE', '坏人', undefined, { playerId: a.cred.playerId, token: 'wrong' });
    expect(evil.status).toBe('closed');
  });
  it('重买经房主确认，下一手生效', () => {
    const { s, host, a } = setup();
    host.start();
    const pid = a.cred.playerId!;
    const p = host.game!.players.find((x) => x.id === pid)!;
    // 强制该玩家筹码归零并结束本手
    host.game!.hand!.street = 'complete'; p.stack = 0;
    a.view = { ...a.view!, handNo: host.game!.handNo };
    a.act({ type: 'rebuy', playerId: pid });
    const q = host.game!.players.find((x) => x.id === pid)!;
    expect(q.pendingRebuy).toBe(true);
    expect(q.buyIns).toBe(2);
    s.advance(100);
    expect(host.game!.players.find((x) => x.id === pid)!.stack + host.game!.hand!.committed[host.game!.players.findIndex((x) => x.id === pid)]).toBe(1000);
  });
  it('房主失联：客户端进入重连，超过等待窗口后关闭', () => {
    const s = new FakeScheduler(); const net = new MemoryNet(s);
    const host = net.createHost('1', cfg);
    const a = net.addClient('c1', 'x', { hostWaitMs: 120000, staleMs: 6000 });
    host.start();
    net.hostUp = false; host.close = () => {};
    for (let t = 0; t < 10; t++) { s.advance(1000); a.heartbeat(); }
    expect(a.status).toBe('reconnecting');
    for (let t = 0; t < 125; t++) { s.advance(1000); a.heartbeat(); }
    expect(a.status).toBe('closed');
    expect(a.closedReason).toBe('房主已离线，房间关闭');
  });
  it('房主 120s 内回来：客户端恢复', () => {
    const s = new FakeScheduler(); const net = new MemoryNet(s);
    const host = net.createHost('1', cfg);
    const a = net.addClient('c1', 'x');
    host.start();
    net.hostUp = false;
    for (let t = 0; t < 30; t++) { s.advance(1000); a.heartbeat(); }
    expect(a.status).toBe('reconnecting');
    net.hostUp = true;
    s.advance(3000);
    expect(a.status).toBe('playing');
  });
  it('50 手稳定：3 人类 + 1 AI，筹码守恒', () => {
    const { s, net, host } = setup();
    host.start();
    let guard = 0;
    while (host.game!.handNo < 51 && guard++ < 100000) {
      autoplay(net); s.advance(15);
      for (const p of host.game!.players) if (p.stack === 0 && !p.pendingRebuy && host.game!.hand!.street === 'complete') host.onMessage(p.id === host.hostId ? HOST_CONN : [...net.clients.entries()].find(([, c]) => c.room.cred.playerId === p.id)?.[0] ?? 'x', { t: 'action', action: { type: 'rebuy', playerId: p.id }, handNo: host.game!.handNo, actionSeq: host.game!.hand!.actionSeq });
    }
    expect(host.game!.handNo).toBeGreaterThanOrEqual(51);
    const g = host.game!;
    const total = g.players.reduce((x, p) => x + p.stack, 0) + (g.hand!.street !== 'complete' ? g.hand!.committed.reduce((x, y) => x + y, 0) : 0);
    expect(total).toBe(g.players.reduce((x, p) => x + p.totalBuyIn, 0));
    const msgs: HostMsg[] = net.hostInbox;
    expect(msgs.length).toBeGreaterThan(100);
  });
});
