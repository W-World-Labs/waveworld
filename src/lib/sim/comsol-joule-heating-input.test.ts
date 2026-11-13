import { describe, expect, it } from 'vitest'
import {
  comsolJouleHeatingDraft,
  createComsolJouleHeatingJob,
  createDefaultComsolJouleHeating,
  validateComsolJouleHeatingInput,
} from './comsol-joule-heating-input'

describe('COMSOL DC Joule heating input', () => {
  it('builds the default host job with the released native module and exact parser field names', () => {
    const draft = createDefaultComsolJouleHeating()
    const { input, spec } = createComsolJouleHeatingJob(draft)

    expect(draft).toEqual({
      drive: 'current', current: 10, sigma0: 5.8e7, alpha: 0.0039,
      T_ref: 293.15, k: 400, L: 0.05, area: 1e-6, T_0: 293.15, T_L: 293.15, N: 5,
    })
    expect(input).toEqual({
      module: 'sw-comsol-joule-heating-b',
      methodId: 'method-algo-comsol-joule-heating-1d-coupled',
      backend: 'host', mode: 'joule', current: 10,
      sigma0: 5.8e7, alpha: 0.0039, T_ref: 293.15, k: 400,
      L: 0.05, area: 1e-6, T_0: 293.15, T_L: 293.15, N: 5,
    })
    expect(spec).toMatchObject({
      schemaVersion: 1,
      kind: 'waveworld-module',
      name: 'sw-comsol-joule-heating-b',
      parameters: { module: 'sw-comsol-joule-heating-b' },
      model: { source: 'inline', inline: input },
      requirements: { backends: ['cuda'] },
    })
  })

  it('maps voltage drive and captured native snapshots to the editable draft', () => {
    const draft = {
      drive: 'voltage' as const, voltage: 0.01,
      sigma0: 5.8e7, alpha: 0.0039, T_ref: 293.15, k: 400,
      L: 0.05, area: 1e-6, T_0: 300, T_L: 320, N: 101,
    }
    const { input } = createComsolJouleHeatingJob(draft)

    expect(input).toEqual({
      module: 'sw-comsol-joule-heating-b',
      methodId: 'method-algo-comsol-joule-heating-1d-coupled',
      backend: 'host', mode: 'joule', voltage: 0.01,
      sigma0: 5.8e7, alpha: 0.0039, T_ref: 293.15, k: 400,
      L: 0.05, area: 1e-6, T_0: 300, T_L: 320, N: 101,
    })
    expect(comsolJouleHeatingDraft(input)).toEqual(draft)
  })

  it('accepts the native sample cap and rejects malformed or out-of-bound drafts', () => {
    const valid = createDefaultComsolJouleHeating()
    expect(createComsolJouleHeatingJob({ ...valid, N: 4096 }).input.N).toBe(4096)

    const invalidDrafts = [
      { ...valid, current: -1 }, { ...valid, current: 1_000_001 },
      { ...valid, sigma0: 0 }, { ...valid, sigma0: 1_000_000_001 },
      { ...valid, alpha: -0.001 }, { ...valid, alpha: 1.01 },
      { ...valid, T_ref: 0 }, { ...valid, k: Number.NaN },
      { ...valid, L: 0 }, { ...valid, L: 10_001 },
      { ...valid, area: 101 }, { ...valid, T_0: 0 },
      { ...valid, T_L: Number.POSITIVE_INFINITY },
      { ...valid, N: 1 }, { ...valid, N: 4097 }, { ...valid, N: 2.5 },
      { ...valid, drive: 'both', voltage: 1 },
      { ...valid, drive: 'voltage', voltage: 1, current: 10 },
      { ...valid, current: '10' }, { ...valid, unexpected: true }, null,
    ]
    for (const draft of invalidDrafts) expect(() => createComsolJouleHeatingJob(draft as never)).toThrow()
  })

  it('requires exactly one canonical drive and rejects non-DC modes or non-native fields', () => {
    const valid = createComsolJouleHeatingJob(createDefaultComsolJouleHeating()).input
    const malformedInputs: unknown[] = [
      { ...valid, voltage: 0.01 },
      (() => { const { current: _current, ...input } = valid; return input })(),
      { ...valid, mode: 'inductive' },
      { ...valid, methodId: 'method-algo-comsol-induction-halfspace-skin' },
      { ...valid, backend: 'cuda' },
      { ...valid, length: 0.05 },
      { ...valid, N: 1 },
      { ...valid, extra: true },
    ]
    for (const input of malformedInputs) expect(() => validateComsolJouleHeatingInput(input)).toThrow()
    expect(() => validateComsolJouleHeatingInput({ ...valid, extra: true })).toThrow(/unsupported field/)
  })
})
