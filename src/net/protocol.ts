/**
 * 联机协议与房主权威端（传输无关）。
 * 安全原则：房主是唯一持有完整 GameState（含 seed / 牌堆 / 全部底牌）的一方。
 * 客户端永远只收到 viewFor() 过滤后的视角 + 公开事件，绝不下发 seed——
 * 否则持有 seed 的客户端可以本地重算洗牌，得到所有人的底牌。
 */
import type { Action, BetAction, Difficulty, GameState, LogEntry, PlayerConfig } from '../engine/types';
import { reduce, createGame, EngineError } from '../engine/engine';
import { viewFor, type PlayerView } from '../engine/view';
import { makeRng } from '../engine/rng';
import { decide } from '../ai/ai';
import { makeRoster } from '../ai/roster';

// ---------------- 消息 ----------------
export type ClientMsg =
  | { t: 'hello'; name: string; playerId?: string; token?: string }
  | { t: 'action'; action: BetAction | { type: 'rebuy'; playerId: string }; handNo: number; actionSeq: number }
  | { t: 'ping' }
  | { t: 'leave' };

export interface RoomConfig {
  maxPlayers: number;
  stakeId: string; stakeLabel: string; sb: number; bb: number; stack: number;
  difficulty: Difficulty;
  publicProfit: boolean;
  /** 每手结束后向所有人公开全部底牌 */
  revealAll: boolean;
  rebuy: boolean;
  /** 联机强制开启，默认 30s */
  timeoutSec: number;
  aiDelayMs: [number, number];
  /** AI 速度档（决定 aiDelayMs） */
  aiSpeed?: 'fast' | 'normal' | 'slow';
  /** 换街后 AI 额外停顿 */
  streetPauseMs?: number;
  nextHandDelayMs: number;
}
export interface SeatInfo { playerId: string; name: string; kind: 'human' | 'ai'; connected: boolean; isHost: boolean }
export interface RoomInfo {
  code: string; phase: 'lobby' | 'playing' | 'closed';
  config: RoomConfig; seats: SeatInfo[];
  /** 当前行动截止时间（房主时钟） */
  deadline: number | null;
}
export type HostMsg =
  | { t: 'welcome'; playerId: string; token: string }
  | { t: 'room'; seq: number; room: RoomInfo; view: PlayerView | null; event?: PublicEvent; serverTime: number }
  | { t: 'reject'; reason: string; handNo?: number; actionSeq?: number }
  | { t: 'closed'; reason: string }
  | { t: 'pong'; serverTime: number };

/** 公开事件：不含任何未公开底牌 */
export type PublicEvent = { kind: 'action'; entry: LogEntry } | { kind: 'handStart'; handNo: number } | { kind: 'rebuy'; playerId: string } | { kind: 'start' } | { kind: 'seat' };

export interface Transport { send(connId: string, msg: HostMsg): void; close?(connId: string): void }
export interface Scheduler { now(): number; set(fn: () => void, ms: number): unknown; clear(h: unknown): void }
export const realScheduler: Scheduler = { now: () => Date.now(), set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as number) };

export const DEFAULT_ROOM: RoomConfig = {
  maxPlayers: 6, stakeId: 'standard', stakeLabel: '标准场', sb: 10, bb: 20, stack: 1000, difficulty: 'normal',
  publicProfit: false, revealAll: false, rebuy: true, timeoutSec: 30, aiDelayMs: [2000, 3000], aiSpeed: 'normal', streetPauseMs: 800, nextHandDelayMs: 3000,
};

interface Seat extends SeatInfo { token: string; connId: string | null; lastSeen: number }
export const HOST_CONN = 'local';
const randToken = (rng: () => number) => Math.floor(rng() * 2 ** 32).toString(36) + Math.floor(rng() * 2 ** 32).toString(36);

export interface HostSnapshot { code: string; phase: RoomInfo['phase']; config: RoomConfig; seats: Seat[]; game: GameState | null; seen: string[]; seq: number; savedAt: number }

