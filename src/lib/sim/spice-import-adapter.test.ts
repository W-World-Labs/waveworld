import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import {
  createSpiceImportJob,
  createSpiceDcJob,
  readSpiceImportResult,
  readSpiceDcResult,
  type MnaImport,
} from './spice-import-adapter'

const netlist = '.title divider\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 3k\n.end'
const mnaInput = {
  module: 'mna',
  method: 'method-algo-mna-dc',
  circuit: {
    nodes: 2,
    vSources: [{ a: 1, b: 0, v: 10 }],
    resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
    capacitors: [],
    inductors: [],
    iSources: [],
    diodes: [],
  },
} as const
const mnaJobSpec = {
  schemaVersion: 1,
  kind: 'waveworld-module',
  parameters: { module: 'mna' },
  model: { source: 'inline', inline: mnaInput },
  run: { maxSteps: 1 },
  outputs: {},
} as const

const imported = (): MnaImport => ({
  mnaInput,
  mnaJobSpec: mnaJobSpec as unknown as MnaImport['mnaJobSpec'],
  nodeMap: { '0': 0, in: 1, out: 2 },
  diagnostics: [],
})

const dcResult = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    module: 'mna',
    backend: { id: 'host-f64-mna' },
    result: {
      methodId: 'method-algo-mna-dc',
      familyId: 'method-mna',
      converged: true,
      iterations: 1,
      residualNorm: 0,
      nodeVoltages: [10, 7.5],
      branchCurrents: [0.0025],
      ...overrides,
    },
  },
})

