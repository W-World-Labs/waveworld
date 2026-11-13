/**
 * 波动方程二级算法 · poke 源扰动 / 硬障碍反射（一级 wave-algos 之外的 L2 装配）。
 * 对应 method-algo-wave-poke / method-algo-wave-obstacle；委托 Wave 类，不重实现。
 */
import { Wave } from './wave'

/** 二级 · 初始扰动 poke */
export const WAVE_POKE_ID = 'method-algo-wave-poke'

/** 二级 · 硬障碍反射 */
export const WAVE_OBS_ID = 'method-algo-wave-obstacle'

/** 二级 · 海绵层 ABC / 吸收边界 */
export const WAVE_SPONGE_ID = 'method-algo-wave-absorbing-boundary'

/** 父算法（与 methods.data 中 poke/obstacle 的 parentId 对齐）。 */
export const WAVE_L2_PARENT = 'method-algo-wave-leapfrog'

const IX = (x: number, y: number, N: number) => x + y * N

/**
 * poke 样例：中心圆盘位移扰动后能量 > 0（零初速度释放，u 与 uPrev 同步写入）。
 */
export function runPokeSample(N = 40, amt = 5): {
  energy: number
  finite: boolean
} {
  const w = new Wave(N, { a: 0.25, damp: 1 })
  w.poke(Math.floor(N / 2), Math.floor(N / 2), 2, amt)
  const energy = w.energy()
  return {
    energy,
    finite: Number.isFinite(energy) && energy >= 0,
  }
}

/**
 * 硬障碍样例：左侧驱动 + 竖墙掩膜，步进后障碍单元 ≈0，总能量有限。
 * 返回障碍列上 |u| 的最大值与全域能量。
 */
export function runObstacleSample(steps = 40): {
  maxAbsOnObstacle: number
  energy: number
  finite: boolean
} {
  const N = 48
  const w = new Wave(N, { a: 0.25, damp: 1 })
  const mask = new Uint8Array(N * N)
  const wallX = 24
  for (let y = 0; y < N; y++) mask[IX(wallX, y, N)] = 1
  w.setObstacle(mask)

  // 左侧源驱动若干步，使波抵达障碍
  for (let s = 0; s < steps; s++) {
    const k = IX(10, Math.floor(N / 2), N)
    w.u[k]! += Math.sin(s * 0.6) * 2
    w.uPrev[k]! = w.u[k]!
    w.step()
  }

  let maxAbsOnObstacle = 0
  for (let y = 0; y < N; y++) {
    const a = Math.abs(w.u[IX(wallX, y, N)]!)
    if (a > maxAbsOnObstacle) maxAbsOnObstacle = a
  }
  const energy = w.energy()
  return {
    maxAbsOnObstacle,
    energy,
    finite: Number.isFinite(energy) && energy >= 0,
  }
}

/**
 * 海绵层 ABC 样例：外缘 width 格点逐步加强阻尼，吸收外行波。
 * 对照硬壁（damp=1 全域）：海绵末能量应明显更低。
 */
export function applySpongeLayer(w: Wave, width = 4, strength = 0.15): void {
  const { N, u } = w
  const W = Math.max(1, Math.min(width, Math.floor(N / 4)))
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = Math.min(x, N - 1 - x)
      const dy = Math.min(y, N - 1 - y)
      const d = Math.min(dx, dy)
      if (d >= W) continue
      // 边界 d=0 → 最强衰减；内缘 d=W−1 → 弱衰减
      const t = 1 - d / W
      const factor = 1 - strength * t * t
      u[IX(x, y, N)]! *= factor
    }
  }
}

export function runSpongeAbcSample(
  steps = 80,
  N = 48,
): {
  eHard: number
  eSponge: number
  ratio: number
  absorbed: boolean
  methodId: typeof WAVE_SPONGE_ID
  familyId: 'method-wave-fd'
} {
  const drive = (w: Wave, sponge: boolean) => {
    for (let s = 0; s < steps; s++) {
      const k = IX(Math.floor(N / 2), Math.floor(N / 2), N)
      if (s < 8) {
        w.u[k]! += Math.sin(s * 0.8) * 3
        w.uPrev[k]! = w.u[k]!
      }
      w.step()
      if (sponge) applySpongeLayer(w, 5, 0.2)
    }
  }
  const hard = new Wave(N, { a: 0.25, damp: 1 })
  drive(hard, false)
  const sponge = new Wave(N, { a: 0.25, damp: 1 })
  drive(sponge, true)
  const eHard = hard.energy()
  const eSponge = sponge.energy()
  const ratio = eHard > 0 ? eSponge / eHard : 0
  return {
    eHard,
    eSponge,
    ratio,
    absorbed: eSponge < eHard * 0.85 && Number.isFinite(eSponge),
    methodId: WAVE_SPONGE_ID,
    familyId: 'method-wave-fd',
  }
}
