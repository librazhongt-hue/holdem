import type { LogEntry } from '../engine';
import { cardLabel } from '../engine';
export const signed = (n: number) => (n > 0 ? '+' : '') + n;
const KIND: Record<string, string> = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注到', allin: '全下', sb: '小盲', bb: '大盲', win: '赢得', refund: '退回未跟注' };
const STREET: Record<string, string> = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', complete: '结算' };
export const streetName = (s: string) => STREET[s] ?? s;
export function logText(l: LogEntry, name: (id: string) => string) {
  if (l.kind === 'board') return `—— ${streetName(l.street)}：${l.cards!.map(cardLabel).join(' ')}`;
  return `${name(l.playerId!)} ${KIND[l.kind]}${l.amount !== undefined && l.kind !== 'fold' && l.kind !== 'check' ? ' ' + l.amount : ''}`;
}
