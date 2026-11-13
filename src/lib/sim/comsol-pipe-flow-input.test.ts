import { describe, expect, it } from 'vitest'
import {
  comsolPipeFlowDraft,
  createComsolPipeFlowJob,
  createDefaultComsolPipeFlow,
  validateComsolPipeFlowInput,
} from './comsol-pipe-flow-input'

describe('COMSOL pipe flow input', () => {
  it('builds the default host job for the exact native module and method', () => {
    const draft = createDefaultComsolPipeFlow()
    const { input, spec } = createComsolPipeFlowJob(draft)

    expect(draft).toEqual({
      length: 10,
      diameter: 0.05,
      rho: 998.2,
      mu: 0.001002,
      inletPressure: 1.01e5,
      outletPressure: 1e5,
    })
    expect(input).toEqual({
      module: 'sw-comsol-pipe-flow',
      methodId: 'method-algo-pipe-flow-1d',
      backend: 'host',
      rho: 998.2,
      mu: 0.001002,
      nodes: [{ id: 'inlet', pressure: 1.01e5 }, { id: 'outlet', pressure: 1e5 }],
      edges: [{ id: 'pipe', from: 'inlet', to: 'outlet', length: 10, diameter: 0.05 }],
    })
    expect(spec).toMatchObject({
      schemaVersion: 1,
      kind: 'waveworld-module',
      name: 'sw-comsol-pipe-flow',
      parameters: { module: 'sw-comsol-pipe-flow' },
      model: { source: 'inline', inline: input },
      requirements: { backends: ['cuda'] },
    })
    expect((spec.model as { inline: Record<string, unknown> }).inline).toMatchObject({
      methodId: 'method-algo-pipe-flow-1d', backend: 'host',
    })
  })

  it('maps the captured input snapshot back to the editable draft values', () => {
    const { input } = createComsolPipeFlowJob({
      length: 23,
      diameter: 0.12,
      rho: 1025,
      mu: 0.0018,
      inletPressure: 240_000,
      outletPressure: 100_000,
    })

    expect(comsolPipeFlowDraft(input)).toEqual({
      length: 23,
      diameter: 0.12,
      rho: 1025,
      mu: 0.0018,
      inletPressure: 240_000,
      outletPressure: 100_000,
    })
  })

  it('rejects malformed, nonfinite, out-of-unit-bound, and reversed-pressure drafts', () => {
    const valid = createDefaultComsolPipeFlow()
    const invalidDrafts = [
      { ...valid, length: 0 }, { ...valid, length: 10_001 },
      { ...valid, diameter: -0.01 }, { ...valid, diameter: 11 },
      { ...valid, rho: Number.NaN }, { ...valid, rho: 20_001 },
      { ...valid, mu: Number.POSITIVE_INFINITY }, { ...valid, mu: 1001 },
      { ...valid, inletPressure: -1 }, { ...valid, inletPressure: 100_000_001 },
      { ...valid, outletPressure: Number.NaN },
      { ...valid, inletPressure: 100_000, outletPressure: 100_000 },
      { ...valid, inletPressure: 99_999, outletPressure: 100_000 },
      { ...valid, length: '10' }, { ...valid, unexpected: true },
      null,
    ]
    for (const draft of invalidDrafts) expect(() => createComsolPipeFlowJob(draft as never)).toThrow()
  })

  it('requires exactly two ordered boundary nodes and one inlet-to-outlet pipe edge', () => {
    const valid = createComsolPipeFlowJob(createDefaultComsolPipeFlow()).input
    const malformedInputs: unknown[] = [
      { ...valid, nodes: [valid.nodes[0]] },
      { ...valid, nodes: [...valid.nodes, valid.nodes[1]] },
      { ...valid, nodes: [valid.nodes[1], valid.nodes[0]] },
      { ...valid, nodes: [{ ...valid.nodes[0], pressure: -1 }, valid.nodes[1]] },
      { ...valid, nodes: [{ ...valid.nodes[0], pressure: valid.nodes[1].pressure }, valid.nodes[1]] },
      { ...valid, edges: [] },
      { ...valid, edges: [...valid.edges, valid.edges[0]] },
      { ...valid, edges: [{ ...valid.edges[0], from: 'outlet' }] },
      { ...valid, edges: [{ ...valid.edges[0], length: 0 }] },
      { ...valid, edges: [{ ...valid.edges[0], diameter: 10.1 }] },
      { ...valid, edges: [{ ...valid.edges[0], extra: true }] },
    ]
    for (const input of malformedInputs) expect(() => validateComsolPipeFlowInput(input)).toThrow()
  })

  it('rejects unknown top-level fields and the wrong module, method, or backend', () => {
    const valid = createComsolPipeFlowJob(createDefaultComsolPipeFlow()).input
    expect(() => validateComsolPipeFlowInput({ ...valid, extra: true })).toThrow(/unsupported field/)
    expect(() => validateComsolPipeFlowInput({ ...valid, module: 'sw-other' })).toThrow(/admitted host method/)
    expect(() => validateComsolPipeFlowInput({ ...valid, methodId: 'method-other' })).toThrow(/admitted host method/)
    expect(() => validateComsolPipeFlowInput({ ...valid, backend: 'cuda' })).toThrow(/admitted host method/)
  })
})
