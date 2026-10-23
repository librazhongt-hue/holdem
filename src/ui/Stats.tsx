import { useState } from 'react';
import { cardLabel } from '../engine';
import { globalByStake, type HandRecord, type SessionStats } from '../app/session';
import { signed } from './fmt';
import css from './App.module.css';

export function SessionSummary({ s }: { s: SessionStats }) {
  return (
    <div className={css.grid}>
      <span>场次</span><b>{s.stakeLabel}</b>
      <span>总手数</span><b>{s.hands}</b>
      <span>总盈亏</span><b className={s.profit >= 0 ? css.profit : css.loss}>{signed(s.profit)}</b>
      <span>买入次数</span><b>{s.buyIns}（共 {s.totalBuyIn}）</b>
      <span>胜率</span><b>{s.hands ? Math.round((s.wins / s.hands) * 100) : 0}%</b>
      <span>最大单手盈利 / 亏损</span><b>{signed(s.maxWin)} / {signed(s.maxLoss)}</b>
    </div>
  );
}

export function Stats({ current, sessions, history, onClose }: { current: SessionStats | null; sessions: SessionStats[]; history: HandRecord[]; onClose: () => void }) {
  const [tab, setTab] = useState<'session' | 'history' | 'hands'>('session');
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className={css.modalBg} onClick={onClose}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <div className={css.row}>
          <button className={tab === 'session' ? css.selected : ''} onClick={() => setTab('session')}>当前会话</button>
          <button className={tab === 'history' ? css.selected : ''} onClick={() => setTab('history')}>历史会话 / 全局</button>
          <button className={tab === 'hands' ? css.selected : ''} onClick={() => setTab('hands')}>手牌历史</button>
          <span style={{ flex: 1 }} /><button onClick={onClose}>关闭</button>
        </div>
        {tab === 'session' && (current ? <SessionSummary s={current} /> : <p className={css.dim}>暂无进行中的会话</p>)}
        {tab === 'history' && (
          <>
            <h3>全局累计（按场次）</h3>
            <table className={css.tbl}><thead><tr><th>场次</th><th>会话数</th><th>手数</th><th>买入</th><th>盈亏</th></tr></thead>
              <tbody>{globalByStake(sessions).map((g) => <tr key={g.label}><td>{g.label}</td><td>{g.sessions}</td><td>{g.hands}</td><td>{g.buyIns}</td><td className={g.profit >= 0 ? css.profit : css.loss}>{signed(g.profit)}</td></tr>)}</tbody></table>
            <h3>最近 20 个会话</h3>
            {sessions.length === 0 && <p className={css.dim}>暂无</p>}
            {sessions.map((s, i) => (
              <div key={s.id} className={css.item} onClick={() => setOpen(open === i ? null : i)}>
                {new Date(s.startedAt).toLocaleString('zh-CN')} · {s.stakeLabel} · {s.hands} 手 · <b className={s.profit >= 0 ? css.profit : css.loss}>{signed(s.profit)}</b>
                {open === i && <SessionSummary s={s} />}
              </div>
            ))}
          </>
        )}
        {tab === 'hands' && (
          <>
            {history.length === 0 && <p className={css.dim}>暂无</p>}
            {history.map((h, i) => (
              <div key={h.time + '-' + h.handNo} className={css.item} onClick={() => setOpen(open === i ? null : i)}>
                第 {h.handNo} 手 · 我的牌 {h.myHole?.map(cardLabel).join(' ') ?? '—'} · <b className={h.net >= 0 ? css.profit : css.loss}>{signed(h.net)}</b>
                {open === i && (
                  <div className={css.dim}>
                    <div>公共牌：{h.board.map(cardLabel).join(' ') || '（未发）'}</div>
                    {Object.entries(h.result.shown).map(([id, s]) => <div key={id}>{h.names[id]}：{s.cards.map(cardLabel).join(' ')}（{s.name}）</div>)}
                    {h.allHoles && Object.entries(h.allHoles).filter(([id]) => !h.result.shown[id]).map(([id, x]) => <div key={id}>{h.names[id]}：{x.cards.map(cardLabel).join(' ')}{x.folded ? '（弃牌）' : ''}</div>)}
                    {h.result.pots.map((p, k) => <div key={k}>{k === 0 ? '主池' : '边池' + k} {p.amount} → {p.winners.map((w) => `${h.names[w]} ${p.shares[w]}`).join('、')}</div>)}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
