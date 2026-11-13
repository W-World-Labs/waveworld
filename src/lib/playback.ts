// 变速播放：把每帧 speed×base 步累加到余量累加器，取整数步推进、保留小数余量到下一帧。
// speed=1 → 原速（每帧 base 步）；speed<1 → 慢放（部分帧 0 步，画面静止一两帧）；speed>1 → 快进。
// 不改物理 dt（精度/稳定性不变），只调「每帧推进多少仿真步」=播放速度。

export interface StepAccumulator { v: number }

/** 推进累加器，返回本帧应执行的整数仿真步数。 */
export function drainSteps(acc: StepAccumulator, speed: number, base: number): number {
  // 非有限或负值视为 0，避免 NaN/负数步污染累加器与调用方。
  const s = Number.isFinite(speed) && speed >= 0 ? speed : 0
  const b = Number.isFinite(base) && base >= 0 ? base : 0
  acc.v += s * b
  const n = Math.floor(acc.v)
  acc.v -= n
  return n < 0 ? 0 : n
}
