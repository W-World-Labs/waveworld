import { describe, it, expect } from 'vitest'
import { ljPair } from './md'

const RC = 2.5
const RC2 = RC * RC

describe('ljPair: LJ 平衡点与排斥/吸引', () => {
  it('在 r=2^(1/6)σ 平衡点处 F≈0', () => {
    const rEq2 = Math.pow(2, 1 / 3) // r² at r=2^(1/6)
    const { fOverR } = ljPair(rEq2, RC2)
    expect(Math.abs(fOverR)).toBeLessThan(1e-6)
  })
  it('r<平衡点时排斥 F>0，r>平衡点时吸引 F<0', () => {
    expect(ljPair(1.0, RC2).fOverR).toBeGreaterThan(0)   // r=1<2^(1/6)
    expect(ljPair(2.0, RC2).fOverR).toBeLessThan(0)      // r≈1.41>2^(1/6)
  })
})

describe('ljPair: 截断与能量平移', () => {
  it('r²≥rc² 时 u=0 且 fOverR=0', () => {
    const { u, fOverR } = ljPair(RC2 + 0.5, RC2)
    expect(u).toBe(0)
    expect(fOverR).toBe(0)
  })
  it('r→rc⁻ 时 U 连续趋 0（能量平移）', () => {
    const { u } = ljPair(RC2 - 1e-4, RC2)
    expect(Math.abs(u)).toBeLessThan(1e-3)
  })
})

import { computeForces } from './md'

describe('computeForces: 力反对称 / 动量守恒', () => {
  it('孤立体系每个分量的合力 ≈ 0（牛顿第三定律）', () => {
    const dim = 2, N = 4, L = 10
    const pos = new Float32Array([2, 2, 3, 2.2, 2.5, 3, 4, 4])
    const { force } = computeForces(pos, L, N, dim, 2.5)
    for (let k = 0; k < dim; k++) {
      let s = 0
      for (let i = 0; i < N; i++) s += force[i * dim + k]
      expect(Math.abs(s)).toBeLessThan(1e-4)
    }
  })
})

describe('computeForces: PBC 最小镜像平移不变', () => {
  it('把一个粒子平移整数个 L，受力不变', () => {
    const dim = 2, N = 2, L = 6, rc = 2.5
    const a = new Float32Array([0.5, 1, 1.4, 1]) // 相距 0.9
    const b = new Float32Array([0.5 + L, 1, 1.4, 1]) // 粒子0 平移 +L（跨边界）
    const fa = computeForces(a, L, N, dim, rc).force
    const fb = computeForces(b, L, N, dim, rc).force
    for (let i = 0; i < N * dim; i++) expect(Math.abs(fa[i] - fb[i])).toBeLessThan(1e-4)
  })
})

import { kineticEnergy, temperature, rescaleThermostat } from './md'

describe('动能 / 温度 / 恒温器', () => {
  it('temperature 与 ½Σv² 定义一致（k_B=1）', () => {
    const vel = new Float32Array([1, 0, 0, 2, -1, 1]) // dim=2, N=3
    const dim = 2, N = 3
    const ke = kineticEnergy(vel)
    expect(ke).toBeCloseTo(0.5 * (1 + 0 + 0 + 4 + 1 + 1), 6)
    expect(temperature(vel, N, dim)).toBeCloseTo((2 * ke) / (dim * N), 6)
  })
  it('rescaleThermostat 后温度等于目标值', () => {
    const vel = new Float32Array([1, 0, 0, 2, -1, 1])
    const dim = 2, N = 3
    const Ttarget = 1.5
    rescaleThermostat(vel, Ttarget, temperature(vel, N, dim))
    expect(temperature(vel, N, dim)).toBeCloseTo(Ttarget, 5)
  })
})

import { initLattice } from './md'

describe('initLattice', () => {
  it('粒子数与缓冲长度正确，posUnwrapped 等于初始 pos', () => {
    const st = initLattice(16, 5, 2, 0.6, 1)
    expect(st.N).toBe(16)
    expect(st.pos.length).toBe(32)
    expect(st.vel.length).toBe(32)
    expect(Array.from(st.posUnwrapped)).toEqual(Array.from(st.pos))
  })
  it('初速度零总动量（每分量动量 ≈ 0）', () => {
    const st = initLattice(25, 6, 2, 1.0, 7)
    for (let k = 0; k < st.dim; k++) {
      let p = 0
      for (let i = 0; i < st.N; i++) p += st.vel[i * st.dim + k]
      expect(Math.abs(p)).toBeLessThan(1e-4)
    }
  })
  it('同种子可复现', () => {
    const a = initLattice(16, 5, 2, 0.6, 42)
    const b = initLattice(16, 5, 2, 0.6, 42)
    expect(Array.from(a.vel)).toEqual(Array.from(b.vel))
  })
})

