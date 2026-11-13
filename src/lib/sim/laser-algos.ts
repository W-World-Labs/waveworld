import { WasmLaser } from './wasm-fields'
/**
 * 激光速率方程方法族 · 阈值 / 稳态 / 步进 纯函数样例入口。
 * 对应 method-laser-rate；不重实现物理，只装配 laser.ts 已导出核心。
 */
import {
  DEFAULT,
  laserStep,
  steadyPhotons,
  thresholdPump,
  type LaserParams,
  type LaserState,
} from './laser'

export const LASER_PARENT = 'method-laser-rate'

/** 阈值泵浦：P_th = 1/(B·τC·τN) > 0。 */
export function runThresholdSample(p: LaserParams = DEFAULT): { Pth: number } {
  return { Pth: thresholdPump(p) }
}

/**
 * 稳态光子：阈下 S≈0，阈上明显更大（起振）。
 * 复用 steadyPhotons 对同一速率方程的解析稳态解。
 */
export function runSteadySample(p: LaserParams = DEFAULT): {
  Pth: number
  below: number
  above: number
} {
  const Pth = thresholdPump(p)
  return {
    Pth,
    below: steadyPhotons(Pth * 0.5, p),
    above: steadyPhotons(Pth * 3, p),
  }
}

/**
 * 短程 laserStep：N、S 保持有限且非负。
 * 泵浦取阈上，初值小反转/小光子。
 */
export function runStepSample(
  steps = 40,
  p: LaserParams = DEFAULT,
): { N: number; S: number; finite: boolean; nonNeg: boolean } {
  const owner = new WasmLaser()
  const pump = thresholdPump(p, owner) * 2
  let s: LaserState = { N: 0.1, S: 0.01 }
  for (let i = 0; i < steps; i++) s = laserStep(s, pump, 0.01, p, owner)
  return {
    N: s.N,
    S: s.S,
    finite: Number.isFinite(s.N) && Number.isFinite(s.S),
    nonNeg: s.N >= 0 && s.S >= 0,
  }
}
