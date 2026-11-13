import { describe, it, expect } from 'vitest'
import { Fluid, project, advect, maxDivergence, IX, createFluidScene, stepFluidScene, fluidResult, createConvectionScene, stepConvectionScene, convectionResult, CONVECTION_N } from './fluid'

describe('Stable Fluids — Navier-Stokes 核心', () => {
  const N = 32

  it('压力投影真正收敛：网格散度降到容差量级', () => {
    const vx = new Float32Array(N * N), vy = new Float32Array(N * N)
    // 含低频与一定高频的散度场：收敛投影应把实测散度压到残差量级
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      vx[IX(i, j, N)] = Math.sin((Math.PI * i) / N) + 0.1 * Math.sin((3 * Math.PI * j) / N)
      vy[IX(i, j, N)] = Math.sin((Math.PI * j) / N) - 0.1 * Math.cos((2 * Math.PI * i) / N)
    }
    const before = maxDivergence(vx, vy, N, 1)
    const p = new Float32Array(N * N), div = new Float32Array(N * N)
    project(vx, vy, p, div, 400, N)
    const after = maxDivergence(vx, vy, N, 1)
    expect(before).toBeGreaterThan(0.01)
    expect(after).toBeLessThan(1e-3) // 实测散度达到收敛容差（~n·残差）
    expect(after).toBeLessThan(before * 0.05)
  })

  it('零速度场下平流是恒等（染料不动）', () => {
    const vx = new Float32Array(N * N), vy = new Float32Array(N * N)
    const d0 = new Float32Array(N * N)
    for (let i = 0; i < d0.length; i++) d0[i] = Math.random()
    const d = new Float32Array(N * N)
    advect(0, d, d0, vx, vy, 0.1, N)
    for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++)
      expect(d[IX(i, j, N)]).toBeCloseTo(d0[IX(i, j, N)], 5)
  })

  it('数值稳定：注入染料/速度后多步不发散且保持不可压', () => {
    const f = new Fluid(N, { dt: 0.05, iter: 24 })
    f.addDensity(N / 2, N / 2, 100)
    f.addVelocity(N / 2, N / 2, 0.5, 0.3)
    for (let s = 0; s < 60; s++) f.step()
    let max = 0, finite = true
    for (let i = 0; i < f.dens.length; i++) {
      if (!Number.isFinite(f.dens[i]) || !Number.isFinite(f.vx[i]) || !Number.isFinite(f.vy[i])) finite = false
      max = Math.max(max, f.dens[i])
    }
    expect(finite).toBe(true)
    expect(max).toBeLessThan(1000)
    expect(max).toBeGreaterThan(0)
    const stats = f.read()
    expect(stats.gridDivergence).toBeLessThan(1e-3) // 每步后散度保持在收敛量级
    expect(stats.maxSpeed).toBeLessThan(8)
    expect(stats.projectionSweeps).toBeLessThan(4096) // 残差驱动收敛，未触顶
  })

  it('染料随速度场平移（质心沿 +x 移动）', () => {
    const f = new Fluid(N, { dt: 0.05, iter: 24 })
    for (let j = N / 2 - 2; j <= N / 2 + 2; j++) for (let i = 6; i <= 10; i++) f.addDensity(i, j, 50)
    const cx = () => {
      let m = 0, mx = 0
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const d = f.dens[IX(i, j, N)]; m += d; mx += d * i
      }
      return m > 1e-6 ? mx / m : NaN
    }
    const x0 = cx()
    for (let s = 0; s < 12; s++) { for (let i = 0; i < f.vx.length; i++) f.vx[i] = 0.5; f.step() }
    expect(cx()).toBeGreaterThan(x0 + 1)
  })

  it('浮力：高温区产生向上(−y)体积力', () => {
    const f = new Fluid(N, { thermal: true, buoyancy: 5, ambient: 0, dt: 0.1 })
    for (let j = N / 2 - 1; j <= N / 2 + 1; j++) for (let i = N / 2 - 1; i <= N / 2 + 1; i++) f.addTemp(i, j, 10)
    f.applyBuoyancy()
    expect(f.vy[IX(N / 2, N / 2, N)]).toBeLessThan(0)
  })

  it('障碍掩膜：固体内速度清零', () => {
    const f = new Fluid(N, {})
    const mask = new Uint8Array(N * N)
    const solid = IX(N / 2, N / 2, N); mask[solid] = 1
    f.setObstacle(mask)
    f.vx[solid] = 3; f.vy[solid] = -2; f.dens[solid] = 9
    f.applyObstacle()
    expect(f.vx[solid]).toBe(0); expect(f.vy[solid]).toBe(0); expect(f.dens[solid]).toBe(0)
  })

  it('热羽流上升：热团温度质心随时间上移(−y)', () => {
    const f = new Fluid(N, { thermal: true, buoyancy: 8, ambient: 0, dt: 0.1, iter: 24 })
    for (let j = N - 10; j < N - 6; j++) for (let i = N / 2 - 2; i <= N / 2 + 2; i++) f.addTemp(i, j, 30)
    const cy = () => {
      let m = 0, my = 0
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const t = f.temp[IX(i, j, N)]; m += t; my += t * j
      }
      return m > 1e-6 ? my / m : NaN
    }
    const y0 = cy()
    for (let s = 0; s < 25; s++) f.step()
    expect(cy()).toBeLessThan(y0 - 0.5)
    expect(Number.isFinite(f.vx[IX(N / 2, N / 2, N)])).toBe(true)
  })
})

