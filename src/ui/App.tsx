import { useState } from 'react';
import { useGame } from '../app/useGame';
import { Setup } from './Setup';
import { Table } from './Table';
import { Stats, SessionSummary } from './Stats';
import css from './App.module.css';
import { Online } from './Online';

export function App() {
  const { st, view, dispatchEngine, setSettings, newGame, endSession, closeSummary, localId } = useGame();
  const [screen, setScreen] = useState<'setup' | 'table' | 'online'>(new URLSearchParams(location.search).has('room') ? 'online' : st.game ? 'table' : 'setup');
  const [stats, setStats] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const s = st.settings;

  return (
    <>
      {screen === 'online' ? <Online onBack={() => setScreen('setup')} defaultName={s.name} /> : screen === 'table' && view ? (
        <Table
          view={view} session={st.session} error={st.error} timeoutSec={s.timeout ? s.timeoutSec : null}
          onAct={dispatchEngine}
          onNext={() => dispatchEngine({ type: 'startHand' })}
          onRebuy={() => dispatchEngine({ type: 'rebuy', playerId: localId })}
          onStats={() => setStats(true)} onSettings={() => setSettingsOpen(true)}
          onEnd={() => { endSession(); setScreen('setup'); }}
        />
      ) : (
        <Setup settings={s} set={setSettings} canResume={!!st.game} onResume={() => setScreen('table')} onStats={() => setStats(true)} onOnline={() => setScreen('online')}
          onStart={() => { newGame(); setScreen('table'); }} />
      )}
      {stats && <Stats current={st.session} sessions={st.sessions} history={st.history} onClose={() => setStats(false)} />}
      {settingsOpen && (
        <div className={css.modalBg} onClick={() => setSettingsOpen(false)}>
          <div className={css.modal} onClick={(e) => e.stopPropagation()}>
            <h3>设置</h3>
            <p><label><input type="checkbox" checked={s.timeout} onChange={(e) => setSettings({ timeout: e.target.checked })} /> 行动超时（超时自动过牌/弃牌）</label>{' '}
              <input type="number" min={10} max={300} value={s.timeoutSec} onChange={(e) => setSettings({ timeoutSec: Math.max(10, +e.target.value) })} style={{ width: 70 }} /> 秒</p>
            <p>AI 速度 <select value={s.aiSpeed} onChange={(e) => setSettings({ aiSpeed: e.target.value as any })}><option value="fast">快（0.5–1 秒）</option><option value="normal">正常（2–3 秒）</option><option value="slow">慢（3–5 秒）</option></select></p>
            <p><label><input type="checkbox" data-testid="reveal-toggle" checked={s.revealAll} onChange={(e) => setSettings({ revealAll: e.target.checked })} /> 每手结束后显示所有人手牌</label></p>
            <p><label><input type="checkbox" checked={s.autoNext} onChange={(e) => setSettings({ autoNext: e.target.checked })} /> 自动开始下一手</label></p>
            <p className={css.dim}>场次、人数、难度、重买开关需开新会话才能更改。</p>
            <div className={css.row}>
              <button onClick={() => { setSettingsOpen(false); setScreen('setup'); }}>返回大厅（更换场次）</button>
              <button onClick={() => { endSession(); setSettingsOpen(false); setScreen('setup'); }}>结束当前会话</button>
              <button onClick={() => setSettingsOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
      {st.lastSummary && (
        <div className={css.modalBg} onClick={closeSummary}>
          <div className={css.modal} onClick={(e) => e.stopPropagation()}>
            <h3>会话总结</h3>
            <SessionSummary s={st.lastSummary} />
            <button onClick={closeSummary}>确定</button>
          </div>
        </div>
      )}
    </>
  );
}
