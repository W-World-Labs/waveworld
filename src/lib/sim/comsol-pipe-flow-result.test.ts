import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { createComsolPipeFlowJob, createDefaultComsolPipeFlow } from './comsol-pipe-flow-input'
import { readComsolPipeFlowResult } from './comsol-pipe-flow-result'

const input = createComsolPipeFlowJob(createDefaultComsolPipeFlow()).input
const nativeGravity = 9.81
const pressureHead = (pressure: number) => pressure / (input.rho * nativeGravity)

const nativePayload = {
  ok: true,
  methodId: 'method-algo-pipe-flow-1d',
  familyId: 'method-pipe-flow-1d',
  scopeNote: 'Steady, incompressible, single-pipe Darcy-Weisbach network solve.',
  rho: input.rho,
  mu: input.mu,
  g: nativeGravity,
  iterations: 4,
  maxEnergyResidual: 0,
  maxMassResidual: 0,
  nodeCount: 2,
  edgeCount: 1,
  nodes: [
    { id: 'inlet', pressure: input.nodes[0]!.pressure, head: pressureHead(input.nodes[0]!.pressure), z: 0, boundary: true },
    { id: 'outlet', pressure: input.nodes[1]!.pressure, head: pressureHead(input.nodes[1]!.pressure), z: 0, boundary: true },
  ],
  edges: [{
    id: 'pipe', from: 'inlet', to: 'outlet', length: input.edges[0]!.length,
    hydraulicDiameter: input.edges[0]!.diameter, flow: 0.001, velocity: 0.51,
    reynolds: 25400, rheology: 'Newtonian', frictionFactor: 0.025, regime: 'turbulent',
    headLoss: (input.nodes[0]!.pressure - input.nodes[1]!.pressure) / (input.rho * nativeGravity),
  }],
}

const jobResult = (
  payload: Record<string, unknown> = {},
  wrapper: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    ok: true,
    module: 'sw-comsol-pipe-flow',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
    result: { ...nativePayload, ...payload },
    ...wrapper,
  },
})

const read = (value: unknown = jobResult(), submitted = input) =>
  readComsolPipeFlowResult(value as JobResultV1, submitted)

describe('COMSOL pipe-flow result reader', () => {
  it('accepts native host-f64 provenance and returns the validated single-pipe result', () => {
    const parsed = read()

    expect(parsed.backend).toEqual({ id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' })
    expect(parsed.result).toMatchObject({
      rho: input.rho,
      mu: input.mu,
      g: 9.81,
      iterations: 4,
      nodeCount: 2,
      edgeCount: 1,
      ok: true,
      methodId: 'method-algo-pipe-flow-1d',
      familyId: 'method-pipe-flow-1d',
      nodes: nativePayload.nodes,
      edges: nativePayload.edges,
    })
  })

  it('rejects changed or missing module identity and backend provenance', () => {
    expect(() => read(jobResult({}, { module: 'sw-comsol-other' }))).toThrow(/module/i)
    expect(() => read(jobResult({}, { module: undefined }))).toThrow(/module/i)
    expect(() => read(jobResult({}, { backend: { id: 'w-sim-cuda-host', kind: 'cuda-f64', deviceName: 'w-sim-cuda-host' } }))).toThrow(/backend/i)
    expect(() => read(jobResult({}, { backend: undefined }))).toThrow(/backend/i)
    expect(() => read(jobResult({}, { backend: { id: 'w-sim-cuda-host', kind: 'host-f64' } }))).toThrow(/backend/i)
  })

  it('rejects failed operations and changed or missing native method identity', () => {
    expect(() => read(jobResult({}, { ok: false }))).toThrow()
    expect(() => read(jobResult({ ok: false }))).toThrow(/successful|failure/i)
    expect(() => read(jobResult({ methodId: 'method-algo-other' }))).toThrow(/method/i)
    expect(() => read(jobResult({ methodId: undefined }))).toThrow(/method/i)
    expect(() => read(jobResult({ familyId: 'method-other' }))).toThrow(/method/i)
    expect(() => read(jobResult({ familyId: undefined }))).toThrow(/method/i)
  })

  it('rejects invalid node and edge dimensions and endpoint mappings', () => {
    expect(() => read(jobResult({ nodeCount: 3 }))).toThrow(/dimension/i)
    expect(() => read(jobResult({ nodes: nativePayload.nodes.slice(0, 1) }))).toThrow(/dimension/i)
    expect(() => read(jobResult({ edgeCount: 2 }))).toThrow(/dimension/i)
    expect(() => read(jobResult({ edges: [] }))).toThrow(/dimension/i)
    expect(() => read(jobResult({ nodes: [{ ...nativePayload.nodes[0], id: 'outlet' }, nativePayload.nodes[1]] }))).toThrow(/endpoint/i)
    expect(() => read(jobResult({ nodes: [{ ...nativePayload.nodes[0], boundary: false }, nativePayload.nodes[1]] }))).toThrow(/endpoint/i)
    expect(() => read(jobResult({ edges: [{ ...nativePayload.edges[0], to: 'inlet' }] }))).toThrow(/endpoint/i)
  })

  it('rejects pressure, pipe geometry, and non-finite metric mismatches', () => {
    expect(() => read(jobResult({ nodes: [{ ...nativePayload.nodes[0], pressure: 100000 }, nativePayload.nodes[1]] }))).toThrow(/pressure/i)
    expect(() => read(jobResult({ edges: [{ ...nativePayload.edges[0], length: input.edges[0]!.length + 1 }] }))).toThrow(/length/i)
    expect(() => read(jobResult({ edges: [{ ...nativePayload.edges[0], hydraulicDiameter: input.edges[0]!.diameter * 2 }] }))).toThrow(/diameter/i)
    expect(() => read(jobResult({ edges: [{ ...nativePayload.edges[0], flow: Number.NaN }] }))).toThrow(/finite/i)
    expect(() => read(jobResult({ edges: [{ ...nativePayload.edges[0], reynolds: Number.POSITIVE_INFINITY }] }))).toThrow(/finite/i)
    expect(() => read(jobResult({ maxMassResidual: Number.NaN }))).toThrow(/finite/i)
    expect(() => read(jobResult({ edges: [{ ...nativePayload.edges[0], headLoss: nativePayload.edges[0].headLoss + 1 }] }))).toThrow(/pressure\/head-loss balance/i)
  })

  it('rejects nonconverged energy and mass residuals', () => {
    expect(() => read(jobResult({ maxEnergyResidual: 1e-2 }))).toThrow(/converge|residual/i)
    expect(() => read(jobResult({ maxMassResidual: 1e-4 }))).toThrow(/converge|residual/i)
  })
})
