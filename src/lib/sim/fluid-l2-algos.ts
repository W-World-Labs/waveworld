/**
 * Stable Fluids 二级算法 · Boussinesq 浮力 / 固体障碍掩膜。
 * 对应 method-algo-fluid-buoyancy / method-algo-fluid-obstacle；委托 Fluid 类，不重实现。
 */
import { Fluid, IX } from './fluid'

/** 二级 · Boussinesq 浮力 */
export const FLUID_BUOYANCY_ID = 'method-algo-fluid-buoyancy'

/** 二级 · 固体障碍掩膜 */
export const FLUID_OBS_ID = 'method-algo-fluid-obstacle'

/** 父算法（与 methods.data 中 buoyancy/obstacle 的 parentId 对齐）。 */
export const FLUID_L2_PARENT = 'method-algo-fluid-pipeline'

/**
 * 浮力样例：热斑上施加 Boussinesq 力后，热点 vy < 0（向上，−y）。
 */
export function runBuoyancySample(N = 32): {
  vyHot: number
  finite: boolean
} {
  const f = new Fluid(N, { thermal: true, buoyancy: 5, ambient: 0, dt: 0.1 })
  const cx = Math.floor(N / 2)
  const cy = Math.floor(N / 2)
  for (let j = cy - 1; j <= cy + 1; j++) {
    for (let i = cx - 1; i <= cx + 1; i++) f.addTemp(i, j, 10)
  }
  f.applyBuoyancy()
  const vyHot = f.vy[IX(cx, cy, N)]!
  return {
    vyHot,
    finite: Number.isFinite(vyHot),
  }
}

/**
 * 障碍样例：固体掩膜单元上速度（及染料）被 applyObstacle 清零。
 */
export function runObstacleSample(N = 32): {
  vx: number
  vy: number
  dens: number
  solid: number
} {
  const f = new Fluid(N, {})
  const mask = new Uint8Array(N * N)
  const solid = IX(Math.floor(N / 2), Math.floor(N / 2), N)
  mask[solid] = 1
  f.setObstacle(mask)
  f.vx[solid] = 3
  f.vy[solid] = -2
  f.dens[solid] = 9
  f.applyObstacle()
  return {
    vx: f.vx[solid]!,
    vy: f.vy[solid]!,
    dens: f.dens[solid]!,
    solid,
  }
}
