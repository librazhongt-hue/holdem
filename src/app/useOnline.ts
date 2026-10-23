import { useEffect, useReducer, useRef, useState } from 'react';
import { HostRoom, ClientRoom, HOST_CONN, DEFAULT_ROOM, realScheduler, type RoomConfig, type HostSnapshot, type ClientStatus, type RoomInfo } from '../net/protocol';
import { openHost, openGuest, loadPeerSettings, type HostLink, type GuestLink } from '../net/peer';
import { viewFor, type BetAction, type PlayerView } from '../engine';
import { aiDelayRange } from './speed';

const q = new URLSearchParams(location.search);
/** 测试/调试参数：?fast=1 加速 AI 与下一手；?timeout=秒；?hostWait=毫秒 */
const FAST = q.get('fast') === '1';
const TIMEOUT = q.get('timeout') ? Number(q.get('timeout')) : 30;
const HOST_WAIT = q.get('hostWait') ? Number(q.get('hostWait')) : 120000;
const HOST_KEY = 'holdem.hostRoom';
const randCode = () => String(100000 + Math.floor(Math.random() * 900000));
const randSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export interface OnlineState {
  role: 'none' | 'host' | 'guest';
  status: ClientStatus | 'opening';
  room: RoomInfo | null;
  view: PlayerView | null;
  deadline: number | null;
  error: string | null;
  closedReason: string | null;
}

export function savedHostRoom(): HostSnapshot | null {
  try {
    const s = JSON.parse(localStorage.getItem(HOST_KEY) || 'null') as HostSnapshot | null;
    return s && s.phase !== 'closed' && Date.now() - s.savedAt < 120000 ? s : null;
  } catch { return null; }
}

export function useOnline() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const host = useRef<HostRoom | null>(null);
  const hostLink = useRef<HostLink | null>(null);
  const client = useRef<ClientRoom | null>(null);
  const guestLink = useRef<GuestLink | null>(null);
  const [role, setRole] = useState<OnlineState['role']>('none');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 心跳
  useEffect(() => {
    const t = setInterval(() => {
      if (host.current) {
        host.current.heartbeat(8000);
        if (host.current.phase !== 'closed') localStorage.setItem(HOST_KEY, JSON.stringify(host.current.snapshot()));
      }
      client.current?.heartbeat();
    }, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => { hostLink.current?.destroy(); guestLink.current?.destroy(); }, []);

  async function createRoom(name: string, cfg: Partial<RoomConfig>, snap?: HostSnapshot) {
    setOpening(true); setError(null);
    const code = snap?.code ?? randCode();
    let room: HostRoom | null = null;
    try {
      hostLink.current = await openHost(code, loadPeerSettings(), {
        onMessage: (id, m) => room?.onMessage(id, m),
        onClose: (id) => room?.onDisconnect(id),
      }, snap ? 10 : 0);
    } catch (e) {
      setOpening(false); setError((e as Error).message); return;
    }
    const config: RoomConfig = { ...DEFAULT_ROOM, ...cfg, timeoutSec: TIMEOUT, aiDelayMs: aiDelayRange(cfg.aiSpeed ?? 'normal'), ...(FAST ? { nextHandDelayMs: 500, streetPauseMs: 0 } : {}) };
    room = new HostRoom(code, snap?.config ?? config, name, {
      send: (id, m) => { if (id === HOST_CONN) bump(); else hostLink.current?.send(id, m); },
    }, realScheduler, snap?.game?.seed ?? randSeed(), snap);
    host.current = room;
    setRole('host'); setOpening(false); bump();
  }

  function joinRoom(code: string, name: string) {
    setError(null);
    const credKey = 'holdem.cred.' + code;
    let cred = {};
    try { cred = JSON.parse(localStorage.getItem(credKey) || '{}'); } catch { /* */ }
    let c: ClientRoom | null = null;
    const link = openGuest(code, loadPeerSettings(), {
      onOpen: () => c?.onOpen(),
      onMessage: (m) => c?.onMessage(m),
      onLost: () => c?.onLinkLost(),
      onError: (msg) => setError(msg),
    });
    guestLink.current = link;
    c = new ClientRoom(name, link, realScheduler, { hostWaitMs: HOST_WAIT, staleMs: 7000 }, bump, cred, (cr) => localStorage.setItem(credKey, JSON.stringify(cr)));
    client.current = c;
    setRole('guest'); bump();
  }

  function leave() {
    if (host.current) { host.current.close(); localStorage.removeItem(HOST_KEY); setTimeout(() => hostLink.current?.destroy(), 500); }
    if (client.current) { client.current.leave(); setTimeout(() => guestLink.current?.destroy(), 300); }
    host.current = null; client.current = null; setRole('none'); bump();
  }

  function act(a: BetAction | { type: 'rebuy'; playerId: string }) {
    if (host.current) host.current.hostAct(a);
    else client.current?.act(a);
  }

  const h = host.current, c = client.current;
  let st: OnlineState = { role, status: opening ? 'opening' : 'connecting', room: null, view: null, deadline: null, error, closedReason: null };
  if (h) st = { ...st, status: h.phase === 'lobby' ? 'lobby' : h.phase === 'closed' ? 'closed' : 'playing', room: h.roomInfo(), view: h.game ? viewFor(h.game, h.hostId, { publicProfit: h.config.publicProfit, revealAll: h.config.revealAll }) : null, deadline: h.deadline };
  else if (c) st = { ...st, status: c.status, room: c.room, view: c.view, deadline: c.localDeadline(), error: error ?? c.error, closedReason: c.closedReason };

  return {
    st, createRoom, joinRoom, leave, act,
    setConfig: (cfg: Partial<RoomConfig>) => { try { host.current?.setConfig(cfg.aiSpeed ? { ...cfg, aiDelayMs: aiDelayRange(cfg.aiSpeed) } : cfg); setError(null); } catch (e) { setError((e as Error).message); } bump(); },
    start: () => { host.current?.start(); bump(); },
    myId: h ? h.hostId : c?.cred.playerId ?? null,
  };
}
