import { describe, it, expect } from 'vitest'
import {
  onsagerTc, onsagerMagnetization, initIsing, metropolisSweep,
  magnetization, energyPerSpin, deltaE,
} from './ising'

describe('Onsager 精确解（对拍护栏的参考）', () => {
  it('临界温度 Tc = 2/ln(1+√2) ≈ 2.2692', () => {
    expect(onsagerTc()).toBeCloseTo(2.269185, 5)
  })
  it('自发磁化：T≥Tc 为 0；T<Tc 正且随 T 升单调降到 0', () => {
    const Tc = onsagerTc()
    expect(onsagerMagnetization(Tc + 0.01)).toBe(0)
    expect(onsagerMagnetization(5)).toBe(0)
    expect(onsagerMagnetization(1.5)).toBeCloseTo(0.98650, 4) // Onsager 精确值 m(1.5)
    expect(onsagerMagnetization(1.0)).toBeGreaterThan(onsagerMagnetization(2.0))
    expect(onsagerMagnetization(2.0)).toBeGreaterThan(0)
    // β=1/8：临界指数小，m 在 Tc 附近陡降但仍有限（m(Tc⁻)≈0.197，不是 <0.1）
    expect(onsagerMagnetization(Tc - 1e-6)).toBeGreaterThan(0)
    expect(onsagerMagnetization(Tc - 1e-6)).toBeLessThan(0.25)
  })
})

describe('Ising 核心', () => {
  it('基态能量：全对齐 → E/N = -2J（2D 4 近邻，每键计一次）', () => {
    const st = initIsing(16, 1.0, 1, false) // cold=全 +1
    expect(energyPerSpin(st)).toBeCloseTo(-2, 9)
    expect(magnetization(st)).toBeCloseTo(1, 9)
  })
  it('ΔE = 2·J·s_i·Σ近邻：全对齐时翻一个 → +8', () => {
    const st = initIsing(16, 1.0, 1, false)
    expect(deltaE(st, 0)).toBe(8) // s=+1, 4 近邻全 +1 → 2·1·4=8
  })
  it('低温从冷启动保持有序（m≈1）', () => {
    const st = initIsing(24, 0.5, 2, false)
    for (let s = 0; s < 200; s++) metropolisSweep(st)
    expect(magnetization(st)).toBeGreaterThan(0.95)
  })
  it('高温从热启动趋无序（m→0）', () => {
    const st = initIsing(32, 6.0, 3, true)
    for (let s = 0; s < 300; s++) metropolisSweep(st)
    expect(magnetization(st)).toBeLessThan(0.15)
  })
})

describe('★ 对拍护栏：MC 平衡磁化落在 Onsager 精确曲线上（浏览器内定量科学）', () => {
  // L=48 冷启动，T<Tc，平衡后 ⟨|m|⟩ 应匹配 onsagerMagnetization(T)
  for (const [T, tol] of [[1.6, 0.04], [1.8, 0.05], [2.0, 0.07]] as const) {
    it(`T=${T}：⟨|m|⟩ ≈ Onsager m(T)（±${tol}）`, () => {
      const st = initIsing(48, T, 12345, false)
      for (let s = 0; s < 600; s++) metropolisSweep(st)   // 平衡
      let sum = 0, n = 0
      for (let s = 0; s < 300; s++) { metropolisSweep(st); sum += magnetization(st); n++ }
      const mMc = sum / n
      const mExact = onsagerMagnetization(T)
      expect(Math.abs(mMc - mExact)).toBeLessThan(tol)
    })
  }
})
