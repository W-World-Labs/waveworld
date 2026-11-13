import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, readModuleResult, type ModuleComputeInput } from './module-compute'

export type CstWaveguideFieldSample = { x: number; y: number }

export type CstWaveguideStudyInput = {
  module: 'waveguide-modes'
  backend: 'host'
  operation: 'cst-waveguide-electric-field-samples'
  a: number
  b: number
  m: number
  n: number
  family: 'TE' | 'TM'
  frequency: number
  fieldSamples: CstWaveguideFieldSample[]
}

export type CstWaveguideStudyDraft = Omit<CstWaveguideStudyInput, 'module' | 'backend' | 'operation'>

export type CstWaveguideNativeResult = {
  operation: typeof OPERATION
  familyId: 'method-waveguide-modes'
  family: 'TE' | 'TM'
  m: number
  n: number
  frequencyHz: number
  cutoffHz: number
  betaRadPerM: number
  normalization: string
  fieldSamples: Array<CstWaveguideFieldSample & { exMagnitude: number; eyMagnitude: number; ezMagnitude: number }>
  finite: true
  ok: true
}

export type CstWaveguideStudyResult = {
  input: CstWaveguideStudyInput
  backend: Record<string, unknown>
  result: CstWaveguideNativeResult
}

const OPERATION = 'cst-waveguide-electric-field-samples'
const MAX_SAMPLES = 4096

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function finite(value: unknown, label: string, min: number, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and in [${min}, ${max}]`)
  }
}

function validateDraft(value: unknown): CstWaveguideStudyDraft {
  const draft = object(value, 'CST waveguide study')
  const keys = ['a', 'b', 'm', 'n', 'family', 'frequency', 'fieldSamples']
  for (const key of Object.keys(draft)) if (!keys.includes(key)) throw new Error(`CST waveguide study has unsupported field ${key}`)
  for (const key of keys) if (!(key in draft)) throw new Error(`CST waveguide study.${key} is required`)
  finite(draft.a, 'Guide dimension a (m)', 1e-9, 1e3)
  finite(draft.b, 'Guide dimension b (m)', 1e-9, 1e3)
  for (const [key, value] of [['m', draft.m], ['n', draft.n]] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 15) {
      throw new Error(`Mode index ${key} must be an integer in [0, 15]`)
    }
  }
  if (draft.family !== 'TE' && draft.family !== 'TM') throw new Error('Mode family must be TE or TM')
  if (draft.family === 'TE' ? draft.m === 0 && draft.n === 0 : draft.m === 0 || draft.n === 0) {
    throw new Error(`Mode indices are invalid for ${draft.family}`)
  }
  finite(draft.frequency, 'Frequency (Hz)', 1, 1e15)
  if (!Array.isArray(draft.fieldSamples) || draft.fieldSamples.length < 1 || draft.fieldSamples.length > MAX_SAMPLES) {
    throw new Error(`Field samples must contain 1 to ${MAX_SAMPLES} coordinates`)
  }
  const fieldSamples = draft.fieldSamples.map((raw, index) => {
    const point = object(raw, `Field sample ${index}`)
    for (const key of Object.keys(point)) if (key !== 'x' && key !== 'y') throw new Error(`Field sample ${index} has unsupported field ${key}`)
    finite(point.x, `Field sample ${index} x (m)`, 0, draft.a as number)
    finite(point.y, `Field sample ${index} y (m)`, 0, draft.b as number)
    return { x: point.x as number, y: point.y as number }
  })
  return {
    a: draft.a as number, b: draft.b as number, m: draft.m as number, n: draft.n as number,
    family: draft.family, frequency: draft.frequency as number, fieldSamples,
  }
}

/** Build the component's 11 by 7 cross-section grid, including the guide walls. */
export function createCstWaveguideGrid(a: number, b: number): CstWaveguideFieldSample[] {
  finite(a, 'Guide dimension a (m)', 1e-9, 1e3)
  finite(b, 'Guide dimension b (m)', 1e-9, 1e3)
  return Array.from({ length: 7 }, (_, row) => Array.from({ length: 11 }, (_, column) => ({
    x: a * column / 10,
    y: b * row / 6,
  }))).flat()
}

export function createDefaultCstWaveguideStudy(): CstWaveguideStudyDraft {
  const a = 0.02286
  const b = 0.01016
  return { a, b, m: 1, n: 0, family: 'TE', frequency: 10e9, fieldSamples: createCstWaveguideGrid(a, b) }
}

export function createCstWaveguideStudyJob(draft: CstWaveguideStudyDraft): { input: CstWaveguideStudyInput; spec: JobSpecV1 } {
  const value = validateDraft(draft)
  const input: CstWaveguideStudyInput = {
    module: 'waveguide-modes', backend: 'host', operation: OPERATION,
    a: value.a, b: value.b, m: value.m, n: value.n, family: value.family,
    frequency: value.frequency, fieldSamples: value.fieldSamples.map(point => ({ ...point })),
  }
  return { input, spec: createModuleJobSpec(input as unknown as ModuleComputeInput) }
}

/** Parse native field samples as returned; cutoff and propagation remain native-owned. */
export function parseCstWaveguideStudyResult(result: JobResultV1, submitted: CstWaveguideStudyInput): CstWaveguideStudyResult {
  const input = validateDraft({
    a: submitted.a, b: submitted.b, m: submitted.m, n: submitted.n, family: submitted.family,
    frequency: submitted.frequency, fieldSamples: submitted.fieldSamples,
  })
  const output = object(readModuleResult(result, submitted as unknown as ModuleComputeInput), 'CST waveguide module result')
  if (output.module !== 'waveguide-modes') throw new Error('CST waveguide result module does not match the request')
  const backend = object(output.backend, 'CST waveguide backend provenance')
  if (backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64') throw new Error('CST waveguide result must report the pinned host-f64 backend')
  const payload = object(output.result, 'CST waveguide field payload')
  if (payload.operation !== OPERATION || payload.familyId !== 'method-waveguide-modes') throw new Error('CST waveguide result operation or family does not match the pinned native operation')
  if (payload.ok !== true || payload.finite !== true) throw new Error('CST waveguide native result must report successful finite samples')
  if (payload.family !== input.family || payload.m !== input.m || payload.n !== input.n || payload.frequencyHz !== input.frequency) {
    throw new Error('CST waveguide result mode or frequency does not match submitted inputs')
  }
  finite(payload.cutoffHz, 'Native cutoff frequency (Hz)', 0, 1e15)
  finite(payload.betaRadPerM, 'Native propagation constant (rad/m)', 0, Number.MAX_VALUE)
  const expectedNormalization = input.family === 'TE' ? 'peak Hz = 1 A/m' : 'peak Ez = 1 V/m'
  if (payload.normalization !== expectedNormalization) throw new Error('CST waveguide result normalization does not match the requested family')
  if (!Array.isArray(payload.fieldSamples) || payload.fieldSamples.length !== input.fieldSamples.length) {
    throw new Error('CST waveguide result sample count does not match submitted coordinates')
  }
  const fieldSamples = payload.fieldSamples.map((raw, index) => {
    const sample = object(raw, `CST waveguide returned sample ${index}`)
    const source = input.fieldSamples[index]
    if (sample.x !== source.x || sample.y !== source.y) throw new Error(`CST waveguide returned sample ${index} does not match submitted coordinates`)
    finite(sample.exMagnitude, `Native Ex magnitude ${index}`, 0, Number.MAX_VALUE)
    finite(sample.eyMagnitude, `Native Ey magnitude ${index}`, 0, Number.MAX_VALUE)
    finite(sample.ezMagnitude, `Native Ez magnitude ${index}`, 0, Number.MAX_VALUE)
    return {
      x: sample.x as number, y: sample.y as number,
      exMagnitude: sample.exMagnitude as number, eyMagnitude: sample.eyMagnitude as number,
      ezMagnitude: sample.ezMagnitude as number,
    }
  })
  const inputSnapshot: CstWaveguideStudyInput = {
    module: submitted.module, backend: submitted.backend, operation: submitted.operation,
    a: submitted.a, b: submitted.b, m: submitted.m, n: submitted.n, family: submitted.family,
    frequency: submitted.frequency, fieldSamples: submitted.fieldSamples.map(point => ({ x: point.x, y: point.y })),
  }
  return {
    input: inputSnapshot,
    backend,
    result: {
      operation: OPERATION,
      familyId: 'method-waveguide-modes',
      family: input.family, m: input.m, n: input.n, frequencyHz: payload.frequencyHz as number,
      cutoffHz: payload.cutoffHz as number, betaRadPerM: payload.betaRadPerM as number,
      normalization: payload.normalization as string, fieldSamples,
      finite: true, ok: true,
    },
  }
}