/**
 * 房主权威端：持有完整状态，驱动 AI / 超时 / 下一手，按连接逐个下发过滤视角。
 * 本地房主自身走 HOST_CONN 这条“连接”，与客户端完全同一路径（无 you/ai 特判）。
 */
export class HostRoom {
  phase: RoomInfo['phase'] = 'lobby';
  seats: Seat[] = [];
  game: GameState | null = null;
  deadline: number | null = null;
  private seq = 0;
  private seen = new Set<string>();
  private timer: unknown = null;
  private rng: () => number;
  private conns = new Map<string, string>(); // connId → playerId

  constructor(
    public code: string, public config: RoomConfig, hostName: string,
    private transport: Transport, private sched: Scheduler, private seed: number,
    snap?: HostSnapshot,
  ) {
    this.rng = makeRng(seed ^ 0xa5a5a5a5);
    if (snap) {
      Object.assign(this, { phase: snap.phase, config: snap.config, game: snap.game, seq: snap.seq });
      this.seats = snap.seats.map((s) => ({ ...s, connected: s.isHost || s.kind === 'ai', connId: s.isHost ? HOST_CONN : null }));
      this.seen = new Set(snap.seen);
      this.conns.set(HOST_CONN, this.seats.find((s) => s.isHost)!.playerId);
      this.schedule();
    } else {
      this.seats.push({ playerId: 'h0', name: hostName, kind: 'human', connected: true, isHost: true, token: randToken(this.rng), connId: HOST_CONN, lastSeen: sched.now() });
      this.conns.set(HOST_CONN, 'h0');
    }
  }

  get hostId() { return this.seats.find((s) => s.isHost)!.playerId; }

  snapshot(): HostSnapshot {
    return { code: this.code, phase: this.phase, config: this.config, seats: this.seats, game: this.game, seen: [...this.seen].slice(-500), seq: this.seq, savedAt: this.sched.now() };
  }

  roomInfo(): RoomInfo {
    return { code: this.code, phase: this.phase, config: this.config, deadline: this.deadline, seats: this.seats.map(({ playerId, name, kind, connected, isHost }) => ({ playerId, name, kind, connected, isHost })) };
  }

  // ---------- 房主操作 ----------
  setConfig(c: Partial<RoomConfig>) {
    if (this.phase !== 'lobby') throw new EngineError('开局后不可修改房间设置');
    const next = { ...this.config, ...c };
    if (next.maxPlayers < this.seats.length) throw new EngineError('人数不能少于已入座玩家');
    if (next.maxPlayers < 2 || next.maxPlayers > 10) throw new EngineError('人数需在 2~10 之间');
    next.timeoutSec = Math.max(1, next.timeoutSec || 30); // 联机强制超时
    this.config = next;
    this.broadcast({ kind: 'seat' });
  }

  start() {
    if (this.phase !== 'lobby') return;
    const c = this.config;
    const humans: PlayerConfig[] = this.seats.map((s) => ({ id: s.playerId, name: s.name, isBot: false }));
    const ai = makeRoster('x', c.maxPlayers - humans.length + 1, c.difficulty, this.rng).slice(1).map((p, i) => ({ ...p, id: 'ai' + i, name: p.name + '(AI)' }));
    for (const a of ai) this.seats.push({ playerId: a.id, name: a.name, kind: 'ai', connected: true, isHost: false, token: '', connId: null, lastSeen: 0 });
    this.game = createGame({ stakeId: c.stakeId, sb: c.sb, bb: c.bb, startingStack: c.stack, rebuy: c.rebuy }, [...humans, ...ai], this.seed);
    this.phase = 'playing';
    this.game = reduce(this.game, { type: 'startHand' });
    this.broadcast({ kind: 'start' });
    this.schedule();
  }

  close(reason = '房主已关闭房间') {
    this.phase = 'closed';
    this.sched.clear(this.timer);
    for (const s of this.seats) if (s.connId && s.connId !== HOST_CONN) this.transport.send(s.connId, { t: 'closed', reason });
  }

