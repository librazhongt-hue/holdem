/** PeerJS 传输适配：房间码 → 房主 peer id；支持自定义 PeerJS 服务器与 TURN */
import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { ClientMsg, HostMsg } from './protocol';

export interface PeerSettings { host?: string; port?: number; path?: string; secure?: boolean; turnUrl?: string; turnUser?: string; turnPass?: string }
const KEY = 'holdem.peer';
const env = (import.meta as any).env ?? {};

export function loadPeerSettings(): PeerSettings {
  const s: PeerSettings = {};
  if (env.VITE_PEER_HOST) s.host = env.VITE_PEER_HOST;
  if (env.VITE_PEER_PORT) s.port = Number(env.VITE_PEER_PORT);
  if (env.VITE_PEER_PATH) s.path = env.VITE_PEER_PATH;
  if (env.VITE_PEER_SECURE) s.secure = env.VITE_PEER_SECURE !== 'false';
  if (env.VITE_TURN_URL) Object.assign(s, { turnUrl: env.VITE_TURN_URL, turnUser: env.VITE_TURN_USER, turnPass: env.VITE_TURN_PASS });
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
  const qs = new URLSearchParams(location.search);
  if (qs.get('turn')) Object.assign(s, { turnUrl: qs.get('turn')!, turnUser: qs.get('turnUser') ?? undefined, turnPass: qs.get('turnPass') ?? undefined });
  const q = qs.get('peer'); // ?peer=localhost:9000/myapp
  if (q) {
    const m = q.match(/^([^:/]+)(?::(\d+))?(\/.*)?$/);
    if (m) Object.assign(s, { host: m[1], port: m[2] ? Number(m[2]) : undefined, path: m[3] || '/', secure: new URLSearchParams(location.search).get('peerSecure') === '1' });
  }
  return s;
}
export function savePeerSettings(s: PeerSettings) { localStorage.setItem(KEY, JSON.stringify(s)); }

function options(s: PeerSettings): PeerOptions {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (s.turnUrl) iceServers.push({ urls: s.turnUrl, username: s.turnUser, credential: s.turnPass });
  const o: PeerOptions = { debug: Number(new URLSearchParams(location.search).get('peerDebug') ?? 1) as 0 | 1 | 2 | 3, config: { iceServers } };
  if (s.host) Object.assign(o, { host: s.host, port: s.port ?? (s.secure ? 443 : 80), path: s.path ?? '/', secure: !!s.secure });
  return o;
}

export const roomPeerId = (code: string) => `thx-holdem-room-${code}`;

export interface HostLink { send(connId: string, m: HostMsg): void; destroy(): void }
/** 打开房主端；id 被占用（如刚刷新，服务器还未释放）时按需重试 */
export function openHost(code: string, s: PeerSettings, h: { onMessage(connId: string, m: ClientMsg): void; onClose(connId: string): void }, retries = 0): Promise<HostLink> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(roomPeerId(code), options(s));
    const conns = new Map<string, DataConnection>();
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve({ send: (id, m) => { const c = conns.get(id); if (c?.open) c.send(m); }, destroy: () => peer.destroy() });
    });
    peer.on('connection', (c) => {
      const id = c.connectionId;
      conns.set(id, c);
      c.on('data', (d) => h.onMessage(id, d as ClientMsg));
      c.on('close', () => { conns.delete(id); h.onClose(id); });
      c.on('error', () => { conns.delete(id); h.onClose(id); });
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', (e: any) => {
      if (opened) return;
      peer.destroy();
      if (e.type === 'unavailable-id' && retries > 0) setTimeout(() => openHost(code, s, h, retries - 1).then(resolve, reject), 3000);
      else reject(new Error(e.type === 'unavailable-id' ? '房间码被占用' : '连接信令服务器失败：' + (e.type ?? e)));
    });
  });
}

export interface GuestLink { send(m: ClientMsg): void; reconnect(): void; destroy(): void }
export function openGuest(code: string, s: PeerSettings, h: { onOpen(): void; onMessage(m: HostMsg): void; onLost(): void; onError(msg: string): void }): GuestLink {
  const peer = new Peer(options(s));
  let conn: DataConnection | null = null;
  const connect = () => {
    if (peer.destroyed || !peer.open) return;
    conn?.close();
    const c = peer.connect(roomPeerId(code), { reliable: true, serialization: 'json' });
    conn = c;
    c.on('open', () => h.onOpen());
    c.on('data', (d) => h.onMessage(d as HostMsg));
    c.on('close', () => { console.warn('[guest conn] close'); if (conn === c) h.onLost(); });
    c.on('error', (e) => { console.warn('[guest conn] error', String(e)); if (conn === c) h.onLost(); });
  };
  peer.on('open', connect);
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('error', (e: any) => {
    console.warn('[guest peer]', e.type, String(e));
    if (e.type === 'peer-unavailable') h.onLost(); // 房主不在线
    else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') h.onError('信令服务器连接失败');
  });
  return {
    send: (m) => { if (conn?.open) conn.send(m); },
    reconnect: () => { if (!conn?.open) connect(); },
    destroy: () => peer.destroy(),
  };
}
