import { describe, expect, it } from 'vitest'
import {
  createAbaqusBeamStudyJob,
  createDefaultAbaqusBeamStudy,
  validateAbaqusBeamStudyDraft,
  validateAbaqusBeamStudyInput,
} from './abaqus-beam-study-input'
import { parseAbaqusBeamStudyResult } from './abaqus-beam-study-result'
import { abaqusBeamStudyCsv, abaqusBeamStudyReport } from './abaqus-beam-study-export'

const jobResult = (moduleResult: unknown) => ({
  schemaVersion: 1 as const,
  summary: { steps: 1, wallTimeMs: 2 },
  moduleResult,
})

function nativeResult(input: ReturnType<typeof createAbaqusBeamStudyJob>['input']) {
  const n = input.elements
  const length = input.length
  const shearArea = input.section.k * input.section.A
  const shearStiffness = input.section.E / (2 * (1 + input.section.nu)) * shearArea
  const nodes = Array.from({ length: n + 1 }, (_, index) => ({
    index, x: length * index / n, u: 0, v: index === n ? -0.001 : 0, theta: index === n ? -0.002 : 0,
  }))
  return {
    module: input.module,
    familyId: 'method-calculix-timoshenko-beam',
    methodId: 'method-algo-b31-timoshenko',
    backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
    element: 'B31', elementNodes: 2, dofPerNode: 3, length,
    nElements: n, nNodes: n + 1, boundary: 'cantilever',
    shearParameter: 12 * input.section.E * input.section.I / (shearStiffness * length ** 2),
    bendingStiffness: input.section.E * input.section.I,
    shearStiffness, shearCorrectionFactor: input.section.k, shearArea,
    nodes,
    probe: { node: n, x: length, v: nodes[n].v, theta: nodes[n].theta },
    maxDeflection: 0.001, maxMoment: 1000,
    reactions: [
      { node: 0, dof: 'u', value: 0 },
      { node: 0, dof: 'v', value: 1000 },
      { node: 0, dof: 'theta', value: 1000 },
    ],
    springForces: [],
    elements: Array.from({ length: n }, (_, index) => ({ index, nodes: [index, index + 1], endForces: [0, 0, 0, 0, 0, 0] })),
    closedForm: { deflection: -0.001, rotation: -0.002, maxMoment: 1000 },
    ok: true,
    futureNativeField: { retained: true },
  }
}

describe('Abaqus-mapped B31 study input', () => {
  it('provides the documented defaults and builds one exact pinned host job input', () => {
    const draft = createDefaultAbaqusBeamStudy()
    expect(draft).toEqual({
      length: 1, elements: 20,
      section: { E: 210e9, A: 0.005, I: 4.166666666666667e-6, nu: 0.3, k: 5 / 6 },
      boundary: 'cantilever', load: { type: 'point', value: 1000 },
    })
    const { input, spec } = createAbaqusBeamStudyJob(draft)
    expect(input).toEqual({
      module: 'sw-calculix-timoshenko-beam', backend: 'host', element: 'B31',
      ...draft, load: { ...draft.load, position: draft.length },
    })
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(1)
    expect(spec.model?.inline).toEqual(input)
  })

  it('accepts point and uniform loads while rejecting malformed, unsupported, and out-of-bound values', () => {
    const base = createDefaultAbaqusBeamStudy()
    expect(validateAbaqusBeamStudyDraft({ ...base, elements: 1, load: { type: 'udl', value: 50 } }).load)
      .toEqual({ type: 'udl', value: 50 })
    const { input } = createAbaqusBeamStudyJob(base)
    expect(validateAbaqusBeamStudyInput(input)).toEqual(input)

    const invalidDrafts = [
      { ...base, elements: 1.2 }, { ...base, elements: 2049 },
      { ...base, length: Number.NaN }, { ...base, length: 0 },
      { ...base, section: { ...base.section, E: Infinity } },
      { ...base, section: { ...base.section, nu: 0.5 } },
      { ...base, section: { ...base.section, unknown: 1 } },
      { ...base, boundary: 'simply-supported' },
      { ...base, load: { type: 'moment', value: 1 } },
      { ...base, load: { ...base.load, value: 0 } },
      { ...base, unexpected: true },
    ]
    for (const invalid of invalidDrafts) expect(() => validateAbaqusBeamStudyDraft(invalid)).toThrow()

    for (const invalid of [
      { ...input, backend: 'cuda' }, { ...input, element: 'B32' },
      { ...input, load: { type: 'point', value: 1000, position: input.length / 2 } },
      { ...input, load: { type: 'udl', value: 10, position: input.length } },
      { ...input, extra: 'not in the wire contract' },
    ]) expect(() => validateAbaqusBeamStudyInput(invalid)).toThrow()
  })

  it('keeps draft validation immutable and maps UDL without a point position', () => {
    const draft = { ...createDefaultAbaqusBeamStudy(), load: { type: 'udl' as const, value: 25 } }
    const original = structuredClone(draft)
    const { input } = createAbaqusBeamStudyJob(draft)
    expect(draft).toEqual(original)
    expect(input.load).toEqual({ type: 'udl', value: 25 })
  })
})