  // ---------- 连接 ----------
  onMessage(connId: string, msg: ClientMsg) {
    const now = this.sched.now();
    const pid = this.conns.get(connId);
    const seat = pid ? this.seats.find((s) => s.playerId === pid) : undefined;
    if (seat) seat.lastSeen = now;
    switch (msg.t) {
      case 'ping':
        this.transport.send(connId, { t: 'pong', serverTime: now });
        if (seat && !seat.connected) { seat.connected = true; this.broadcast({ kind: 'seat' }); }
        return;
      case 'hello':
        return this.hello(connId, msg);
      case 'leave':
        return this.onDisconnect(connId);
      case 'action':
        if (!seat) return this.transport.send(connId, { t: 'reject', reason: '未入座' });
        return this.receiveAction(seat.playerId, msg);
    }
  }

  private hello(connId: string, msg: Extract<ClientMsg, { t: 'hello' }>) {
    if (this.phase === 'closed') return this.transport.send(connId, { t: 'closed', reason: '房间已关闭' });
    let seat = msg.playerId ? this.seats.find((s) => s.playerId === msg.playerId && s.kind === 'human' && !s.isHost) : undefined;
    if (seat && seat.token !== msg.token) seat = undefined; // token 不符：不允许冒名占座
    if (!seat) {
      if (this.phase !== 'lobby') return this.transport.send(connId, { t: 'reject', reason: '牌局已开始，无法加入新玩家' });
      if (this.seats.length >= this.config.maxPlayers) return this.transport.send(connId, { t: 'reject', reason: '房间已满' });
      const name = (msg.name || '玩家').slice(0, 8);
      let id: string;
      do id = 'g' + Math.floor(this.rng() * 1e6); while (this.seats.some((s) => s.playerId === id));
      seat = { playerId: id, name, kind: 'human', connected: true, isHost: false, token: randToken(this.rng), connId, lastSeen: this.sched.now() };
      this.seats.push(seat);
    }
    if (seat.connId && seat.connId !== connId) this.conns.delete(seat.connId);
    seat.connId = connId; seat.connected = true; seat.lastSeen = this.sched.now();
    this.conns.set(connId, seat.playerId);
    this.transport.send(connId, { t: 'welcome', playerId: seat.playerId, token: seat.token });
    this.broadcast({ kind: 'seat' }); // 包括给重连者一份全新过滤快照
  }

  /** 断线：保留座位，超时逻辑照常 */
  onDisconnect(connId: string) {
    const pid = this.conns.get(connId);
    this.conns.delete(connId);
    const seat = this.seats.find((s) => s.playerId === pid);
    if (!seat || seat.connId !== connId) return;
    seat.connId = null; seat.connected = false;
    if (this.phase === 'lobby') this.seats = this.seats.filter((s) => s !== seat); // 开局前离开直接让出座位
    this.broadcast({ kind: 'seat' });
  }

  /** 由外部周期调用：心跳超时判定为断线 */
  heartbeat(staleMs = 8000) {
    const now = this.sched.now();
    for (const s of this.seats) if (s.kind === 'human' && !s.isHost && s.connId && now - s.lastSeen > staleMs) this.onDisconnect(s.connId);
  }

  /** 房主本人行动 */
  hostAct(action: BetAction | { type: 'rebuy'; playerId: string }) {
    const h = this.game?.hand;
    this.onMessage(HOST_CONN, { t: 'action', action, handNo: this.game?.handNo ?? 0, actionSeq: h?.actionSeq ?? 0 });
  }

  private receiveAction(fromId: string, msg: Extract<ClientMsg, { t: 'action' }>) {
    const a = msg.action;
    const rej = (reason: string) => this.send(fromId, { t: 'reject', reason, handNo: msg.handNo, actionSeq: msg.actionSeq });
    if (this.phase !== 'playing' || !this.game) return rej('牌局未开始');
    if (a.playerId !== fromId) return rej('不能替他人行动');
    const key = `${fromId}:${msg.handNo}:${msg.actionSeq}:${a.type === 'rebuy' ? 'r' : 'a'}`;
    if (this.seen.has(key)) return; // (playerId, handNo, actionSeq) 去重
    this.seen.add(key);
    if (a.type !== 'rebuy' && (msg.handNo !== this.game.handNo || msg.actionSeq !== this.game.hand?.actionSeq)) return rej('过期的行动');
    try { this.apply(a); } catch (e) { rej((e as Error).message); }
  }

