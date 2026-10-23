/** 内存传输：用于单测，同步投递（可选择性断开） */
import { HostRoom, ClientRoom, HOST_CONN, type HostMsg, type Scheduler, type RoomConfig } from './protocol';

export class MemoryNet {
  host!: HostRoom;
  clients = new Map<string, { room: ClientRoom; online: boolean; inbox: HostMsg[] }>();
  hostInbox: HostMsg[] = [];
  hostUp = true;
  log: { to: string; msg: HostMsg }[] = [];
  constructor(public sched: Scheduler) {}

  createHost(code: string, config: RoomConfig, seed = 1) {
    this.host = new HostRoom(code, config, '房主', {
      send: (connId, msg) => {
        this.log.push({ to: connId, msg: JSON.parse(JSON.stringify(msg)) });
        if (connId === HOST_CONN) { this.hostInbox.push(msg); return; }
        const c = this.clients.get(connId);
        if (c?.online && this.hostUp) c.room.onMessage(JSON.parse(JSON.stringify(msg)));
      },
    }, this.sched, seed);
    return this.host;
  }

  addClient(connId: string, name: string, opts = { hostWaitMs: 120000, staleMs: 6000 }, cred = {}) {
    const entry = { room: null as unknown as ClientRoom, online: true, inbox: [] as HostMsg[] };
    entry.room = new ClientRoom(name, {
      send: (m) => { if (entry.online && this.hostUp) this.host.onMessage(connId, JSON.parse(JSON.stringify(m))); },
      reconnect: () => { if (entry.online && this.hostUp) entry.room.onOpen(); },
    }, this.sched, opts, () => {}, cred);
    this.clients.set(connId, entry);
    entry.room.onOpen();
    return entry.room;
  }

  drop(connId: string) {
    const c = this.clients.get(connId)!;
    c.online = false;
    this.host.onDisconnect(connId);
  }
}

/** 可手动推进的假时钟 */
export class FakeScheduler implements Scheduler {
  t = 0;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private id = 0;
  now() { return this.t; }
  set(fn: () => void, ms: number) { const id = ++this.id; this.q.push({ at: this.t + ms, fn, id }); return id; }
  clear(h: unknown) { this.q = this.q.filter((x) => x.id !== h); }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const n = this.q[0];
      if (!n || n.at > end) break;
      this.q.shift();
      this.t = n.at;
      n.fn();
    }
    this.t = end;
  }
}
