import { useState } from 'react';
import { useOnline, savedHostRoom } from '../app/useOnline';
import { STAKES } from '../app/stakes';
import { loadPeerSettings, savePeerSettings, type PeerSettings } from '../net/peer';
import { Table } from './Table';
import css from './App.module.css';

const q = new URLSearchParams(location.search);

export function Online({ onBack, defaultName }: { onBack: () => void; defaultName: string }) {
  const o = useOnline();
  const { st } = o;
  const [name, setName] = useState(localStorage.getItem('holdem.onlineName') || defaultName || '玩家');
  const [code, setCode] = useState(q.get('room') ?? '');
  const [cfg, setCfg] = useState({ maxPlayers: 6, stakeId: 'standard', difficulty: 'normal' as const, publicProfit: false, revealAll: false, rebuy: true, aiSpeed: 'normal' as 'fast' | 'normal' | 'slow' });
  const [peer, setPeer] = useState<PeerSettings>(loadPeerSettings());
  const [showPeer, setShowPeer] = useState(false);
  const saved = savedHostRoom();
  const rememberName = () => localStorage.setItem('holdem.onlineName', name);
  const stakeCfg = () => {
    const s = STAKES.find((x) => x.id === cfg.stakeId)!;
    return { ...cfg, stakeLabel: s.name, sb: s.sb, bb: s.bb, stack: s.stack };
  };

  // ---------- 牌桌 ----------
  if (st.view && st.room && st.room.phase !== 'lobby' && st.status !== 'closed') {
    const banner = st.status === 'reconnecting' ? '与房主连接中断，正在重连…' : st.error;
    return (
      <Table view={st.view} session={null} error={null} timeoutSec={st.room.config.timeoutSec}
        onAct={(a) => o.act(a as any)} onNext={() => {}} onRebuy={() => o.myId && o.act({ type: 'rebuy', playerId: o.myId })}
        onStats={() => {}} onSettings={() => {}} onEnd={() => {}}
        online={{ code: st.room.code, seats: st.room.seats, deadline: st.deadline, banner, onLeave: () => { o.leave(); onBack(); } }} />
    );
  }

  // ---------- 已关闭 ----------
  if (st.role !== 'none' && st.status === 'closed') {
    return (
      <div className={css.setup}>
        <h2 data-testid="closed">{st.closedReason ?? '房间已关闭'}</h2>
        <button onClick={() => { o.leave(); onBack(); }}>返回主菜单</button>
      </div>
    );
  }

  // ---------- 房间大厅 ----------
  if (st.room && st.room.phase === 'lobby') {
    const r = st.room;
    const isHost = st.role === 'host';
    const link = `${location.origin}${location.pathname}?room=${r.code}`;
    return (
      <div className={css.setup}>
        <h2>房间码：<span data-testid="roomcode" style={{ letterSpacing: 6, color: 'var(--color-accent)' }}>{r.code}</span></h2>
        {location.protocol === 'file:'
          ? <p className={css.dim}>本地文件版：请把 6 位房间码发给朋友（朋友也需打开这个 HTML 文件，进入「联机对战」输入房间码）。本地链接无法分享。</p>
          : <p className={css.dim}>把房间码或链接发给朋友：{link} <button onClick={() => navigator.clipboard?.writeText(link)}>复制链接</button></p>}
        <p className={css.warn ?? ''} style={{ color: 'var(--color-accent)' }}>⚠ 房主可见全牌，请自觉。行动超时强制开启（{r.config.timeoutSec}s）。</p>
        <section className={css.panel}>
          <h3>座位（{r.seats.length}/{r.config.maxPlayers}，空位开局时由 AI 补足）</h3>
          {r.seats.map((s) => <div key={s.playerId} data-testid="lobby-seat">{s.isHost ? '👑 ' : ''}{s.name}{s.playerId === o.myId ? '（你）' : ''}</div>)}
        </section>
        <section className={css.panel}>
          <h3>房间设置{isHost ? '' : '（由房主决定）'}</h3>
          <div className={css.row}>
            人数 <input type="number" min={2} max={10} disabled={!isHost} value={r.config.maxPlayers} onChange={(e) => o.setConfig({ maxPlayers: +e.target.value })} />
            场次 <select disabled={!isHost} value={r.config.stakeId} onChange={(e) => { const s = STAKES.find((x) => x.id === e.target.value)!; o.setConfig({ stakeId: s.id, stakeLabel: s.name, sb: s.sb, bb: s.bb, stack: s.stack }); }}>
              {STAKES.map((s) => <option key={s.id} value={s.id}>{s.name} {s.sb}/{s.bb}·{s.stack}</option>)}
            </select>
            AI 速度 <select disabled={!isHost} value={r.config.aiSpeed ?? 'normal'} onChange={(e) => o.setConfig({ aiSpeed: e.target.value as any })}>
              <option value="fast">快</option><option value="normal">正常</option><option value="slow">慢</option>
            </select>
            AI 难度 <select disabled={!isHost} value={r.config.difficulty} onChange={(e) => o.setConfig({ difficulty: e.target.value as any })}>
              <option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option>
            </select>
            <label><input type="checkbox" disabled={!isHost} checked={r.config.publicProfit} onChange={(e) => o.setConfig({ publicProfit: e.target.checked })} /> 公开他人盈亏</label>
            <label><input type="checkbox" disabled={!isHost} checked={r.config.rebuy} onChange={(e) => o.setConfig({ rebuy: e.target.checked })} /> 允许重买</label>
            <label><input type="checkbox" disabled={!isHost} checked={r.config.revealAll} onChange={(e) => o.setConfig({ revealAll: e.target.checked })} /> 每手结束后显示所有人手牌</label>
          </div>
          {st.error && <p className={css.err}>{st.error}</p>}
        </section>
        <div className={css.row}>
          {isHost ? <button className={css.primary} onClick={o.start} data-testid="startroom">开始游戏</button> : <span>等待房主开始…</span>}
          <button onClick={() => { o.leave(); onBack(); }}>{isHost ? '解散房间' : '离开房间'}</button>
        </div>
      </div>
    );
  }

  // ---------- 菜单 ----------
  const busy = st.status === 'opening' || (st.role === 'guest' && st.status === 'connecting');
  return (
    <div className={css.setup}>
      <h1>联机对战</h1>
      <p style={{ color: 'var(--color-accent)' }}>⚠ 房主浏览器为权威端，房主可见全牌，请自觉。</p>
      {location.protocol === 'file:' && <p className={css.dim}>你正在使用本地文件版。联机需要联网（经 PeerJS 公共服务器建立连接）；朋友需要拿到同一个 HTML 文件，并输入房间码加入。若连接失败，多半是网络限制，可在下方「网络设置」配置 TURN。</p>}
      <div className={css.row}>昵称 <input data-testid="name" value={name} maxLength={8} onChange={(e) => setName(e.target.value)} /></div>
      <section className={css.panel}>
        <h3>创建房间</h3>
        <div className={css.row}>
          人数 <input type="number" min={2} max={10} value={cfg.maxPlayers} onChange={(e) => setCfg({ ...cfg, maxPlayers: Math.max(2, Math.min(10, +e.target.value)) })} />
          场次 <select value={cfg.stakeId} onChange={(e) => setCfg({ ...cfg, stakeId: e.target.value })}>{STAKES.map((s) => <option key={s.id} value={s.id}>{s.name} {s.sb}/{s.bb}</option>)}</select>
          AI 速度 <select value={cfg.aiSpeed} onChange={(e) => setCfg({ ...cfg, aiSpeed: e.target.value as any })}><option value="fast">快</option><option value="normal">正常</option><option value="slow">慢</option></select>
          AI <select value={cfg.difficulty} onChange={(e) => setCfg({ ...cfg, difficulty: e.target.value as any })}><option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option></select>
          <label><input type="checkbox" checked={cfg.publicProfit} onChange={(e) => setCfg({ ...cfg, publicProfit: e.target.checked })} /> 公开他人盈亏</label>
          <label><input type="checkbox" checked={cfg.rebuy} onChange={(e) => setCfg({ ...cfg, rebuy: e.target.checked })} /> 允许重买</label>
          <label><input type="checkbox" checked={cfg.revealAll} onChange={(e) => setCfg({ ...cfg, revealAll: e.target.checked })} /> 每手结束后显示所有人手牌</label>
        </div>
        <div className={css.row}>
          <button className={css.primary} disabled={busy} onClick={() => { rememberName(); o.createRoom(name, stakeCfg()); }} data-testid="create">创建房间</button>
          {saved && <button disabled={busy} onClick={() => { rememberName(); o.createRoom(name, {}, saved); }} data-testid="restore">恢复我的房间 {saved.code}</button>}
        </div>
      </section>
      <section className={css.panel}>
        <h3>加入房间</h3>
        <div className={css.row}>
          房间码 <input data-testid="code" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ width: 100, letterSpacing: 4 }} />
          <button className={css.primary} disabled={busy || code.length !== 6} onClick={() => { rememberName(); o.joinRoom(code, name); }} data-testid="join">加入</button>
          {busy && <span className={css.dim}>连接中…</span>}
          {st.role === 'guest' && st.status === 'reconnecting' && <span className={css.err}>暂时无法连接房主，正在重试…（若长时间失败，可能需要在网络设置中配置 TURN）</span>}
        </div>
      </section>
      {st.error && <p className={css.err} data-testid="neterr">{st.error}</p>}
      <section className={css.panel}>
        <h3 onClick={() => setShowPeer(!showPeer)} style={{ cursor: 'pointer' }}>网络设置（自定义 PeerJS 服务器 / TURN）{showPeer ? '▾' : '▸'}</h3>
        {showPeer && (
          <>
            <p className={css.dim}>留空使用 PeerJS 公共信令服务器。双方处于严格 NAT 时需配置 TURN 中继。</p>
            <div className={css.row}>
              主机 <input value={peer.host ?? ''} placeholder="0.peerjs.com" onChange={(e) => setPeer({ ...peer, host: e.target.value || undefined })} />
              端口 <input type="number" value={peer.port ?? ''} onChange={(e) => setPeer({ ...peer, port: e.target.value ? +e.target.value : undefined })} style={{ width: 80 }} />
              路径 <input value={peer.path ?? ''} placeholder="/" onChange={(e) => setPeer({ ...peer, path: e.target.value || undefined })} style={{ width: 100 }} />
              <label><input type="checkbox" checked={!!peer.secure} onChange={(e) => setPeer({ ...peer, secure: e.target.checked })} /> HTTPS/WSS</label>
            </div>
            <div className={css.row}>
              TURN <input value={peer.turnUrl ?? ''} placeholder="turn:turn.example.com:3478" onChange={(e) => setPeer({ ...peer, turnUrl: e.target.value || undefined })} />
              用户 <input value={peer.turnUser ?? ''} onChange={(e) => setPeer({ ...peer, turnUser: e.target.value || undefined })} />
              密码 <input type="password" value={peer.turnPass ?? ''} onChange={(e) => setPeer({ ...peer, turnPass: e.target.value || undefined })} />
              <button onClick={() => savePeerSettings(peer)}>保存</button>
            </div>
          </>
        )}
      </section>
      <button onClick={onBack}>返回</button>
    </div>
  );
}