  private apply(a: Action) {
    const before = this.game!.hand?.log.length ?? 0;
    this.game = reduce(this.game!, a);
    const ev: PublicEvent =
      a.type === 'startHand' ? { kind: 'handStart', handNo: this.game.handNo }
      : a.type === 'rebuy' ? { kind: 'rebuy', playerId: a.playerId }
      : { kind: 'action', entry: this.game.hand!.log[before] };
    this.schedule();
    this.broadcast(ev);
  }

  /** 驱动：AI 思考、人类 30s 超时、下一手 */
  private schedule() {
    this.sched.clear(this.timer);
    this.timer = null;
    this.deadline = null;
    const g = this.game;
    if (!g || this.phase !== 'playing') return;
    const h = g.hand!;
    const safe = (fn: () => void) => () => { try { fn(); } catch (e) { if (!(e instanceof EngineError)) throw e; this.schedule(); } };
    if (h.street !== 'complete') {
      const p = g.players[h.toAct];
      const seat = this.seats.find((s) => s.playerId === p.id)!;
      if (seat.kind === 'ai') {
        const [lo, hi] = this.config.aiDelayMs;
        const last = h.log[h.log.length - 1];
        const pause = (last?.kind === 'board' || last?.kind === 'bb') ? this.config.streetPauseMs ?? 0 : 0;
        this.timer = this.sched.set(safe(() => {
          const act = decide(viewFor(this.game!, p.id), { personality: p.personality!, difficulty: p.difficulty ?? 'normal' }, this.rng);
          this.apply(act);
        }), lo + this.rng() * (hi - lo) + pause);
      } else {
        this.deadline = this.sched.now() + this.config.timeoutSec * 1000;
        const handNo = g.handNo, seq = h.actionSeq;
        this.timer = this.sched.set(safe(() => {
          const cur = this.game!.hand!;
          if (this.game!.handNo !== handNo || cur.actionSeq !== seq) return;
          const canCheck = cur.bets[cur.toAct] >= cur.currentBet;
          this.apply({ type: canCheck ? 'check' : 'fold', playerId: p.id });
        }), this.config.timeoutSec * 1000);
      }
      return;
    }
    // 手牌结束：AI 自动重买，延时开下一手
    if (g.config.rebuy) for (const p of g.players) {
      const seat = this.seats.find((s) => s.playerId === p.id)!;
      if (seat.kind === 'ai' && p.stack === 0 && !p.pendingRebuy) this.game = reduce(this.game!, { type: 'rebuy', playerId: p.id });
    }
    const ready = this.game!.players.filter((p) => (p.stack > 0 || p.pendingRebuy) && !p.eliminated).length;
    if (ready >= 2) this.timer = this.sched.set(safe(() => this.apply({ type: 'startHand' })), this.config.nextHandDelayMs);
  }

  private send(playerId: string, m: HostMsg) {
    const s = this.seats.find((x) => x.playerId === playerId);
    if (s?.connId) this.transport.send(s.connId, m);
  }

  private broadcast(event: PublicEvent) {
    this.seq++;
    const room = this.roomInfo();
    const serverTime = this.sched.now();
    for (const s of this.seats) {
      if (!s.connId) continue;
      const view = this.game ? viewFor(this.game, s.playerId, { publicProfit: this.config.publicProfit, revealAll: this.config.revealAll }) : null;
      this.transport.send(s.connId, { t: 'room', seq: this.seq, room, view, event, serverTime });
    }
  }
}

// ---------------- 客户端 ----------------
export interface ClientLink { send(m: ClientMsg): void; reconnect(): void }
export type ClientStatus = 'connecting' | 'lobby' | 'playing' | 'reconnecting' | 'closed';

