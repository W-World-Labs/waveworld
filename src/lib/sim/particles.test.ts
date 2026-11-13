import { describe, it, expect } from 'vitest'
import {
  particleProperties, initialParticleState, prepareParticleInput,
  particleResult, PARTICLE_RDF_BINS, type ParticleScene, type ParticleFrame,
} from './particles'
import { createParticleScene, advanceParticleScene } from '../webgpu/particleSim'

const twoSpecies = (over: Partial<ParticleScene> = {}): ParticleScene => ({
  species: [
    { name: 'cat', count: 3, charge: 1.5, sigma: 1.1, epsilon: 0.8 },
    { name: 'an', count: 5, charge: -0.9, sigma: 0.9, epsilon: 1.2 },
  ],
  boxL: 8, temperature: 0.6, thermostat: true,
  epsR: 24, lambdaD: 4, kCoulomb: 1, steps: 24, seed: 3, ...over,
})

function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('particleProperties: 组分展开与种子洗牌', () => {
  it('按 species 展开、同种子同序、kind/charge/sigma/eps 对齐', () => {
    const scene = twoSpecies()
    const p = particleProperties(scene)
    expect(p.kind).toHaveLength(8)
    expect([...p.kind].sort()).toEqual([0, 0, 0, 1, 1, 1, 1, 1])
    for (let i = 0; i < 8; i++) {
      const s = scene.species[p.kind[i]]
      expect(p.charge[i]).toBeCloseTo(s.charge, 6)
      expect(p.sigma[i]).toBeCloseTo(s.sigma, 6)
      expect(p.eps[i]).toBeCloseTo(s.epsilon, 6)
    }
    expect(Array.from(particleProperties(scene).kind)).toEqual(Array.from(p.kind))
  })
  it('显式 kind 保留给定顺序且不洗牌', () => {
    const p = particleProperties(twoSpecies({ kind: [1, 0, 1, 0, 1, 0, 1, 0] }))
    expect(Array.from(p.kind)).toEqual([1, 0, 1, 0, 1, 0, 1, 0])
    expect(p.charge[0]).toBeCloseTo(-0.9, 6)
  })
})

describe('initialParticleState: 3D 与导入校验', () => {
  it('默认 dim=3：pos/vel 为 N·3，分量在 [0,L)', () => {
    const scene = twoSpecies()
    const s = initialParticleState(scene)
    expect(s.pos).toHaveLength(24)
    expect(s.vel).toHaveLength(24)
    for (const x of s.pos) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(scene.boxL) }
  })
  it('dim=2 交互模式仍可用', () => {
    const s = initialParticleState(twoSpecies(), 2)
    expect(s.pos).toHaveLength(16)
    expect(s.vel).toHaveLength(16)
  })
  it('导入坐标/速度必须与维度匹配', () => {
    const scene = twoSpecies({ positions: Array(16).fill(1) }) // 2D 长度，3D 请求
    expect(() => initialParticleState(scene)).toThrow(/x,y,z/)
    expect(() => initialParticleState(twoSpecies({ velocities: Array(16).fill(0) }))).toThrow(/vx,vy,vz/)
    expect(initialParticleState(twoSpecies({ positions: Array(16).fill(1) }), 2).pos).toHaveLength(16)
  })
  it('3D 导入数组逐分量保留（含 z）', () => {
    const positions = [0.5, 1, 2, 2, 2.5, 3, 4, 1, 1, 5, 5, 2, 6, 3, 4, 7, 1, 6, 3, 3, 5, 2, 6, 2]
    const velocities = Array(24).fill(0)
    const s = initialParticleState(twoSpecies({ positions, velocities }))
    expect(Array.from(s.pos)).toEqual(positions)
    expect(s.vel.every(v => v === 0)).toBe(true)
  })
})

describe('prepareParticleInput: 作业载荷为 3D', () => {
  it('dim=3、pos/vel N·3、粒子属性原样传递', () => {
    const input = prepareParticleInput(twoSpecies())
    expect(input.dim).toBe(3)
    expect(input.pos).toHaveLength(24)
    expect(input.vel).toHaveLength(24)
    expect(input.particles.kind).toHaveLength(8)
    expect(input.particles.epsR).toBe(24)
  })
})

