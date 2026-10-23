import type { Card, GameState, HandResult } from '../engine/types';

export interface HandRecord {
  handNo: number; time: number; board: Card[]; myHole: Card[] | null; net: number;
  /** 开启“显示所有人手牌”时记录的全部底牌（含弃牌者） */
  allHoles?: Record<string, { cards: Card[]; folded: boolean }>;
  result: HandResult; names: Record<string, string>;
}
export interface SessionStats {
  id: string; stakeId: string; stakeLabel: string; startedAt: number; endedAt?: number;
  hands: number; wins: number; maxWin: number; maxLoss: number; buyIns: number; totalBuyIn: number; profit: number;
}
export interface Settings {
  stakeId: string; custom: { sb: number; bb: number; stack: number };
  players: number; difficulty: 'easy' | 'normal' | 'hard'; rebuy: boolean;
  timeout: boolean; timeoutSec: number; name: string; autoNext: boolean; revealAll: boolean; aiSpeed: 'fast' | 'normal' | 'slow';
}
export interface SaveData {
  version: 1;
  settings: Settings;
  game: GameState | null;
  session: SessionStats | null;
  history: HandRecord[];
  sessions: SessionStats[];
}

export const DEFAULT_SETTINGS: Settings = {
  stakeId: 'standard', custom: { sb: 10, bb: 20, stack: 1000 }, players: 6, difficulty: 'normal',
  rebuy: true, timeout: false, timeoutSec: 60, name: '我', autoNext: true, revealAll: false, aiSpeed: 'normal',
};

const KEY = 'holdem.save.v1';
export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d.version === 1) return { ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
    }
  } catch { /* 损坏存档忽略 */ }
  return { version: 1, settings: DEFAULT_SETTINGS, game: null, session: null, history: [], sessions: [] };
}
export function save(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 配额满 */ }
}

/** 根据一手结果更新会话（只针对本地玩家） */
export function applyHand(sess: SessionStats, g: GameState, playerId: string, countHand: boolean): SessionStats {
  const p = g.players.find((x) => x.id === playerId)!;
  const net = g.hand?.result?.net[playerId];
  const s = { ...sess, buyIns: p.buyIns, totalBuyIn: p.totalBuyIn, profit: p.stack - p.totalBuyIn };
  if (!countHand || net === undefined) return s;
  s.hands++;
  if (net > 0) s.wins++;
  s.maxWin = Math.max(s.maxWin, net);
  s.maxLoss = Math.min(s.maxLoss, net);
  return s;
}

export function archive(list: SessionStats[], s: SessionStats, now: number): SessionStats[] {
  return [{ ...s, endedAt: now }, ...list].slice(0, 20);
}

export function globalByStake(list: SessionStats[]) {
  const m = new Map<string, { label: string; sessions: number; hands: number; profit: number; buyIns: number }>();
  for (const s of list) {
    const e = m.get(s.stakeId) ?? { label: s.stakeLabel, sessions: 0, hands: 0, profit: 0, buyIns: 0 };
    e.sessions++; e.hands += s.hands; e.profit += s.profit; e.buyIns += s.buyIns;
    m.set(s.stakeId, e);
  }
  return [...m.values()];
}
