import { describe, it, expect } from 'vitest'
import { initLattice, velocityVerlet, temperature } from './md'

// 回归：/md 盒长固定 L=18 时，1024/2048 粒子初始晶格间距 0.4–0.56σ 深入 LJ 排斥核 → 力~1e4–1e7 → 瞬爆 NaN。
// 修复：盒长 L=√(N/ρ*)（ρ*=0.8）随粒子数缩放，晶格间距恒≈1.12σ，所有档稳定。
const DENSITY = 0.8
const boxLenForN = (n: number) => Math.sqrt(n / DENSITY)

describe('/md 各粒子数密度缩放后稳定（无爆炸 NaN）', () => {
  for (const N of [64, 256, 1024, 2048]) {
    it(`N=${N}：缩放盒长 L=√(N/ρ*) 跑 150 步温度恒有限`, () => {
      const L = boxLenForN(N)
      const a = L / Math.ceil(Math.sqrt(N))
      expect(a).toBeGreaterThan(1.05) // 晶格间距落在 LJ 极小(1.12σ)附近，不进排斥核
      const st = initLattice(N, L, 2, 0.4, 1)
      for (let s = 0; s < 150; s++) {
        velocityVerlet(st, 0.005)
        expect(Number.isFinite(temperature(st.vel, N, 2))).toBe(true)
      }
    })
  }
})