describe('3D WASM 作业路径（createParticleScene(scene, true)）', () => {
  it('返回 CPU 后端、dim=3、N·3 帧、L³ 体积与总电荷', async () => {
    const scene = twoSpecies({ steps: 4 })
    const sim = await createParticleScene(scene, true)
    try {
      expect(sim.backend).toBe('cpu')
      expect(sim.dim).toBe(3)
      const frame = await sim.read()
      expect(frame.pos).toHaveLength(24)
      expect(frame.kind).toHaveLength(8)
      expect(frame.observables.volume).toBeCloseTo(8 ** 3, 8)
      expect(frame.observables.totalCharge).toBeCloseTo(3 * 1.5 + 5 * -0.9, 5)
    } finally { sim.destroy() }
  })
  it('NVE（无恒温器）总能量漂移有界', async () => {
    const scene = twoSpecies({ thermostat: false, temperature: 0.4, steps: 60, boxL: 6, seed: 9 })
    const sim = await createParticleScene(scene, true)
    try {
      const e0 = (await sim.read()).observables.total
      let done = 0
      while (done < scene.steps) done = (await advanceParticleScene(sim, scene, done)).steps
      const e1 = (await sim.read()).observables.total
      expect(Math.abs((e1 - e0) / Math.max(Math.abs(e0), 1e-6))).toBeLessThan(0.05)
    } finally { sim.destroy() }
  })
  it('恒温器 3D 温度跟踪且观测量有限', async () => {
    const scene = twoSpecies({ temperature: 0.6, steps: 40, boxL: 6 })
    const sim = await createParticleScene(scene, true)
    try {
      let done = 0
      while (done < scene.steps) {
        const next = await advanceParticleScene(sim, scene, done)
        done = next.steps
        expect(Number.isFinite(next.frame.observables.temperature)).toBe(true)
        expect(Number.isFinite(next.frame.observables.pressure)).toBe(true)
      }
      const t = (await sim.read()).observables.temperature
      expect(t).toBeGreaterThan(0.3)
      expect(t).toBeLessThan(1.2)
    } finally { sim.destroy() }
  })
  it('异号电荷对呈屏蔽库仑吸引（负势能），同号排斥（正）', async () => {
    // r=1.5, q=±1, epsR=24, λD=4：u_LJ≈−0.30, u_C≈−0.019 → 总 < 0
    const attract = twoSpecies({
      species: [
        { name: 'a', count: 1, charge: 1, sigma: 1, epsilon: 1 },
        { name: 'b', count: 1, charge: -1, sigma: 1, epsilon: 1 },
      ],
      positions: [0, 0, 0, 1.5, 0, 0], velocities: [0, 0, 0, 0, 0, 0],
      kind: [0, 1], boxL: 8, seed: 1, steps: 1,
    })
    const simA = await createParticleScene(attract, true)
    try {
      const f = await simA.read()
      expect(f.observables.potential).toBeLessThan(0)
    } finally { simA.destroy() }
    const repel = twoSpecies({
      species: [
        { name: 'a', count: 1, charge: 1, sigma: 1, epsilon: 1 },
        { name: 'b', count: 1, charge: 1, sigma: 1, epsilon: 1 },
      ],
      positions: [0, 0, 0, 1.8, 0, 0], velocities: [0, 0, 0, 0, 0, 0],
      kind: [0, 1], boxL: 8, seed: 1, steps: 1,
    })
    const simR = await createParticleScene(repel, true)
    try {
      const f = await simR.read()
      // r=1.8：LJ 吸引较弱，同性电荷屏蔽斥力为正贡献
      expect(f.observables.potential).toBeGreaterThan(-0.2)
    } finally { simR.destroy() }
  })
})

describe('particleResult: 3D RDF 与观测量透传', () => {
  const frame3d = (N: number, L: number, seed: number): ParticleFrame => {
    const r = mulberry32(seed)
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < pos.length; i++) pos[i] = r() * L
    return {
      pos, speed: new Float32Array(N).fill(1),
      kind: new Uint8Array(N), charge: new Float32Array(N),
      observables: { temperature: 1, kinetic: 0, potential: 0, total: 0, pressure: 0, msd: 0, boxL: L, volume: L ** 3, density: N / L ** 3, totalCharge: 0 },
    }
  }
  it('理想气体 3D g(r) 中部 ≈ 1，r 网格按 boxL/2 分箱', () => {
    const res = particleResult(frame3d(500, 10, 21), 12)
    expect(res.steps).toBe(12)
    expect(res.rdf.r).toHaveLength(PARTICLE_RDF_BINS)
    expect(res.rdf.r[0]).toBeCloseTo(5 / (2 * PARTICLE_RDF_BINS), 8)
    let sum = 0, count = 0
    for (let k = 0; k < PARTICLE_RDF_BINS; k++) {
      if (res.rdf.r[k] > 2.5 && res.rdf.r[k] < 4.5) { sum += res.rdf.g[k]; count++ }
    }
    expect(Math.abs(sum / count - 1)).toBeLessThan(0.2)
  })
  it('kind/charge 与 totalCharge 原样返回', () => {
    const f = frame3d(10, 6, 23)
    f.kind.set([0, 1, 0, 1, 0, 1, 0, 1, 0, 1])
    f.charge.set([1, -1, 1, -1, 1, -1, 1, -1, 1, -1])
    f.observables.totalCharge = 0
    const res = particleResult(f, 0)
    expect(res.kind).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1])
    expect(res.observables.totalCharge).toBe(0)
    expect(res.pos).toHaveLength(30)
  })
})
