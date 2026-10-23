import type { Card, GameState, HandResult, LogEntry, Street, TableConfig } from './types';
import { legalFor, type Legal } from './engine';
import { buildPots } from './pots';

export interface PublicPlayer {
  id: string; name: string; isBot: boolean; stack: number;
  eliminated: boolean; pendingRebuy: boolean;
  /** 买入信息：仅自己（或开启公开盈亏时）可见 */
  buyIns?: number; totalBuyIn?: number;
}

export interface HandView {
  handNo: number; button: number; sbSeat: number; bbSeat: number;
  street: Street; board: Card[];
  inHand: boolean[]; bets: number[]; committed: number[]; folded: boolean[]; allIn: boolean[];
  currentBet: number; minRaise: number; toAct: number; actionSeq: number;
  /** 只含自己的手牌，以及摊牌后公开的手牌 */
  holes: (Card[] | null)[];
  pots: { amount: number; eligible: number[] }[];
  log: LogEntry[];
  result?: HandResult;
}

export interface PlayerView {
  viewerId: string | null;
  mySeat: number;
  config: TableConfig;
  handNo: number;
  players: PublicPlayer[];
  hand: HandView | null;
  legal: Legal | null;
}

/** 唯一的视角过滤出口：UI、AI、联机广播都必须使用它。不含 seed、牌堆、他人底牌。 */
/** revealAll：手牌结束（street==='complete'）后公开所有入局玩家底牌（含弃牌者）；进行中绝不公开 */
export function viewFor(s: GameState, viewerId: string | null, opts: { publicProfit?: boolean; revealAll?: boolean } = {}): PlayerView {
  const mySeat = viewerId ? s.players.findIndex((p) => p.id === viewerId) : -1;
  const h = s.hand;
  let hand: HandView | null = null;
  if (h) {
    const shown = h.result?.shown ?? {};
    hand = {
      handNo: h.handNo, button: h.button, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
      street: h.street, board: h.board.slice(),
      inHand: h.inHand.slice(), bets: h.bets.slice(), committed: h.committed.slice(), folded: h.folded.slice(), allIn: h.allIn.slice(),
      currentBet: h.currentBet, minRaise: h.minRaise, toAct: h.toAct, actionSeq: h.actionSeq,
      holes: h.holes.map((c, i) => (i === mySeat || shown[s.players[i].id] || (opts.revealAll && h.street === 'complete') ? (c ? c.slice() : null) : null)),
      pots: livePots(h),
      log: h.log.map((l) => ({ ...l })),
      result: h.result ? structuredClone(h.result) : undefined,
    };
  }
  return {
    viewerId, mySeat, config: { ...s.config }, handNo: s.handNo,
    players: s.players.map((p, i) => {
      const pub: PublicPlayer = { id: p.id, name: p.name, isBot: p.isBot, stack: p.stack, eliminated: p.eliminated, pendingRebuy: p.pendingRebuy };
      if (i === mySeat || opts.publicProfit) { pub.buyIns = p.buyIns; pub.totalBuyIn = p.totalBuyIn; }
      return pub;
    }),
    hand,
    legal: h && mySeat >= 0 ? legalFor(h, s.players[mySeat].stack, mySeat) : null,
  };
}

/** 进行中的底池展示：只有全下玩家才切分边池；尚未跟齐的下注归入最上层（结算以 HandResult 为准） */
function livePots(h: import('./types').HandState) {
  const contending = h.inHand.map((x, i) => x && !h.folded[i]);
  if (h.result) return buildPots(h.committed, contending);
  const caps = [...new Set(h.committed.filter((_, i) => contending[i] && h.allIn[i]))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  for (const lv of caps) {
    const amount = h.committed.reduce((a, c) => a + Math.max(0, Math.min(c, lv) - prev), 0);
    if (amount > 0) pots.push({ amount, eligible: h.committed.map((c, i) => (contending[i] && c >= lv ? i : -1)).filter((i) => i >= 0) });
    prev = lv;
  }
  const rest = h.committed.reduce((a, c) => a + Math.max(0, c - prev), 0);
  const el = contending.map((c, i) => (c && h.committed[i] >= prev && !(h.allIn[i] && h.committed[i] <= prev) ? i : -1)).filter((i) => i >= 0);
  if (rest > 0 || pots.length === 0) pots.push({ amount: rest, eligible: el });
  return pots;
}
