import { describe, it, expect } from 'vitest'
import {
  WAVE_L2_PARENT,
  WAVE_OBS_ID,
  WAVE_POKE_ID,
  WAVE_SPONGE_ID,
  runObstacleSample,
  runPokeSample,
  runSpongeAbcSample,
} from './wave-l2-algos'

describe('波动方程二级算法 · poke / 硬障碍 / 海绵', () => {
  it('方法 id 常量对齐目录', () => {
    expect(WAVE_POKE_ID).toBe('method-algo-wave-poke')
    expect(WAVE_OBS_ID).toBe('method-algo-wave-obstacle')
    expect(WAVE_SPONGE_ID).toBe('method-algo-wave-absorbing-boundary')
    expect(WAVE_L2_PARENT).toBe('method-algo-wave-leapfrog')
  })

  it('runPokeSample：poke 后能量 > 0 且有限', () => {
    const r = runPokeSample()
    expect(r.finite).toBe(true)
    expect(r.energy).toBeGreaterThan(0)
  })

  it('runObstacleSample：障碍单元 ≈0，能量有限', () => {
    const r = runObstacleSample()
    expect(r.finite).toBe(true)
    expect(Number.isFinite(r.energy)).toBe(true)
    // step 末尾强制 next[obstacle]=0
    expect(r.maxAbsOnObstacle).toBeLessThan(1e-12)
  })

  it('runSpongeAbcSample：海绵末能量低于硬壁', () => {
    const r = runSpongeAbcSample()
    expect(r.methodId).toBe(WAVE_SPONGE_ID)
    expect(r.eHard).toBeGreaterThan(0)
    expect(r.eSponge).toBeGreaterThanOrEqual(0)
    expect(r.absorbed).toBe(true)
    expect(r.ratio).toBeLessThan(0.85)
  })
})
