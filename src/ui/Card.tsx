import { rankOf, suitOf, RANKS, SUITS, type Card } from '../engine';
import css from './Card.module.css';
const SUIT_CLS = ['spade', 'heart', 'diamond', 'club'];
export function CardView({ card, small }: { card: Card | null; small?: boolean }) {
  if (card === null) return <div className={`${css.card} ${css.back} ${small ? css.small : ''}`} aria-label="背面" />;
  const r = RANKS[rankOf(card)].replace('T', '10');
  const s = suitOf(card);
  return (
    <div className={`${css.card} ${css[SUIT_CLS[s]]} ${small ? css.small : ''}`} aria-label={r + SUITS[s]}>
      <span className={css.rank}>{r}</span>
      <span className={css.suit}>{SUITS[s]}</span>
    </div>
  );
}
