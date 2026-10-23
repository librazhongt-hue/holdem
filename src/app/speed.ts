/** AI 思考延时（仅 UI / 房主端；引擎保持纯函数） */
export type AiSpeed = 'fast' | 'normal' | 'slow';
export const AI_SPEEDS: Record<AiSpeed, { label: string; ms: [number, number] }> = {
  fast: { label: '快', ms: [500, 1000] },
  normal: { label: '正常', ms: [2000, 3000] },
  slow: { label: '慢', ms: [3000, 5000] },
};
/** 换街 / 发牌后的额外停顿 */
export const STREET_PAUSE_MS = 800;
/** 测试参数 ?fast=1：极速 */
export const TEST_FAST = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fast') === '1';
export function aiDelayRange(speed: AiSpeed): [number, number] {
  return TEST_FAST ? [40, 80] : AI_SPEEDS[speed]?.ms ?? AI_SPEEDS.normal.ms;
}
/** 最后一条日志是发牌（或刚开局）时，额外停顿 */
export function streetPause(log: { kind: string }[]): number {
  if (TEST_FAST) return 0;
  const last = log[log.length - 1];
  return !last || last.kind === 'board' || last.kind === 'bb' ? STREET_PAUSE_MS : 0;
}