describe('SPICE import adapter', () => {
  it('creates a native parse-only job while preserving the netlist and include files', () => {
    const includes = { 'parts.lib': '.model DFAST D(Is=1e-14)' }
    const { input, spec } = createSpiceImportJob({ netlist, includes })

    expect(input).toMatchObject({
      module: 'sw-ngspice-netlist',
      backend: 'host',
      method: 'method-ngspice-netlist-to-mna',
      netlist,
      includes,
    })
    expect(spec.kind).toBe('waveworld-module')
    expect(spec.parameters).toMatchObject({ module: 'sw-ngspice-netlist' })
    expect(spec.model).toMatchObject({ source: 'inline', inline: input })
  })

  it('accepts only a returned MNA input and matching MNA JobSpec', () => {
    const { input } = createSpiceImportJob({ netlist })
    const result = {
      schemaVersion: 1,
      status: 'succeeded',
      summary: { steps: 1 },
      moduleResult: {
        module: input.module,
        backend: { id: 'host-f64' },
        result: {
          ok: true,
          methodId: input.method,
          import: {
            mnaInput,
            mnaJobSpec,
            nodeMap: { '0': 0, in: 1, out: 2 },
            diagnostics: [{ severity: 'warning', message: 'Deck ended without .end' }],
          },
        },
      },
    } as unknown as JobResultV1

    expect(readSpiceImportResult(result, input)).toMatchObject({ mnaInput, mnaJobSpec, nodeMap: { in: 1, out: 2 } })
  })

  it('rejects parser results that omit the MNA job or report invalid node indices', () => {
    const { input } = createSpiceImportJob({ netlist })
    const base = {
      schemaVersion: 1,
      status: 'succeeded',
      summary: { steps: 1 },
      moduleResult: {
        module: input.module,
        backend: { id: 'host-f64' },
        result: { ok: true, methodId: input.method, import: { mnaInput, mnaJobSpec, nodeMap: { in: 1 }, diagnostics: [] } },
      },
    }
    expect(() => readSpiceImportResult({ ...base, moduleResult: { ...base.moduleResult, result: { ok: true, methodId: input.method, import: { mnaInput, nodeMap: {}, diagnostics: [] } } } } as unknown as JobResultV1, input)).toThrow(/MNA JobSpec/)
    expect(() => readSpiceImportResult({ ...base, moduleResult: { ...base.moduleResult, result: { ok: true, methodId: input.method, import: { mnaInput, mnaJobSpec, nodeMap: { in: -1 }, diagnostics: [] } } } } as unknown as JobResultV1, input)).toThrow(/node index/)
  })

  it('refuses to export when a successful parser response carries an error diagnostic', () => {
    const { input } = createSpiceImportJob({ netlist })
    const result = {
      schemaVersion: 1,
      status: 'succeeded',
      summary: { steps: 1 },
      moduleResult: {
        module: input.module,
        backend: { id: 'host-f64' },
        result: {
          ok: true,
          methodId: input.method,
          import: { mnaInput, mnaJobSpec, nodeMap: { in: 1 }, diagnostics: [{ severity: 'error', message: 'Unsupported element B1' }] },
        },
      },
    } as unknown as JobResultV1
    expect(() => readSpiceImportResult(result, input)).toThrow(/Unsupported element B1/)
  })

  it('rejects an empty deck before creating a job', () => {
    expect(() => createSpiceImportJob({ netlist: '  \n' })).toThrow(/empty/)
  })

  it('builds an explicit host MNA operating-point input on the native transport', () => {
    const { input, spec } = createSpiceDcJob(imported())
    expect(input).toMatchObject({ module: 'mna', method: 'method-algo-mna-dc', backend: 'host', circuit: {
      nodes: 2, resistors: mnaInput.circuit.resistors, vSources: mnaInput.circuit.vSources, iSources: [],
    } })
    expect(spec.requirements?.backends).toEqual(['cuda'])
    expect(spec.model).toMatchObject({ source: 'inline', inline: { ...input, backend: 'host' } })
  })

  it('maps a real native divider response back to named nodes and solver provenance', () => {
    const { input } = createSpiceDcJob(imported())
    expect(readSpiceDcResult(dcResult() as unknown as JobResultV1, input, imported().nodeMap)).toEqual({
      nodeVoltages: { '0': 0, in: 10, out: 7.5 },
      methodId: 'method-algo-mna-dc', familyId: 'method-mna', converged: true,
      iterations: 1, residualNorm: 0, backend: { id: 'host-f64-mna' },
    })
  })

  it('rejects mismatched exported specs, unsupported devices, and non-DC methods', () => {
    expect(() => createSpiceDcJob({ ...imported(), mnaJobSpec: { ...mnaJobSpec, model: { source: 'inline', inline: { ...mnaInput, method: 'method-algo-mna-ac' } } } as unknown as MnaImport['mnaJobSpec'] } as MnaImport)).toThrow(/exactly match/)
    expect(() => createSpiceDcJob({ ...imported(), mnaInput: { ...mnaInput, circuit: { ...mnaInput.circuit, diodes: [{ a: 1, b: 2 }] } } })).toThrow(/diodes must be an empty array/)
    expect(() => createSpiceDcJob({ ...imported(), mnaInput: { ...mnaInput, method: 'method-algo-mna-dc-sweep' } })).toThrow(/not a DC operating-point/)
    expect(() => createSpiceDcJob({ ...imported(), mnaInput: { ...mnaInput, circuit: { ...mnaInput.circuit, capacitors: [{ a: 1, b: 2, c: 1e-6 }] } } })).toThrow(/capacitors must be an empty array/)
    expect(() => createSpiceDcJob({ ...imported(), mnaInput: { ...mnaInput, circuit: { ...mnaInput.circuit, inductors: null } } })).toThrow(/inductors must be an empty array/)
  })

  it('rejects malformed, non-finite, dimension-mismatched, or unrequested solver responses', () => {
    const { input } = createSpiceDcJob(imported())
    expect(() => readSpiceDcResult(dcResult({ methodId: 'method-algo-mna-ac' }) as unknown as JobResultV1, input, imported().nodeMap)).toThrow(/method or family/)
    expect(() => readSpiceDcResult(dcResult({ nodeVoltages: [10, Number.NaN] }) as unknown as JobResultV1, input, imported().nodeMap)).toThrow(/not finite/)
    expect(() => readSpiceDcResult(dcResult({ nodeVoltages: [10] }) as unknown as JobResultV1, input, imported().nodeMap)).toThrow(/dimension/)
    expect(() => readSpiceDcResult(dcResult({ converged: false }) as unknown as JobResultV1, input, imported().nodeMap)).toThrow(/did not converge/)
    expect(() => readSpiceDcResult(dcResult() as unknown as JobResultV1, { ...input, method: 'method-algo-mna-ac' } as unknown as typeof input, imported().nodeMap)).toThrow(/submitted MNA job/)
  })
})