describe('Abaqus-mapped B31 native result', () => {
  it('validates native identity, host provenance, submitted mesh, and finite fields while tolerating future keys', () => {
    const { input } = createAbaqusBeamStudyJob(createDefaultAbaqusBeamStudy())
    const raw = nativeResult(input)
    const parsed = parseAbaqusBeamStudyResult(jobResult(raw), input)
    expect(parsed.backend.id).toBe('host-f64')
    expect(parsed.nodes).toHaveLength(input.elements + 1)
    expect(parsed.elements).toHaveLength(input.elements)
    expect(parsed.futureNativeField).toEqual({ retained: true })

    for (const mutate of [
      (r: any) => { r.methodId = 'unknown' },
      (r: any) => { r.ok = false },
      (r: any) => { r.backend.id = 'cuda' },
      (r: any) => { r.nElements -= 1 },
      (r: any) => { r.nodes[1].x += 0.1 },
      (r: any) => { r.nodes[0].v = Number.NaN },
      (r: any) => { r.probe.v = 2 },
      (r: any) => { r.reactions.pop() },
      (r: any) => { r.elements[0].nodes = [1, 2] },
      (r: any) => { r.elements[0].endForces[0] = Infinity },
      (r: any) => { r.springForces.push({ node: 0 }) },
      (r: any) => { r.closedForm = { deflection: 0, rotation: 0, maxMoment: Number.NaN } },
    ]) {
      const bad = structuredClone(raw)
      mutate(bad)
      expect(() => parseAbaqusBeamStudyResult(jobResult(bad), input)).toThrow()
    }
  })

  it('allows absent canonical comparison as null and handles the UDL input', () => {
    const { input } = createAbaqusBeamStudyJob({ ...createDefaultAbaqusBeamStudy(), load: { type: 'udl', value: 20 } })
    const raw = nativeResult(input) as Record<string, unknown>
    raw.closedForm = null
    expect(parseAbaqusBeamStudyResult(jobResult(raw), input).closedForm).toBeNull()
  })
})

describe('Abaqus-mapped B31 report exports', () => {
  it('exports rows plus a scoped JSON report paired with the supplied snapshot and job ID', () => {
    const draft = createDefaultAbaqusBeamStudy()
    const { input } = createAbaqusBeamStudyJob(draft)
    const result = parseAbaqusBeamStudyResult(jobResult(nativeResult(input)), input)
    const args = { draft, input, result, jobId: 'beam-job-42' }
    const csv = abaqusBeamStudyCsv(args)
    expect(csv).toContain('"record_type","index","job_id","backend"')
    expect(csv).toContain('beam-job-42')
    expect(csv).toContain('study_metadata')
    expect(csv).toContain('textbook_comparison')
    expect(csv).toContain('nativeResult')

    const report = JSON.parse(abaqusBeamStudyReport(args))
    expect(report.jobId).toBe('beam-job-42')
    expect(report.provenance).toMatchObject({ solver: 'W-Sim native host-f64', modulePin: 'dda2f6f1' })
    expect(report.draft).toEqual(draft)
    expect(report.input).toEqual(input)
    expect(report.result).toMatchObject({ backend: { id: 'host-f64' }, nodes: result.nodes })
    expect(report.scope.excluded).toMatch(/does not represent Abaqus execution/)
  })
})