import { velocityVerlet } from './md'

describe('velocityVerlet: NVE 守恒', () => {
  it('关恒温器跑 100 步，总能相对漂移 < 2%', () => {
    const st = initLattice(16, 4.5, 2, 0.5, 3)
    const dt = 0.004
    const e0 = kineticEnergy(st.vel) + st.potential
    for (let s = 0; s < 100; s++) velocityVerlet(st, dt)
    const e1 = kineticEnergy(st.vel) + st.potential
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(0.02)
  })
  it('多步后总动量守恒（每分量 ≈ 0）', () => {
    const st = initLattice(16, 4.5, 2, 0.5, 3)
    for (let s = 0; s < 50; s++) velocityVerlet(st, 0.004)
    for (let k = 0; k < st.dim; k++) {
      let p = 0
      for (let i = 0; i < st.N; i++) p += st.vel[i * st.dim + k]
      expect(Math.abs(p)).toBeLessThan(1e-3)
    }
  })
})

import { pressure } from './md'

describe('pressure: 维里压强理想气体极限', () => {
  it('极稀疏 + 高温（几乎无相互作用），P·V ≈ N·T', () => {
    const dim = 2, N = 8, L = 50, rc = 2.5
    // 粒子分散在大盒子里，两两间距 ≫ rc → virial ≈ 0
    const pos = new Float32Array([
      2, 2, 14, 4, 26, 6, 38, 8, 6, 30, 18, 32, 30, 34, 42, 40,
    ])
    const { virial } = computeForces(pos, L, N, dim, rc)
    const T = 3.0
    const V = L * L
    const P = pressure(N, L, dim, T, virial)
    expect(P * V).toBeCloseTo(N * T, 3) // virial≈0 → 理想气体
  })
})

import { msd } from './md'

describe('msd: 弹道段 ∝ t²', () => {
  it('自由匀速粒子 MSD(2t)/MSD(t) = 4', () => {
    const dim = 2, N = 2
    const pos0 = new Float32Array([0, 0, 5, 5])
    const v = new Float32Array([1, 0.5, -0.5, 2]) // 各粒子速度
    const t1 = 1, t2 = 2
    const at = (t: number) => {
      const p = new Float32Array(N * dim)
      for (let i = 0; i < N * dim; i++) p[i] = pos0[i] + v[i] * t
      return msd(pos0, p, N)
    }
    expect(at(t2) / at(t1)).toBeCloseTo(4, 5)
  })
  it('零位移时 MSD=0', () => {
    const pos0 = new Float32Array([1, 2, 3, 4])
    expect(msd(pos0, pos0.slice(), 2)).toBe(0)
  })
})

// ===== 3D 作业路径（createMdScene(scene, true) → WASM CPU，dim=3） =====
import { initialParticles, mdBoxLength, mdMaxSteps, prepareMdInput, mdResult, MD_DENSITY, type MdHistory, type MdScene } from './md'
import { createMdScene, advanceMdScene } from '../webgpu/mdSim'

/** Deterministic [0,1) stream for synthetic 3D frames. */
function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mdScene = (over: Partial<MdScene> = {}): MdScene => ({
  N: 216, temperature: 0.7, thermostat: false, barostat: false,
  targetP: 1, tauP: 1, steps: 200, seed: 5, ...over,
})

describe('3D 场景准备与盒长', () => {
  it('prepareMdInput 输出 dim=3、pos/vel 为 N·3、盒长为 3D 密度', () => {
    const scene = mdScene({ N: 64 })
    const input = prepareMdInput(scene)
    expect(input.dim).toBe(3)
    expect(input.pos).toHaveLength(192)
    expect(input.vel).toHaveLength(192)
    expect(input.boxL).toBeCloseTo(Math.cbrt(64 / MD_DENSITY), 12)
    expect(prepareMdInput(scene).pos).toEqual(input.pos) // 种子确定
  })
  it('mdBoxLength(N) 为立方盒、数密度 ρ*=0.4、且 L/2 > rc', () => {
    for (const N of [64, 256, 1024, 2048]) {
      const L = mdBoxLength(N)
      expect(N / L ** 3).toBeCloseTo(MD_DENSITY, 10)
      expect(L / 2).toBeGreaterThan(RC)
    }
  })
  it('mdMaxSteps 随 O(N·neighbors) 邻表成本线性收缩', () => {
    expect(mdMaxSteps(2048)).toBe(64) // 与旧 O(N²) 预算在最大场景一致
    expect(mdMaxSteps(1024)).toBe(128)
    expect(mdMaxSteps(64)).toBe(2000)
  })
  it('initialParticles(dim=3) 生成立方晶格 + 零动量 Maxwell 速度', () => {
    const { pos, vel } = initialParticles(64, mdBoxLength(64), 3, 0.6, 9)
    expect(pos).toHaveLength(192)
    expect(vel).toHaveLength(192)
    for (let k = 0; k < 3; k++) {
      let p = 0
      for (let i = 0; i < 64; i++) p += vel[i * 3 + k]
      expect(Math.abs(p)).toBeLessThan(1e-4)
    }
    for (const x of pos) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(mdBoxLength(64)) }
  })
})