export class ClientRoom {
  status: ClientStatus = 'connecting';
  room: RoomInfo | null = null;
  view: PlayerView | null = null;
  error: string | null = null;
  closedReason: string | null = null;
  /** serverTime - 本地时间 */
  offset = 0;
  private lastMsg: number;
  private lostAt: number | null = null;
  private retryTimer: unknown = null;
  private sentKey = '';

  constructor(
    public name: string, private link: ClientLink, private sched: Scheduler,
    private opts: { hostWaitMs: number; staleMs: number },
    private onChange: () => void,
    public cred: { playerId?: string; token?: string } = {},
    private onCred: (c: { playerId: string; token: string }) => void = () => {},
  ) { this.lastMsg = sched.now(); }

  onOpen() { this.link.send({ t: 'hello', name: this.name, playerId: this.cred.playerId, token: this.cred.token }); }

  onMessage(m: HostMsg) {
    const now = this.sched.now();
    this.lastMsg = now;
    if (this.lostAt !== null && m.t !== 'closed') { this.lostAt = null; this.sched.clear(this.retryTimer); }
    switch (m.t) {
      case 'welcome':
        this.cred = { playerId: m.playerId, token: m.token };
        this.onCred({ playerId: m.playerId, token: m.token });
        break;
      case 'room':
        this.offset = m.serverTime - now;
        this.room = m.room; this.view = m.view;
        this.status = m.room.phase === 'lobby' ? 'lobby' : m.room.phase === 'closed' ? 'closed' : 'playing';
        this.error = null;
        break;
      case 'reject':
        this.error = m.reason;
        if (!this.room) { this.status = 'closed'; this.closedReason = m.reason; }
        break;
      case 'closed':
        this.status = 'closed'; this.closedReason = m.reason;
        this.sched.clear(this.retryTimer);
        break;
      case 'pong':
        this.offset = m.serverTime - now;
        if (this.status === 'reconnecting') this.status = this.room?.phase === 'playing' ? 'playing' : 'lobby';
        break;
    }
    this.onChange();
  }

  /** 本地时钟下的截止时间（以房主时间戳为准） */
  localDeadline() { return this.room?.deadline ? this.room.deadline - this.offset : null; }

  act(action: BetAction | { type: 'rebuy'; playerId: string }) {
    if (this.status !== 'playing' || !this.view) return;
    const handNo = this.view.handNo, actionSeq = this.view.hand?.actionSeq ?? 0;
    const key = `${handNo}:${actionSeq}:${action.type === 'rebuy'}`;
    if (key === this.sentKey) return; // 本地防抖
    this.sentKey = key;
    this.link.send({ t: 'action', action, handNo, actionSeq });
  }

  leave() { this.link.send({ t: 'leave' }); this.status = 'closed'; this.closedReason = '你已离开房间'; this.sched.clear(this.retryTimer); this.onChange(); }

  /** 周期调用：发心跳；长时间无消息视为与房主失联 */
  heartbeat() {
    if (this.status === 'closed') return;
    this.link.send({ t: 'ping' });
    if (this.sched.now() - this.lastMsg > this.opts.staleMs) this.onLinkLost();
  }

  onLinkLost() {
    if (this.status === 'closed') return;
    const now = this.sched.now();
    if (this.lostAt === null) {
      this.lostAt = now;
      this.status = 'reconnecting';
      this.onChange();
      const retry = () => {
        if (this.status !== 'reconnecting' || this.lostAt === null) return;
        if (this.sched.now() - this.lostAt >= this.opts.hostWaitMs) {
          this.status = 'closed'; this.closedReason = '房主已离线，房间关闭';
          this.onChange();
          return;
        }
        this.link.reconnect();
        this.retryTimer = this.sched.set(retry, Math.min(3000, this.opts.hostWaitMs / 4));
      };
      this.retryTimer = this.sched.set(retry, Math.min(3000, this.opts.hostWaitMs / 4));
    }
  }
}
