import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { createPspiceAcJob, readPspiceAcResult, type PspiceAcStudyInput } from './pspice-ac-adapter'

const study: PspiceAcStudyInput = {
  frequencyHz: 1_000,
  nodeLabels: ['in', 'out'],
  circuit: {
    nodes: 2,
    vSources: [{ a: 1, b: 0, v: 1 }],
    resistors: [{ a: 1, b: 2, r: 1_000 }, { a: 2, b: 0, r: 1_000 }],
    capacitors: [{ a: 2, b: 0, c: 1e-6 }],
    inductors: [{ a: 1, b: 2, l: 1e-3 }],
    iSources: [],
    diodes: [],
  },
}

const acResult = (overrides: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    module: 'mna',
    backend: { id: 'host-f64-mna' },
    result: {
      methodId: 'method-algo-mna-ac',
      familyId: 'method-mna',
      converged: true,
      iterations: 1,
      residualNorm: 0,
      omega: 2 * Math.PI * study.frequencyHz,
      nodeMagnitudes: [1, Math.sqrt(0.3125)],
      nodePhases: [0, Math.atan2(-0.25, 0.5)],
      nodePhasesDeg: [0, Math.atan2(-0.25, 0.5) * 180 / Math.PI],
      ...overrides,
    },
  },
  ...envelope,
})

describe('PSpice AC adapter', () => {
  it('builds a direct host MNA AC job and converts Hz to angular frequency', () => {
    const { input, spec, nodeMap } = createPspiceAcJob(study)

    expect(input).toMatchObject({
      module: 'mna',
      method: 'method-algo-mna-ac',
      backend: 'host',
      omega: 2 * Math.PI * study.frequencyHz,
      circuit: study.circuit,
    })
    expect(spec.kind).toBe('waveworld-module')
    expect(spec.parameters).toMatchObject({ module: 'mna' })
    expect(spec.model).toMatchObject({ source: 'inline', inline: input })
    expect(spec.requirements?.backends).toEqual(['cuda'])
    expect(nodeMap).toEqual({ '0': 0, in: 1, out: 2 })
  })

  it('rejects invalid bounds, extra input keys, malformed node labels, and unsupported diodes', () => {
    expect(() => createPspiceAcJob({ ...study, frequencyHz: 0 })).toThrow()
    expect(() => createPspiceAcJob({ ...study, frequencyHz: 1e-7 })).toThrow()
    expect(() => createPspiceAcJob({ ...study, frequencyHz: 1e13 })).toThrow()
    expect(() => createPspiceAcJob({ ...study, circuit: { ...study.circuit, nodes: 65 } })).toThrow()
    expect(() => createPspiceAcJob({ ...study, frequencyHz: Number.POSITIVE_INFINITY })).toThrow()
    expect(() => createPspiceAcJob({ ...study, unexpected: true } as unknown as PspiceAcStudyInput)).toThrow()
    expect(() => createPspiceAcJob({ ...study, nodeLabels: ['in'] })).toThrow()
    expect(() => createPspiceAcJob({ ...study, nodeLabels: ['in', 'in'] })).toThrow()
    expect(() => createPspiceAcJob({ ...study, nodeLabels: ['0', 'out'] })).toThrow()
    expect(() => createPspiceAcJob({ ...study, circuit: { ...study.circuit, diodes: [{ a: 1, b: 0 }] } } as unknown as PspiceAcStudyInput)).toThrow(/diodes/)
    expect(() => createPspiceAcJob({ ...study, circuit: { ...study.circuit, resistors: [{ a: 1, b: 3, r: 10 }] } })).toThrow()
    expect(() => createPspiceAcJob({ ...study, circuit: { ...study.circuit, resistors: [{ a: 1, b: 2, r: 0 }] } })).toThrow()
    expect(() => createPspiceAcJob({ ...study, circuit: { ...study.circuit, resistors: [{ a: 1, b: 2, r: 10, ignored: true }] } } as unknown as PspiceAcStudyInput)).toThrow(/unsupported field/)
  })

  it('restores node labels from native magnitude and phase arrays', () => {
    const { input, nodeMap } = createPspiceAcJob(study)
    const result = readPspiceAcResult(acResult() as unknown as JobResultV1, input, nodeMap)

    expect(result).toMatchObject({
      omega: 2 * Math.PI * study.frequencyHz,
      methodId: 'method-algo-mna-ac',
      familyId: 'method-mna',
      backend: { id: 'host-f64-mna' },
      nodePhasors: {
        '0': { magnitude: 0, phaseRad: 0, phaseDeg: 0 },
        in: { magnitude: 1, phaseRad: 0, phaseDeg: 0 },
        out: {
          magnitude: Math.sqrt(0.3125),
          phaseRad: Math.atan2(-0.25, 0.5),
          phaseDeg: Math.atan2(-0.25, 0.5) * 180 / Math.PI,
        },
      },
    })
    expect(result.frequencyHz).toBeCloseTo(study.frequencyHz, 12)
  })

  it('rejects wrong module, method, backend, vector dimensions, nonfinite values, and missing provenance', () => {
    const { input, nodeMap } = createPspiceAcJob(study)
    const valid = acResult()
    const moduleResult = valid.moduleResult as { module: string; backend: { id: string }; result: Record<string, unknown> }

    expect(() => readPspiceAcResult({ ...valid, moduleResult: { ...moduleResult, module: 'other' } } as unknown as JobResultV1, input, nodeMap)).toThrow()
    expect(() => readPspiceAcResult(acResult({ methodId: 'method-algo-mna-dc' }) as unknown as JobResultV1, input, nodeMap)).toThrow(/method/)
    expect(() => readPspiceAcResult({ ...valid, moduleResult: { ...moduleResult, backend: { id: 'cuda' } } } as unknown as JobResultV1, input, nodeMap)).toThrow(/backend/)
    expect(() => readPspiceAcResult(acResult({ nodeMagnitudes: [1] }) as unknown as JobResultV1, input, nodeMap)).toThrow(/dimension/)
    expect(() => readPspiceAcResult(acResult({ nodeMagnitudes: [1, Number.NaN] }) as unknown as JobResultV1, input, nodeMap)).toThrow(/finite/)
    expect(() => readPspiceAcResult(acResult({ familyId: undefined }) as unknown as JobResultV1, input, nodeMap)).toThrow(/provenance|family/)
    expect(() => readPspiceAcResult(acResult({ omega: 1 }) as unknown as JobResultV1, input, nodeMap)).toThrow(/omega|frequency|provenance/)
    expect(() => readPspiceAcResult(acResult() as unknown as JobResultV1, { ...input, omega: 1 } as typeof input, nodeMap)).toThrow(/omega|frequency/)
    expect(() => readPspiceAcResult(acResult() as unknown as JobResultV1, input, { '0': 0, in: 1, out: 3 })).toThrow(/node index/)
  })
})
