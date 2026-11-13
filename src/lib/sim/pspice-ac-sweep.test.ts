import { describe, expect, it } from 'vitest'
import {
  buildPspiceAcSweepPlan,
  type PspiceAcSweepStudyInput,
} from './pspice-ac-sweep'
import type { PspiceAcCircuit } from './pspice-ac-adapter'

const circuit: PspiceAcCircuit = {
  nodes: 2,
  vSources: [{ a: 1, b: 0, v: 1 }],
  resistors: [{ a: 1, b: 2, r: 1_000 }, { a: 2, b: 0, r: 1_000 }],
  capacitors: [{ a: 2, b: 0, c: 1e-6 }],
  inductors: [{ a: 1, b: 2, l: 1e-3 }],
  iSources: [],
  diodes: [],
}

const study: PspiceAcSweepStudyInput = {
  circuit,
  nodeLabels: ['in', 'out'],
  sweep: { scale: 'linear', startFrequencyHz: 100, stopFrequencyHz: 500, points: 3 },
}

describe('PSpice AC sweep planner', () => {
  it('accepts the two-point and 31-point limits while preserving a valid circuit', () => {
    const twoPoints = buildPspiceAcSweepPlan({
      ...study,
      sweep: { scale: 'linear', startFrequencyHz: 100, stopFrequencyHz: 500, points: 2 },
    })
    const thirtyOnePoints = buildPspiceAcSweepPlan({
      ...study,
      sweep: { scale: 'linear', startFrequencyHz: 100, stopFrequencyHz: 500, points: 31 },
    })

    expect(twoPoints.map(point => point.frequencyHz)).toEqual([100, 500])
    expect(thirtyOnePoints).toHaveLength(31)
    expect(thirtyOnePoints[0].frequencyHz).toBe(100)
    expect(thirtyOnePoints[30].frequencyHz).toBe(500)
    expect(thirtyOnePoints.every(point => point.input.circuit.resistors.length === circuit.resistors.length)).toBe(true)
    expect(twoPoints.every(point => point.input.circuit.capacitors.length === circuit.capacitors.length)).toBe(true)
  })

  it('builds linear and logarithmic plans with exact endpoints and expected interior frequencies', () => {
    const linear = buildPspiceAcSweepPlan({
      ...study,
      sweep: { scale: 'linear', startFrequencyHz: 100, stopFrequencyHz: 500, points: 5 },
    })
    const logarithmic = buildPspiceAcSweepPlan({
      ...study,
      sweep: { scale: 'log', startFrequencyHz: 100, stopFrequencyHz: 10_000, points: 3 },
    })

    expect(linear.map(point => point.frequencyHz)).toEqual([100, 200, 300, 400, 500])
    expect(logarithmic.map(point => point.frequencyHz)).toEqual([100, 1_000, 10_000])
  })

  it('captures independent native jobs with the AC method, omega, backend, and frozen snapshots', () => {
    const plan = buildPspiceAcSweepPlan(study)

    expect(plan.map(point => point.input.omega)).toEqual(plan.map(point => 2 * Math.PI * point.frequencyHz))
    for (const point of plan) {
      expect(point.input).toMatchObject({ module: 'mna', method: 'method-algo-mna-ac', backend: 'host' })
      expect(point.spec.kind).toBe('waveworld-module')
      expect(point.spec.parameters).toMatchObject({ module: 'mna' })
      expect(point.spec.model).toMatchObject({ source: 'inline', inline: point.input })
      expect(point.spec.requirements?.backends).toEqual(['cuda'])
      expect(Object.isFrozen(point)).toBe(true)
      expect(Object.isFrozen(point.input)).toBe(true)
      expect(Object.isFrozen(point.input.circuit)).toBe(true)
      expect(Object.isFrozen(point.spec)).toBe(true)
      expect(Object.isFrozen(point.nodeMap)).toBe(true)
    }
    expect(plan[0].input).not.toBe(plan[1].input)
    expect(plan[0].input.circuit).not.toBe(plan[1].input.circuit)
    expect(plan[0].input.circuit.resistors).not.toBe(plan[1].input.circuit.resistors)
    expect(plan[0].spec).not.toBe(plan[1].spec)
    expect(plan[0].spec.model).not.toBe(plan[1].spec.model)
    expect(plan[0].nodeMap).not.toBe(plan[1].nodeMap)
  })

  it('rejects invalid scale, point counts, endpoints, and nonincreasing frequencies', () => {
    const invalidCases: unknown[] = [
      { ...study, sweep: { ...study.sweep, scale: 'decade' } },
      { ...study, sweep: { ...study.sweep, points: 1 } },
      { ...study, sweep: { ...study.sweep, points: 32 } },
      { ...study, sweep: { ...study.sweep, points: 2.5 } },
      { ...study, sweep: { ...study.sweep, points: Number.NaN } },
      { ...study, sweep: { ...study.sweep, startFrequencyHz: Number.NaN } },
      { ...study, sweep: { ...study.sweep, stopFrequencyHz: Number.POSITIVE_INFINITY } },
      { ...study, sweep: { ...study.sweep, startFrequencyHz: 1e-7 } },
      { ...study, sweep: { ...study.sweep, stopFrequencyHz: 1e13 } },
      { ...study, sweep: { ...study.sweep, startFrequencyHz: 500, stopFrequencyHz: 500 } },
      { ...study, sweep: { ...study.sweep, startFrequencyHz: 600, stopFrequencyHz: 500 } },
    ]

    for (const invalid of invalidCases) {
      expect(() => buildPspiceAcSweepPlan(invalid as PspiceAcSweepStudyInput)).toThrow()
    }
  })

  it('rejects endpoints too close to represent every requested frequency at extreme bounds', () => {
    expect(() => buildPspiceAcSweepPlan({
      ...study,
      sweep: { scale: 'linear', startFrequencyHz: 1e12 - 0.001, stopFrequencyHz: 1e12, points: 31 },
    })).toThrow(/strictly increasing/)
    expect(() => buildPspiceAcSweepPlan({
      ...study,
      sweep: { scale: 'log', startFrequencyHz: 1e12 * (1 - 1e-15), stopFrequencyHz: 1e12, points: 31 },
    })).toThrow(/strictly increasing/)
  })

  it('rejects extra keys and invalid circuit or node labels through the AC job adapter', () => {
    expect(() => buildPspiceAcSweepPlan({ ...study, unexpected: true } as unknown as PspiceAcSweepStudyInput)).toThrow(/unsupported field/)
    expect(() => buildPspiceAcSweepPlan({
      ...study,
      sweep: { ...study.sweep, unexpected: true },
    } as unknown as PspiceAcSweepStudyInput)).toThrow(/unsupported field/)
    expect(() => buildPspiceAcSweepPlan({
      ...study,
      circuit: { ...circuit, resistors: [{ a: 1, b: 3, r: 10 }] },
    })).toThrow()
    expect(() => buildPspiceAcSweepPlan({ ...study, nodeLabels: ['in'] })).toThrow()
    expect(() => buildPspiceAcSweepPlan({ ...study, nodeLabels: ['in', 'in'] })).toThrow()
    expect(() => buildPspiceAcSweepPlan({ ...study, nodeLabels: ['0', 'out'] })).toThrow()
  })
})
