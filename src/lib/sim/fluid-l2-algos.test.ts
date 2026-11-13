import { describe, it, expect } from 'vitest'
import {
  FLUID_BUOYANCY_ID,
  FLUID_L2_PARENT,
  FLUID_OBS_ID,
  runBuoyancySample,
  runObstacleSample,
} from './fluid-l2-algos'

describe('Stable Fluids 二级算法 · 浮力 / 障碍', () => {
  it('方法 id 常量对齐目录', () => {
    expect(FLUID_BUOYANCY_ID).toBe('method-algo-fluid-buoyancy')
    expect(FLUID_OBS_ID).toBe('method-algo-fluid-obstacle')
    expect(FLUID_L2_PARENT).toBe('method-algo-fluid-pipeline')
  })

  it('runBuoyancySample：热点 vy < 0（热浮力上浮）', () => {
    const r = runBuoyancySample()
    expect(r.finite).toBe(true)
    expect(r.vyHot).toBeLessThan(0)
  })

  it('runObstacleSample：固体单元速度与染料归零', () => {
    const r = runObstacleSample()
    expect(r.vx).toBe(0)
    expect(r.vy).toBe(0)
    expect(r.dens).toBe(0)
  })
})
