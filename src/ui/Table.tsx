import { useEffect, useState } from 'react';
import { describeHand, type Action, type PlayerView } from '../engine';
import type { SessionStats } from '../app/session';
import type { SeatInfo } from '../net/protocol';
import { CardView } from './Card';
import { ActionBar } from './ActionBar';
import { logText, signed, streetName } from './fmt';
import css from './Table.module.css';

interface Props {
  view: PlayerView; session: SessionStats | null; error: string | null; timeoutSec: number | null;
  onAct: (a: Action) => void; onNext: () => void; onRebuy: () => void; onStats: () => void; onSettings: () => void; onEnd: () => void;
  /** 联机模式附加信息 */
  online?: { code: string; seats: SeatInfo[]; deadline: number | null; banner: string | null; onLeave: () => void };
}

const BUBBLE: Record<string, string> = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注到', allin: 'All-in', sb: '小盲', bb: '大盲' };
function bubbleText(l: { kind: string; amount?: number }) {
  return BUBBLE[l.kind] + (l.kind !== 'fold' && l.kind !== 'check' && l.amount !== undefined ? ' ' + l.amount : '');
}

export function Table({ view, session, error, timeoutSec, onAct, onNext, onRebuy, onStats, onSettings, onEnd, online }: Props) {
  const h = view.hand;
  const n = view.players.length;
  const me = view.players[view.mySeat];
  const [logOpen, setLogOpen] = useState(true);
  const [float, setFloat] = useState<number | null>(null);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? id;
  const complete = h?.street === 'complete';
  const myNet = complete ? h!.result!.net[me.id] : undefined;
  useEffect(() => {
    if (myNet === undefined) return;
    setFloat(myNet);
    const t = setTimeout(() => setFloat(null), 2000);
    return () => clearTimeout(t);
  }, [h?.handNo, complete]); // eslint-disable-line

  const profit = me.stack + (h && !complete ? h.committed[view.mySeat] : 0) - (me.totalBuyIn ?? 0);
  const myHole = h?.holes[view.mySeat];
  const pot = h ? h.committed.reduce((a, b) => a + b, 0) : 0;
  const canRebuy = view.config.rebuy && me.stack === 0 && !me.pendingRebuy;

  return (
    <div className={css.wrap}>
      <header className={css.top}>
        <span>水上水下 <b className={profit >= 0 ? css.profit : css.loss} data-testid="profit">{signed(profit)}</b></span>
        <span>买入次数 <b>{me.buyIns}</b></span>
        <span>当前筹码 <b>{me.stack}</b></span>
        <span className={css.dim}>盲注 {view.config.sb}/{view.config.bb} · <span data-testid="handno">第 {view.handNo} 手</span>{session ? ` · 会话 ${session.hands} 手` : ''}</span>
        {online && <span className={css.notice}>房间 {online.code} · ⚠ 房主可见全牌，请自觉</span>}
        {online?.banner && <span className={css.warn} data-testid="banner">{online.banner}</span>}
      </header>

      <div className={css.main}>
        <div className={css.tableArea}>
          <div className={css.felt}>
            <div className={css.center}>
              <div className={css.pot} title={h?.pots.map((p, i) => `${i === 0 ? '主池' : '边池' + i}: ${p.amount}（${p.eligible.map((s) => view.players[s].name).join('、')}）`).join('\n')}>
                底池 {pot}{h && h.pots.length > 1 && <span className={css.dim}>（{h.pots.length - 1} 个边池，悬停查看）</span>}
              </div>
              <div className={css.board} data-testid="board">
                {[0, 1, 2, 3, 4].map((i) => h?.board[i] !== undefined ? <CardView key={i} card={h.board[i]} /> : <div key={i} className={css.slot} />)}
              </div>
              {h && <div className={css.dim}>{streetName(h.street)}</div>}
            </div>
            {view.players.map((p, i) => {
              const ang = Math.PI / 2 + ((i - view.mySeat) * 2 * Math.PI) / n;
              const x = 50 + 44 * Math.cos(ang), y = 50 + 40 * Math.sin(ang);
              const inHand = h?.inHand[i];
              const hole = h?.holes[i];
              const shown = h?.result?.shown[p.id];
              const won = h?.result?.payouts[p.id];
              const seatInfo = online?.seats.find((x) => x.playerId === p.id);
              const live = !!h && h.street !== 'complete';
              const lastAct = live ? [...h!.log].reverse().find((l) => l.playerId === p.id && l.street === h!.street && BUBBLE[l.kind]) : undefined;
              const thinking = live && h!.toAct === i && p.isBot;
              const lastLog = h?.log[h.log.length - 1];
              const fly = live && lastLog?.playerId === p.id && ['call', 'bet', 'raise', 'allin'].includes(lastLog.kind) ? h!.log.length : null;
              const offline = seatInfo && !seatInfo.connected;
              const otherProfit = i !== view.mySeat && p.totalBuyIn !== undefined ? p.stack + (h && !complete ? h.committed[i] : 0) - p.totalBuyIn : null;
              const status0 = !inHand ? (p.stack === 0 ? (p.pendingRebuy ? '已重买' : p.eliminated ? '淘汰' : '待重买') : '') : h!.folded[i] ? '弃牌' : h!.allIn[i] ? '全下' : h!.toAct === i ? '行动中' : '';
              const status = [offline ? '离线' : '', status0].filter(Boolean).join(' · ');
              return (
                <div key={p.id} className={`${css.seat} ${h?.toAct === i ? css.active : ''} ${thinking ? css.thinkingSeat : ''} ${h?.folded[i] || !inHand ? css.out : ''}`} style={{ left: `${x}%`, top: `${y}%` }} data-testid={`seat-${i}`}>
                  <div className={css.hole}>
                    {inHand && !h!.folded[i] && [0, 1].map((k) => <CardView key={k} small card={hole ? hole[k] : null} />)}
                    {inHand && h!.folded[i] && complete && hole && <div className={css.foldedCards} title="已弃牌">{[0, 1].map((k) => <CardView key={k} small card={hole[k]} />)}</div>}
                  </div>
                  <div className={css.plate}>
                    <div className={css.pname}>{p.name}{h?.button === i && <span className={css.btn}>D</span>}{h?.sbSeat === i && <span className={css.tag}>SB</span>}{h?.bbSeat === i && <span className={css.tag}>BB</span>}</div>
                    <div>{p.stack}</div>
                    {status && <div className={css.status}>{status}</div>}
                    {shown && <div className={css.status}>{shown.name}</div>}
                    {won ? <div className={css.profit}>+{won}</div> : null}
                    {otherProfit !== null && <div className={`${css.dim} ${otherProfit >= 0 ? css.profit : css.loss}`}>盈亏 {signed(otherProfit)}</div>}
                  </div>
                  {h && h.bets[i] > 0 && !complete && <div key={h.bets[i]} className={css.bet}>{h.bets[i]}</div>}
                  {thinking && <div className={css.thinking} data-testid="thinking">思考中<span className={css.dots}><i>.</i><i>.</i><i>.</i></span></div>}
                  {!thinking && lastAct && <div key={h!.log.indexOf(lastAct)} className={`${css.bubble} ${css['b_' + lastAct.kind]}`} data-testid="bubble">{bubbleText(lastAct)}</div>}
                  {fly !== null && <div key={'fly' + fly} className={css.fly} style={{ ['--dx' as string]: `${(50 - x) * 9}px`, ['--dy' as string]: `${(50 - y) * 4.4}px` }} />}
                </div>
              );
            })}
            {float !== null && <div className={`${css.float} ${float >= 0 ? css.profit : css.loss}`}>{signed(float)}</div>}
          </div>
          {myHole && <div className={css.myHand}>我的牌型：<b>{describeHand([...myHole, ...(h!.board)])}</b></div>}
          {complete && h!.result && (
            <div className={css.result} data-testid="result">
              {h!.result.pots.map((p, i) => (
                <div key={i}>{i === 0 ? '主池' : `边池${i}`} {p.amount}：{p.winners.map(name).join('、')} 获胜{h!.result!.shown[p.winners[0]] ? `（${h!.result!.shown[p.winners[0]].name}）` : ''}{p.winners.length > 1 ? ' 平分' : ''}</div>
              ))}
              {myNet !== undefined && <div>本手盈亏：<b className={myNet >= 0 ? css.profit : css.loss}>{signed(myNet)}</b></div>}
            </div>
          )}
          <ActionBar view={view} onAct={onAct} timeoutSec={timeoutSec} deadline={online ? online.deadline : undefined} />
          {error && <div className={css.warn}>{error}</div>}
        </div>
        <aside className={css.log}>
          <div className={css.logHead} onClick={() => setLogOpen(!logOpen)}>行动日志 {logOpen ? '▾' : '▸'}</div>
          {logOpen && <div className={css.logBody}>{h?.log.map((l, i) => <div key={i}>{logText(l, name)}</div>)}</div>}
        </aside>
      </div>

      <footer className={css.bottom}>
        {online ? <>
          <button onClick={onRebuy} disabled={!canRebuy} data-testid="rebuy">重买（{view.config.startingStack}）</button>
          <button onClick={online.onLeave} data-testid="leave">离开房间</button>
        </> : <>
        <button onClick={onNext} disabled={!complete} data-testid="next">新一局</button>
        <button onClick={onRebuy} disabled={!canRebuy} data-testid="rebuy">重买（{view.config.startingStack}）</button>
        <button onClick={onSettings}>设置</button>
        <button onClick={onStats}>统计</button>
        <button onClick={onEnd}>结束会话</button>
        </>}
      </footer>
    </div>
  );
}
