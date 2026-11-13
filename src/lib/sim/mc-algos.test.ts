import { describe, it, expect } from 'vitest'
import {
  ISING_SOLVER_GROUP,
  MC_PARENT,
  compareIsingParallels,
  isingParallelCount,
  mcChildCount,
  runMetropolisSweepSample,
  runOnsagerSample,
  runProposeSample,
} from './mc-algos'
import { methodById, parallelGroup } from '../../data/methods/methods'

describe('Metropolis MC / Ising 模块化', () => {
  it('父族下子模块 ≥4', () => {
    expect(mcChildCount()).toBeGreaterThanOrEqual(4)
    expect(methodById('method-algo-mc-propose-flip')?.parentId).toBe(MC_PARENT)
    expect(methodById('method-algo-mc-metropolis-accept')?.parentId).toBe(MC_PARENT)
  })

  it('ising-solver 并行：MC ‖ Onsager', () => {
    expect(isingParallelCount()).toBe(2)
    expect(parallelGroup(ISING_SOLVER_GROUP).map((m) => m.id).sort()).toEqual(
      ['method-algo-ising-mc-numeric', 'method-algo-onsager-exact'].sort(),
    )
  })

  it('提议 ΔE 合法离散', () => {
    const r = runProposeSample()
    expect(r.legal).toBe(true)
  })

  it('Metropolis 低温冷启动保持高磁化', () => {
    const r = runMetropolisSweepSample(40)
    expect(r.m0).toBeGreaterThan(0.9)
    expect(r.mF).toBeGreaterThan(0.7)
  })

  it('Onsager：T<Tc 时 m>0，T>Tc 时 m=0', () => {
    const lo = runOnsagerSample(1.5)
    const hi = runOnsagerSample(3.0)
    expect(lo.below).toBe(true)
    expect(lo.m).toBeGreaterThan(0.5)
    expect(hi.m).toBe(0)
  })

  it('并行对拍：低温 MC 与 Onsager 同量级', () => {
    const c = compareIsingParallels()
    expect(c.onsager).toBeGreaterThan(0.8)
    expect(c.mc).toBeGreaterThan(0.5)
    expect(Math.abs(c.mc - c.onsager)).toBeLessThan(0.5)
  })
})
