import { useEffect, useRef, useState } from 'react';
import type { Action, PlayerView } from '../engine';
import css from './Table.module.css';

export function ActionBar({ view, onAct, timeoutSec, deadline }: { view: PlayerView; onAct: (a: Action) => void; timeoutSec: number | null; deadline?: number | null }) {
  const legal = view.legal;
  const h = view.hand;
  const me = view.viewerId!;
  const [amt, setAmt] = useState(0);
  const [msg, setMsg] = useState('');
  const lock = useRef(-1); // 防抖：同一 actionSeq 只提交一次
  const seq = h?.actionSeq ?? -1;
  const pot = h ? h.committed.reduce((a, b) => a + b, 0) : 0;
  useEffect(() => { if (legal) setAmt(legal.minRaiseTo); setMsg(''); }, [seq, !!legal]); // eslint-disable-line

  const [left, setLeft] = useState(timeoutSec ?? 0);
  useEffect(() => {
    if (!legal || !timeoutSec || deadline !== undefined) return;
    setLeft(timeoutSec);
    const start = Date.now();
    const t = setInterval(() => {
      const l = timeoutSec - Math.floor((Date.now() - start) / 1000);
      setLeft(l);
      if (l <= 0) { clearInterval(t); send({ type: legal.canCheck ? 'check' : 'fold', playerId: me }); }
    }, 250);
    return () => clearInterval(t);
  }, [seq, !!legal, timeoutSec]); // eslint-disable-line

  // 联机：倒计时以房主时间戳为准，由房主执行超时
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  const remain = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : left;
  const send = (a: Action) => {
    if (lock.current === seq) return;
    lock.current = seq;
    onAct(a);
  };
  if (!legal || !h) return <div className={css.actions}><span className={css.dim}>{h && h.street !== 'complete' ? '等待其他玩家行动…' : ''}</span></div>;

  const clamp = (v: number) => {
    const c = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(v)));
    if (c !== Math.round(v)) setMsg(v < legal.minRaiseTo ? `最小${legal.isOpenBet ? '下注' : '加注到'} ${legal.minRaiseTo}` : `最多 ${legal.maxRaiseTo}（全部筹码）`);
    else setMsg('');
    return c;
  };
  const potTo = (f: number) => clamp(h.currentBet + (pot + legal.callAmount) * f);
  const raise = () => {
    const to = clamp(amt);
    send(to >= legal.maxRaiseTo ? { type: 'allin', playerId: me } : { type: legal.isOpenBet ? 'bet' : 'raise', playerId: me, amount: to });
  };
  const odds = legal.callAmount > 0 ? Math.round((legal.callAmount / (pot + legal.callAmount)) * 100) : 0;
  return (
    <div className={css.actions}>
      {timeoutSec ? <div className={css.timer} data-testid="timer" style={{ ['--p' as string]: `${Math.min(100, (remain / timeoutSec) * 100)}%` }}>{remain}</div> : null}
      <div className={css.info}>
        需跟注 <b>{legal.callAmount}</b>{legal.callAmount > 0 && <> · 底池赔率 <b>{odds}%</b></>}
      </div>
      <button className={css.fold} onClick={() => send({ type: 'fold', playerId: me })} data-testid="fold">弃牌</button>
      {legal.canCheck
        ? <button className={css.call} onClick={() => send({ type: 'check', playerId: me })} data-testid="check">过牌</button>
        : <button className={css.call} onClick={() => send({ type: legal.callAmount >= view.players[view.mySeat].stack ? 'allin' : 'call', playerId: me })} data-testid="call">跟注 {legal.callAmount}</button>}
      {legal.canRaise && (
        <div className={css.raiseBox}>
          <div className={css.quick}>
            <button onClick={() => setAmt(potTo(0.5))}>1/2 池</button>
            <button onClick={() => setAmt(potTo(2 / 3))}>2/3 池</button>
            <button onClick={() => setAmt(potTo(1))}>池</button>
            <button onClick={() => setAmt(legal.maxRaiseTo)}>All-in</button>
          </div>
          <input type="range" min={legal.minRaiseTo} max={legal.maxRaiseTo} step={1} value={amt} onChange={(e) => setAmt(+e.target.value)} />
          <input type="number" value={amt} onChange={(e) => setAmt(+e.target.value)} onBlur={() => setAmt(clamp(amt))} style={{ width: 80 }} />
          <button className={css.raise} onClick={raise} data-testid="raise">{amt >= legal.maxRaiseTo ? '全下' : legal.isOpenBet ? '下注' : '加注到'} {Math.min(amt, legal.maxRaiseTo)}</button>
        </div>
      )}
      {msg && <span className={css.warn}>{msg}</span>}
    </div>
  );
}
