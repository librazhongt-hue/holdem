export interface Stake { id: string; name: string; sb: number; bb: number; stack: number; desc: string }
export const STAKES: Stake[] = [
  { id: 'novice', name: '新手场', sb: 5, bb: 10, stack: 1000, desc: '休闲、容错高' },
  { id: 'standard', name: '标准场', sb: 10, bb: 20, stack: 1000, desc: '常规体验' },
  { id: 'deep', name: '深筹场', sb: 10, bb: 20, stack: 2000, desc: '更多翻后操作空间' },
  { id: 'turbo', name: '快节奏场', sb: 25, bb: 50, stack: 1000, desc: '短筹码、激进、单手快' },
];
export function validateCustom(sb: number, bb: number, stack: number, players: number): string | null {
  if (!Number.isInteger(sb) || !Number.isInteger(bb) || !Number.isInteger(stack) || sb <= 0) return '请输入正整数';
  if (sb >= bb) return 'SB 必须小于 BB';
  if (stack < bb * 10) return '起始筹码需 ≥ 10BB';
  if (players < 2 || players > 10) return '人数需在 2~10 之间';
  return null;
}
