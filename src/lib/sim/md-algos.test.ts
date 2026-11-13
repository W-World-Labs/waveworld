import { describe, it, expect } from 'vitest'
import {
  MD_ALGO_METHOD_IDS,
  MD_PARENT_METHOD_ID,
  mdChildCount,
  runLjPairSample,
  runMdAlgo,
  runRescaleThermostatSample,
  runVelocityVerletSample,
  type MdAlgoId,
} from './md-algos'
import { childrenOf, methodById, parallelGroup, parallelsOf } from '../../data/methods/methods'

describe('MD 方法族模块化', () => {
  it('父族下 ≥3 个子模块且 id 对齐', () => {
    expect(mdChildCount()).toBeGreaterThanOrEqual(3)
    for (const id of Object.values(MD_ALGO_METHOD_IDS)) {
      const m = methodById(id)
      expect(m, id).toBeDefined()
      expect(m!.parentId).toBe(MD_PARENT_METHOD_ID)
    }
  })

  it('力场并行组：均质 LJ 与 PEDOT 并立', () => {
    const g = parallelGroup('md-forcefield')
    expect(g.length).toBeGreaterThanOrEqual(2)
    expect(g.map((m) => m.id).sort()).toEqual(
      ['method-algo-ff-lj-homog', 'method-algo-ff-pedot'].sort(),
    )
    const peers = parallelsOf('method-algo-ff-lj-homog')
    expect(peers.some((p) => p.id === 'method-algo-ff-pedot')).toBe(true)
  })

  it('lj-pair：势阱底势能接近 −1，截断外为 0', () => {
    const r = runLjPairSample()
    expect(r.uMin).toBeLessThan(-0.5)
    expect(r.uMin).toBeGreaterThan(-1.2)
    expect(r.uBeyond).toBe(0)
    // 势阱底力应接近 0
    expect(Math.abs(r.fAtMin)).toBeLessThan(0.15)
  })

  it('velocity-verlet：短跑后量有限', () => {
    const r = runVelocityVerletSample(80, 0.004)
    expect(Number.isFinite(r.keF)).toBe(true)
    expect(Number.isFinite(r.pe)).toBe(true)
    expect(r.T).toBeGreaterThan(0)
    expect(r.ke0).toBeGreaterThan(0)
  })

  it('rescale-thermostat：缩放后温度靠近目标', () => {
    const r = runRescaleThermostatSample()
    expect(r.Tbefore).toBeGreaterThan(r.target)
    expect(Math.abs(r.Tafter - r.target)).toBeLessThan(0.05)
  })

  it('runMdAlgo 覆盖全部算法键', () => {
    for (const id of Object.keys(MD_ALGO_METHOD_IDS) as MdAlgoId[]) {
      expect(runMdAlgo(id)).toBeTruthy()
    }
    expect(childrenOf(MD_PARENT_METHOD_ID).length).toBeGreaterThanOrEqual(4)
  })
})
