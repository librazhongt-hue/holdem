/** 牌：0..51，rank = c >> 2 (0=2 … 12=A)，suit = c & 3 */
export type Card = number;
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'complete';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Personality {
  aggression: number;     // 0..1 激进度
  bluff: number;          // 0..1 诈唬频率
  mistake: number;        // 0..1 失误率
  callingStation: number; // 0..1 跟注站倾向
  vpip?: number;          // 目标入池率（翻前起手牌范围宽度）
  pfr?: number;           // 目标翻前加注率
}

export interface PlayerConfig {
  id: string;
  name: string;
  isBot: boolean;
  personality?: Personality;
  difficulty?: Difficulty;
  /** AI 风格标签（仅展示/统计用） */
  style?: string;
}

export interface Player extends PlayerConfig {
  stack: number;
  buyIns: number;
  totalBuyIn: number;
  eliminated: boolean;
  pendingRebuy: boolean;
}

export interface TableConfig {
  stakeId: string;
  sb: number;
  bb: number;
  startingStack: number;
  rebuy: boolean;
}

export interface PotResult {
  amount: number;
  eligible: string[];
  winners: string[];
  shares: Record<string, number>;
}

export interface ShownHand { cards: Card[]; score: number; name: string }

export interface HandResult {
  pots: PotResult[];
  payouts: Record<string, number>;
  net: Record<string, number>;
  showdown: boolean;
  shown: Record<string, ShownHand>;
  board: Card[];
}

export type BetActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface LogEntry {
  street: Street;
  playerId?: string;
  kind: BetActionType | 'sb' | 'bb' | 'board' | 'win' | 'refund';
  amount?: number;
  cards?: Card[];
}

export interface HandState {
  handNo: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  deck: Card[];
  holes: (Card[] | null)[];
  board: Card[];
  street: Street;
  inHand: boolean[];
  bets: number[];
  committed: number[];
  folded: boolean[];
  allIn: boolean[];
  acted: boolean[];
  /** 该玩家本街最后一次行动时面对/形成的下注水位；-1 = 本街未行动 */
  lastActedLevel: number[];
  currentBet: number;
  /** 最近一次完整加注的增量（≥BB） */
  minRaise: number;
  toAct: number;
  actionSeq: number;
  startStacks: number[];
  log: LogEntry[];
  result?: HandResult;
}

export interface GameState {
  seed: number;
  config: TableConfig;
  players: Player[];
  handNo: number;
  button: number;
  hand: HandState | null;
}

export type BetAction = { type: BetActionType; playerId: string; amount?: number };
export type Action =
  | BetAction
  | { type: 'startHand' }
  | { type: 'rebuy'; playerId: string };
