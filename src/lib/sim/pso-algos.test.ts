import { describe, it, expect } from 'vitest'
import {
  METHOD_PSO,
  METHOD_ALGO_PSO_STEP,
  PSO_PARENT,
  PSO_METHOD_IDS,
  DEFAULT_PSO_PARAMS,
  mulberry32,
  sphere,
  makeSphereObjective,
  rosenbrockLite,
  makeRosenbrockLite,
  norm2,
  randomVector,
  initSwarm,
  psoUpdateParticle,
  psoStep,
  runPsoTrajectory,
  runPsoStepSample,
  type Particle,
} from './pso-algos'

describe('PSO · particle swarm 2D sphere + Rosenbrock-lite', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_PSO).toBe('method-pso')
    expect(METHOD_ALGO_PSO_STEP).toBe('method-algo-pso-step')
    expect(PSO_PARENT).toBe(METHOD_PSO)
    expect(PSO_METHOD_IDS).toContain(METHOD_ALGO_PSO_STEP)
  })

  it('mulberry32 reproducible and in [0,1)', () => {
    const a = mulberry32(77)
    const b = mulberry32(77)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
    for (const u of seqA) {
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('sphere: f(0)=0, f([3,4])=25', () => {
    expect(sphere([0, 0])).toBeCloseTo(0, 12)
    expect(sphere([3, 4])).toBeCloseTo(25, 12)
    expect(makeSphereObjective(2).f(new Float64Array([1, 0]))).toBeCloseTo(1, 12)
  })

  it('rosenbrockLite: min at (1,1) f=0; positive elsewhere', () => {
    expect(rosenbrockLite([1, 1])).toBeCloseTo(0, 12)
    expect(makeRosenbrockLite(10).f(new Float64Array([1, 1]))).toBeCloseTo(0, 12)
    expect(rosenbrockLite([0, 0])).toBeGreaterThan(0)
    expect(rosenbrockLite([-1, 1], 10)).toBeGreaterThan(1)
  })

  it('norm2 and randomVector bounds', () => {
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    const rand = mulberry32(3)
    const v = randomVector(2, -1, 1, rand)
    expect(v.length).toBe(2)
    expect(v[0]!).toBeGreaterThanOrEqual(-1)
    expect(v[0]!).toBeLessThanOrEqual(1)
    expect(v[1]!).toBeGreaterThanOrEqual(-1)
    expect(v[1]!).toBeLessThanOrEqual(1)
  })

  it('initSwarm: gbest is best pbest among particles', () => {
    const obj = makeSphereObjective(2)
    const rand = mulberry32(11)
    const swarm = initSwarm(12, obj, { lo: -2, hi: 2, vSpan: 0.5, rand })
    expect(swarm.particles.length).toBe(12)
    expect(swarm.dim).toBe(2)
    let minF = Infinity
    for (const p of swarm.particles) {
      expect(p.x.length).toBe(2)
      expect(p.v.length).toBe(2)
      expect(p.pbestF).toBeCloseTo(p.f, 12)
      minF = Math.min(minF, p.pbestF)
    }
    expect(swarm.gbestF).toBeCloseTo(minF, 12)
    expect(swarm.gbestF).toBeCloseTo(sphere(swarm.gbest), 10)
  })

  it('psoUpdateParticle: velocity formula structure; pbest updates on improve', () => {
    // Fixed r1=r2=0.5 via custom rand sequence
    let i = 0
    const rs = [0.5, 0.5, 0.5, 0.5]
    const rand = () => rs[i++] ?? 0.5

    const p: Particle = {
      x: new Float64Array([2, 0]),
      v: new Float64Array([1, 0]),
      pbest: new Float64Array([1, 0]),
      pbestF: 1,
      f: 4,
    }
    const gbest = new Float64Array([0, 0])
    // v = 0.5*1 + 1.0*0.5*(1-2) + 1.0*0.5*(0-2) = 0.5 - 0.5 - 1.0 = -1
    // x = 2 + (-1) = 1
    const params = { w: 0.5, c1: 1.0, c2: 1.0 }
    const obj = makeSphereObjective(2)
    psoUpdateParticle(p, gbest, params, rand, obj)
    expect(p.v[0]).toBeCloseTo(-1, 10)
    expect(p.x[0]).toBeCloseTo(1, 10)
    // dim1: v=0.5*0 + 0.5*(0-0) + 0.5*(0-0)=0
    expect(p.v[1]).toBeCloseTo(0, 10)
    expect(p.f).toBeCloseTo(sphere(p.x), 12)
    // improved toward origin vs pbestF=1? f(1,0)=1 → not strictly better
    expect(p.pbestF).toBeLessThanOrEqual(1 + 1e-12)
  })

  it('psoUpdateParticle: vMax clamps velocity', () => {
    const rand = () => 1 // max cognitive/social pull
    const p: Particle = {
      x: new Float64Array([0, 0]),
      v: new Float64Array([10, 10]),
      pbest: new Float64Array([100, 100]),
      pbestF: 2e4,
      f: 0,
    }
    const gbest = new Float64Array([100, 100])
    psoUpdateParticle(
      p,
      gbest,
      { w: 1, c1: 2, c2: 2, vMax: 0.5 },
      rand,
      makeSphereObjective(2),
    )
    expect(Math.abs(p.v[0]!)).toBeLessThanOrEqual(0.5 + 1e-12)
    expect(Math.abs(p.v[1]!)).toBeLessThanOrEqual(0.5 + 1e-12)
  })

  it('psoStep: gbest f nonincreasing after step', () => {
    const obj = makeSphereObjective(2)
    const rand = mulberry32(5)
    const swarm = initSwarm(16, obj, { lo: 1, hi: 4, vSpan: 0.5, rand })
    const f0 = swarm.gbestF
    psoStep(swarm, obj, DEFAULT_PSO_PARAMS, rand)
    expect(swarm.gbestF).toBeLessThanOrEqual(f0 + 1e-15)
    expect(Number.isFinite(swarm.gbestF)).toBe(true)
  })

  it('runPsoTrajectory sphere: gbest f decreases from far start', () => {
    const tr = runPsoTrajectory(60, {
      nParticles: 20,
      dim: 2,
      lo: 2,
      hi: 5,
      seed: 3,
      objective: 'sphere',
    })
    expect(tr.gbestF).toBeLessThan(tr.gbestF0)
    expect(tr.gbestF0 - tr.gbestF).toBeGreaterThan(5)
    expect(tr.gbestF).toBeLessThan(2)
    // history nonincreasing
    for (let i = 1; i < tr.gbestHistory.length; i++) {
      expect(tr.gbestHistory[i]!).toBeLessThanOrEqual(
        tr.gbestHistory[i - 1]! + 1e-15,
      )
    }
    expect(norm2(tr.gbest)).toBeLessThan(2)
  })

  it('runPsoTrajectory rosenbrock-lite: gbest f decreases', () => {
    const tr = runPsoTrajectory(120, {
      nParticles: 28,
      lo: -1,
      hi: 2,
      seed: 9,
      objective: 'rosenbrock',
      beta: 10,
    })
    expect(tr.gbestF).toBeLessThan(tr.gbestF0)
    expect(tr.gbestF0 - tr.gbestF).toBeGreaterThan(0.01)
    expect(Number.isFinite(tr.gbest[0]!)).toBe(true)
  })

  it('runPsoStepSample: ok, gbest drop, methodId/familyId', () => {
    const r = runPsoStepSample()
    expect(r.methodId).toBe(METHOD_ALGO_PSO_STEP)
    expect(r.familyId).toBe(METHOD_PSO)
    expect(r.familyId).toBe('method-pso')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.bestDropped).toBe(true)
    expect(r.energyDrop).toBeGreaterThan(5)
    expect(r.gbestF).toBeLessThan(r.gbestF0)
    expect(r.gbestF).toBeLessThan(1.0)
    expect(r.gbestNorm).toBeLessThan(1.5)
    expect(r.rosenImproved).toBe(true)
    expect(r.rosenGbestF).toBeLessThan(r.rosenGbestF0)
    expect(r.dim).toBe(2)
  })
})