describe('fluid / convection 场景不变量', () => {
  it('fluid 场景：投影收敛、散度达容差、速度有界', () => {
    const scene = { viscosity: 0.00005, diffusion: 0.00001, rotation: 0.02, decay: 0.995, steps: 12,
      seeds: [{ x: 30, y: 50, radius: 4, density: 60, vx: 0.4, vy: 0 }] }
    const fluid = createFluidScene(scene)
    for (let s = 0; s < scene.steps; s++) stepFluidScene(fluid, scene)
    const result = fluidResult(fluid, scene.steps)
    expect(result.density.every(Number.isFinite)).toBe(true)
    expect(result.vx.every(Number.isFinite)).toBe(true)
    expect(result.vy.every(Number.isFinite)).toBe(true)
    expect(result.gridDivergence).toBeLessThan(1e-4)
    expect(result.maxSpeed).toBeGreaterThan(0)
    expect(result.maxSpeed).toBeLessThan(8)
    // 求解器记账：实际扫掠数与达到的残差
    expect(result.projectionSweeps).toBeGreaterThan(0)
    expect(result.projectionSweeps).toBeLessThan(4096)
    expect(result.projectionResidual).toBeGreaterThan(0)
  })

  it('convection 场景：热 seed 上浮、温度有界、散度收敛', () => {
    const scene = { buoyancy: 0.07, steps: 30, initialDrop: false,
      seeds: [{ x: 55, y: 80, hot: true }] }
    const fluid = createConvectionScene(scene)
    const cy = () => {
      let m = 0, my = 0
      for (let j = 1; j < CONVECTION_N - 1; j++) for (let i = 1; i < CONVECTION_N - 1; i++) {
        const t = Math.max(0, fluid.temp[IX(i, j, CONVECTION_N)]); m += t; my += t * j
      }
      return m > 1e-6 ? my / m : NaN
    }
    const y0 = cy()
    for (let s = 0; s < scene.steps; s++) stepConvectionScene(fluid)
    const result = convectionResult(fluid, scene.steps)
    expect(Number.isFinite(result.maxSpeed)).toBe(true)
    expect(result.maxTemperature).toBeGreaterThan(0)
    expect(result.maxTemperature).toBeLessThanOrEqual(90)
    expect(cy()).toBeLessThan(y0 - 0.5) // 热物质上移
    expect(result.gridDivergence).toBeLessThan(1e-3)
    expect(result.projectionSweeps).toBeLessThan(4096)
  })
})
