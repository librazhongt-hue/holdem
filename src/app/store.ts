import { reduce, viewFor, EngineError, createGame, type Action, type GameState, type TableConfig } from '../engine';
import { makeRng } from '../engine/rng';
import { makeRoster } from '../ai/roster';
import { applyHand, archive, type SaveData, type SessionStats, type Settings } from './session';
import { STAKES } from './stakes';

export const LOCAL_ID = 'p0'; // 本地玩家仅是一个 playerId

export type AppAction =
  | { type: 'engine'; action: Action; now: number }
  | { type: 'settings'; settings: Partial<Settings> }
  | { type: 'newGame'; seed: number; now: number }
  | { type: 'endSession'; now: number }
  | { type: 'quit' };

export interface AppState extends SaveData { error: string | null; lastSummary: SessionStats | null }

export function tableConfig(s: Settings): { config: TableConfig; label: string } {
  const st = STAKES.find((x) => x.id === s.stakeId);
  if (st) return { config: { stakeId: st.id, sb: st.sb, bb: st.bb, startingStack: st.stack, rebuy: s.rebuy }, label: st.name };
  const c = s.custom;
  return { config: { stakeId: `custom-${c.sb}-${c.bb}-${c.stack}`, sb: c.sb, bb: c.bb, startingStack: c.stack, rebuy: s.rebuy }, label: `自定义 ${c.sb}/${c.bb}` };
}

function newSession(g: GameState, label: string, now: number): SessionStats {
  const p = g.players.find((x) => x.id === LOCAL_ID)!;
  return { id: String(now), stakeId: g.config.stakeId, stakeLabel: label, startedAt: now, hands: 0, wins: 0, maxWin: 0, maxLoss: 0, buyIns: p.buyIns, totalBuyIn: p.totalBuyIn, profit: 0 };
}

export function appReducer(st: AppState, a: AppAction): AppState {
  switch (a.type) {
    case 'settings':
      return { ...st, settings: { ...st.settings, ...a.settings } };
    case 'newGame': {
      let sessions = st.sessions;
      if (st.session && st.session.hands > 0) sessions = archive(sessions, st.session, a.now); // 切换场次 / 新局：结束旧会话
      const { config, label } = tableConfig(st.settings);
      const roster = makeRoster(st.settings.name || '我', st.settings.players, st.settings.difficulty, makeRng(a.seed ^ 0x9e3779b9));
      let g = createGame(config, roster, a.seed);
      g = reduce(g, { type: 'startHand' });
      return { ...st, sessions, game: g, session: newSession(g, label, a.now), error: null, lastSummary: null };
    }
    case 'endSession': {
      if (!st.session) return st;
      const fin = { ...st.session, endedAt: a.now };
      return { ...st, sessions: archive(st.sessions, st.session, a.now), session: null, game: null, lastSummary: fin };
    }
    case 'quit':
      return { ...st, lastSummary: null };
    case 'engine': {
      if (!st.game) return st;
      let g: GameState;
      try {
        g = reduce(st.game, a.action);
      } catch (e) {
        if (e instanceof EngineError) return { ...st, error: e.message };
        throw e;
      }
      let { session, history } = st;
      const ended = !!st.game.hand && st.game.hand.street !== 'complete' && g.hand?.street === 'complete';
      if (session) session = applyHand(session, g, LOCAL_ID, ended);
      if (ended) {
        // 手牌结束：写手牌历史（只存本地玩家视角可见的信息）
        const v = viewFor(g, LOCAL_ID, { revealAll: st.settings.revealAll });
        const allHoles = st.settings.revealAll ? Object.fromEntries(g.players.map((p, i) => [p.id, { cards: v.hand!.holes[i]!, folded: v.hand!.folded[i] }]).filter(([, x]) => (x as any).cards)) : undefined;
        const names = Object.fromEntries(g.players.map((p) => [p.id, p.name]));
        history = [{ handNo: g.handNo, time: a.now, board: v.hand!.board, myHole: v.hand!.holes[v.mySeat] ?? null, net: g.hand!.result!.net[LOCAL_ID] ?? 0, result: v.hand!.result!, names, allHoles }, ...history].slice(0, 50);
      }
      return { ...st, game: g, session, history, error: null };
    }
  }
}
