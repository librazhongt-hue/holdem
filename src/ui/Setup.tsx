import { STAKES, validateCustom } from '../app/stakes';
import type { Settings } from '../app/session';
import css from './App.module.css';

export function Setup({ settings, set, onStart, canResume, onResume, onStats, onOnline }: { settings: Settings; set: (s: Partial<Settings>) => void; onStart: () => void; canResume: boolean; onResume: () => void; onStats: () => void; onOnline: () => void }) {
  const custom = settings.stakeId === 'custom';
  const c = settings.custom;
  const err = custom ? validateCustom(c.sb, c.bb, c.stack, settings.players) : null;
  const cur = custom ? { sb: c.sb, bb: c.bb, stack: c.stack } : STAKES.find((s) => s.id === settings.stakeId)!;
  return (
    <div className={css.setup}>
      <h1>♠ 德州扑克 ♥</h1>
      <div className={css.row}>
        <button className={css.primary} onClick={() => { set({ players: 6 }); onStart(); }} data-testid="quick">快速开始（6 人）</button>
        {canResume && <button onClick={onResume}>继续上次牌局</button>}
        <button onClick={onOnline} data-testid="online">联机对战</button>
        <button onClick={onStats}>统计</button>
      </div>
      <section className={css.panel}>
        <h3>盲注场次</h3>
        <div className={css.stakes}>
          {STAKES.map((s) => (
            <button key={s.id} className={settings.stakeId === s.id ? css.selected : ''} onClick={() => set({ stakeId: s.id })}>
              <b>{s.name}</b><div>{s.sb}/{s.bb} · {s.stack}</div><small>{s.desc}</small>
            </button>
          ))}
          <button className={custom ? css.selected : ''} onClick={() => set({ stakeId: 'custom' })}><b>自定义</b><div>自填参数</div></button>
        </div>
        {custom && (
          <div className={css.row}>
            SB <input type="number" value={c.sb} onChange={(e) => set({ custom: { ...c, sb: +e.target.value } })} />
            BB <input type="number" value={c.bb} onChange={(e) => set({ custom: { ...c, bb: +e.target.value } })} />
            起始筹码 <input type="number" value={c.stack} onChange={(e) => set({ custom: { ...c, stack: +e.target.value } })} />
          </div>
        )}
        <p className={css.dim}>SB/BB {cur.sb}/{cur.bb} · 起始筹码 {cur.stack} · 筹码深度 {cur.bb > 0 ? Math.floor(cur.stack / cur.bb) : '-'} BB</p>
        {err && <p className={css.err}>{err}</p>}
      </section>
      <section className={css.panel}>
        <h3>人数：{settings.players}（你 + {settings.players - 1} 个 AI）</h3>
        <input type="range" min={2} max={10} value={settings.players} onChange={(e) => set({ players: +e.target.value })} style={{ width: 300 }} />
        <h3>AI 难度</h3>
        <div className={css.row}>
          {(['easy', 'normal', 'hard'] as const).map((d) => (
            <button key={d} className={settings.difficulty === d ? css.selected : ''} onClick={() => set({ difficulty: d })}>{{ easy: '简单', normal: '普通', hard: '困难（蒙特卡洛）' }[d]}</button>
          ))}
        </div>
        <h3>AI 速度</h3>
        <div className={css.row}>
          {(['fast', 'normal', 'slow'] as const).map((sp) => (
            <button key={sp} data-testid={`speed-${sp}`} className={settings.aiSpeed === sp ? css.selected : ''} onClick={() => set({ aiSpeed: sp })}>{{ fast: '快（0.5–1 秒）', normal: '正常（2–3 秒）', slow: '慢（3–5 秒）' }[sp]}</button>
          ))}
        </div>
        <h3>选项</h3>
        <label><input type="checkbox" checked={settings.rebuy} onChange={(e) => set({ rebuy: e.target.checked })} /> 允许重买</label>{'　'}
        <label><input type="checkbox" checked={settings.timeout} onChange={(e) => set({ timeout: e.target.checked })} /> 行动超时 {settings.timeoutSec}s</label>{'　'}
        <label><input type="checkbox" checked={settings.revealAll} onChange={(e) => set({ revealAll: e.target.checked })} /> 每手结束后显示所有人手牌</label>{'　'}
        <label><input type="checkbox" checked={settings.autoNext} onChange={(e) => set({ autoNext: e.target.checked })} /> 自动开始下一手</label>{'　'}
        昵称 <input value={settings.name} maxLength={8} onChange={(e) => set({ name: e.target.value })} />
      </section>
      <button className={css.primary} disabled={!!err} onClick={onStart} data-testid="start">开始游戏</button>
      {canResume && <p className={css.dim}>开始新游戏会结束并归档当前会话。</p>}
    </div>
  );
}
