import type { Card } from './types';
export const RANKS = '23456789TJQKA';
export const SUITS = ['♠', '♥', '♦', '♣'];
export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const fullDeck = (): Card[] => Array.from({ length: 52 }, (_, i) => i);
export function cardFromStr(s: string): Card {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = 'shdc'.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error('bad card ' + s);
  return (r << 2) | su;
}
export const cards = (s: string) => s.trim().split(/\s+/).map(cardFromStr);
export const cardLabel = (c: Card) => RANKS[rankOf(c)].replace('T', '10') + SUITS[suitOf(c)];
