import { describe, it, expect } from 'vitest'
import { Wave, laplacian } from './wave'

const IX = (x: number, y: number, N: number) => x + y * N

describe('2D 波动方程 leapfrog', () => {
  const N = 48

  it('laplacian：均匀场为 0，峰值为负', () => {
    const u = new Float32Array(N * N).fill(1)
    expect(laplacian(u, 5, 5, N)).toBeCloseTo(0, 9)
    const v = new Float32Array(N * N); v[IX(5, 5, N)] = 1
    expect(laplacian(v, 5, 5, N)).toBe(-4)
  })

  it('扰动向外传播：远处先静后动', () => {
    const w = new Wave(N, { a: 0.25, damp: 1 })
    w.poke(N / 2, N / 2, 2, 5)
    const far = IX(N / 2 + 12, N / 2, N)
    expect(Math.abs(w.u[far])).toBeCloseTo(0, 6) // 初始远处为 0
    for (let s = 0; s < 30; s++) w.step()
    expect(Math.abs(w.u[far])).toBeGreaterThan(1e-4) // 波到达远处
  })

  it('中心扰动保持左右对称', () => {
    const w = new Wave(N, { a: 0.25, damp: 1 })
    w.poke(N / 2, N / 2, 2, 5)
    for (let s = 0; s < 15; s++) w.step()
    for (let d = 1; d <= 8; d++) {
      const l = w.u[IX(N / 2 - d, N / 2, N)]
      const r = w.u[IX(N / 2 + d, N / 2, N)]
      expect(l).toBeCloseTo(r, 4)
    }
  })

  it('内部障碍反射：墙后能量远小于无墙', () => {
    const drive = (w: Wave) => {
      for (let s = 0; s < 60; s++) {
        w.u[IX(12, N / 2, N)] += Math.sin(s * 0.6) * 2 // 左侧驱动源
        w.uPrev[IX(12, N / 2, N)] = w.u[IX(12, N / 2, N)]
        w.step()
      }
    }
    const behind = (w: Wave) => {
      let e = 0
      for (let y = 1; y < N - 1; y++) for (let x = 34; x < N - 1; x++) e += w.u[IX(x, y, N)] ** 2
      return e
    }
    const open = new Wave(N, { a: 0.25, damp: 1 }); drive(open)
    const walled = new Wave(N, { a: 0.25, damp: 1 })
    const mask = new Uint8Array(N * N)
    for (let y = 0; y < N; y++) mask[IX(30, y, N)] = 1 // x=30 整列墙
    walled.setObstacle(mask); drive(walled)
    expect(behind(walled)).toBeLessThan(behind(open) * 0.1) // 墙后能量被挡掉一个量级
  })

  it('数值稳定：长时间能量有界、有限', () => {
    const w = new Wave(N, { a: 0.25, damp: 0.999 })
    w.poke(N / 2, N / 2, 3, 8)
    const e0 = w.energy()
    for (let s = 0; s < 300; s++) w.step()
    const e = w.energy()
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeLessThan(e0 * 1.5)   // 从静止释放 + 阻尼 → 位移能量不放大
    expect(e).toBeGreaterThan(0)
  })
})
