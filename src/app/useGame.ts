import { useEffect, useReducer, useRef } from 'react';
import { viewFor, type Action } from '../engine';
import { decide, handPercentile } from '../ai/ai';
handPercentile([0, 1]); // 预热翻前百分位表，避免首个 AI 决策卡顿
import { appReducer, LOCAL_ID, type AppState } from './store';
import { load, save } from './session';
import { aiDelayRange, streetPause, TEST_FAST } from './speed';

const randSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export function useGame() {
  const [st, raw] = useReducer(appReducer, undefined, (): AppState => ({ ...load(), error: null, lastSummary: null }));
  const dispatchEngine = (action: Action) => raw({ type: 'engine', action, now: Date.now() });

  useEffect(() => {
    const { error: _e, lastSummary: _l, ...data } = st;
    save(data);
  }, [st]);

  const g = st.game;
  const hand = g?.hand;
  const toActId = hand && hand.street !== 'complete' && hand.toAct >= 0 ? g!.players[hand.toAct].id : null;
  const toActPlayer = toActId ? g!.players.find((p) => p.id === toActId)! : null;

  // AI 行动：输入只有该 AI 自己的视角；300~800ms 模拟思考
  const aiRng = useRef(() => Math.random());
  useEffect(() => {
    if (!g || !toActPlayer?.isBot) return;
    const t = setTimeout(() => {
      const v = viewFor(g, toActPlayer.id);
      dispatchEngine(decide(v, { personality: toActPlayer.personality!, difficulty: toActPlayer.difficulty ?? 'normal' }, aiRng.current));
    }, (() => { const [lo, hi] = aiDelayRange(st.settings.aiSpeed); return lo + Math.random() * (hi - lo) + streetPause(hand!.log); })());
    return () => clearTimeout(t);
  }, [g, toActPlayer?.id, hand?.actionSeq]); // eslint-disable-line

  // 手牌结束：AI 自动重买；可选自动下一手
  const complete = !!hand && hand.street === 'complete';
  useEffect(() => {
    if (!g || !complete) return;
    for (const p of g.players) if (p.isBot && p.stack === 0 && !p.pendingRebuy && g.config.rebuy) dispatchEngine({ type: 'rebuy', playerId: p.id });
  }, [g?.handNo, complete]); // eslint-disable-line
  useEffect(() => {
    if (!g || !complete || !st.settings.autoNext) return;
    const me = g.players.find((p) => p.id === LOCAL_ID)!;
    if (me.stack === 0 && !me.pendingRebuy && !me.eliminated) return; // 等玩家决定是否重买
    const t = setTimeout(() => dispatchEngine({ type: 'startHand' }), TEST_FAST ? 1500 : 3200);
    return () => clearTimeout(t);
  }, [g, complete, st.settings.autoNext]); // eslint-disable-line

  return {
    st,
    dispatchEngine,
    setSettings: (s: Partial<AppState['settings']>) => raw({ type: 'settings', settings: s }),
    newGame: () => raw({ type: 'newGame', seed: randSeed(), now: Date.now() }),
    endSession: () => raw({ type: 'endSession', now: Date.now() }),
    closeSummary: () => raw({ type: 'quit' }),
    view: g ? viewFor(g, LOCAL_ID, { revealAll: st.settings.revealAll }) : null,
    localId: LOCAL_ID,
  };
}