describe('3D WASM 作业路径（createMdScene(scene, true)）', () => {
  it('返回 CPU 后端、dim=3、N·3 帧与 L³ 体积', async () => {
    const sim = await createMdScene(mdScene({ N: 64, steps: 8 }), true)
    try {
      expect(sim.backend).toBe('cpu')
      expect(sim.dim).toBe(3)
      const frame = await sim.read()
      expect(frame.pos).toHaveLength(192)
      expect(frame.speed).toHaveLength(64)
      expect(frame.observables.boxL).toBeCloseTo(mdBoxLength(64), 10)
      expect(frame.observables.volume).toBeCloseTo(frame.observables.boxL ** 3, 8)
      expect(frame.observables.density).toBeCloseTo(MD_DENSITY, 8)
    } finally { sim.destroy() }
  })
  it('NVE：200 步总能量相对漂移 < 2%', async () => {
    const scene = mdScene({ N: 216, steps: 200 }) // thermostat: false → NVE
    const sim = await createMdScene(scene, true)
    try {
      const e0 = (await sim.read()).observables.total
      const history: MdHistory = []
      let done = 0
      while (done < scene.steps) {
        const next = await advanceMdScene(sim, scene, done, history)
        done = next.steps
      }
      const e1 = (await sim.read()).observables.total
      expect(Math.abs((e1 - e0) / e0)).toBeLessThan(0.02)
    } finally { sim.destroy() }
  })
  it('恒温器把 3D 温度维持在目标附近', async () => {
    const scene = mdScene({ N: 125, temperature: 0.8, thermostat: true, steps: 80, seed: 7 })
    const sim = await createMdScene(scene, true)
    try {
      const history: MdHistory = []
      let done = 0
      while (done < scene.steps) {
        const next = await advanceMdScene(sim, scene, done, history)
        done = next.steps
        expect(Number.isFinite(next.frame.observables.temperature)).toBe(true)
      }
      const t = (await sim.read()).observables.temperature
      expect(t).toBeGreaterThan(0.4)
      expect(t).toBeLessThan(1.4)
    } finally { sim.destroy() }
  })
})

describe('3D 结果分析（mdResult → md_rdf/md_diffusion dim=3）', () => {
  const uniformFrame = (N: number, L: number, seed: number) => {
    const r = mulberry32(seed)
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < pos.length; i++) pos[i] = r() * L
    return {
      pos, speed: new Float32Array(N).fill(1),
      observables: { temperature: 1, kinetic: 0, potential: 0, total: 0, pressure: 0, msd: 0, boxL: L, volume: L ** 3, density: N / L ** 3 },
    }
  }
  it('理想气体 3D g(r) ≈ 1（中部壳层）', () => {
    const res = mdResult(uniformFrame(600, 12, 11), 0, [], false)
    expect(res.rdf.r).toHaveLength(60)
    expect(res.rdf.r[0]).toBeCloseTo(6 / 120, 8) // dr = rmax/bins = 6/60, r[0] = dr/2
    let sum = 0, count = 0
    for (let k = 0; k < 60; k++) {
      if (res.rdf.r[k] > 2.5 && res.rdf.r[k] < 5.5) { sum += res.rdf.g[k]; count++ }
    }
    expect(Math.abs(sum / count - 1)).toBeLessThan(0.15)
  })
  it('3D Einstein 扩散：D = slope/6', () => {
    const frame = uniformFrame(64, 8, 13)
    const history: MdHistory = []
    for (let s = 0; s <= 10; s++) history.push({ step: s, time: s, msd: 0.3 * s }) // slope 0.3 → D = 0.05
    const res = mdResult(frame, 10, history, false)
    expect(res.diffusion).not.toBeNull()
    expect(res.diffusion!.D).toBeCloseTo(0.05, 6)
    expect(res.diffusion!.r2).toBeCloseTo(1, 6)
  })
  it('barostat 下不报告扩散（诚实逻辑保留）', () => {
    const history: MdHistory = [{ step: 0, time: 0, msd: 0 }, { step: 1, time: 1, msd: 1 }, { step: 2, time: 2, msd: 2 }, { step: 3, time: 3, msd: 3 }]
    const res = mdResult(uniformFrame(64, 8, 17), 3, history, true)
    expect(res.diffusion).toBeNull()
  })
})
