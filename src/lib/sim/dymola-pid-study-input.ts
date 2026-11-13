import type { JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, type ModuleComputeInput } from './module-compute'

export type PidStudyDraft = {
  processGain: number
  timeConstant: number
  proportionalGain: number
  integralGain: number
  setpoint: number
  duration: number
  points: number
}

export type PidStudyInput = {
  module: 'sw-openmodelica-state-space-observers'
  method: 'state-space'
  backend: 'host'
  A: [[number, number], [number, number]]
  B: [[number], [number]]
  C: [[1, 0]]
  D: [[0]]
  x0: [0, 0]
  u: [number]
  times: number[]
}

const DRAFT_KEYS = ['processGain', 'timeConstant', 'proportionalGain', 'integralGain', 'setpoint', 'duration', 'points'] as const
const INPUT_KEYS = ['module', 'method', 'backend', 'A', 'B', 'C', 'D', 'x0', 'u', 'times'] as const

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name} has unsupported field ${key}`)
  for (const key of keys) if (!(key in value)) fail(`${name}.${key} is required`)
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

function matrixNormBound(
  A: readonly (readonly number[])[],
  B: readonly (readonly number[])[],
  u: readonly number[],
  duration: number,
): void {
  const norm = Math.max(...A.map((row, index) => row.reduce((sum, value) => sum + Math.abs(value), Math.abs(B[index][0] * u[0]))))
  const scaled = norm * duration
  if (!Number.isFinite(norm) || !Number.isFinite(scaled)) fail('augmented state-space matrix exponential bound must be finite')
  if (scaled > 64) fail('augmented generator infinity norm times duration must be at most 64')
}

function derivedMatrix(draft: Pick<PidStudyDraft, 'processGain' | 'timeConstant' | 'proportionalGain' | 'integralGain'>): PidStudyInput['A'] {
  const a00 = -(1 + draft.proportionalGain * draft.processGain) / draft.timeConstant
  const a01 = draft.integralGain * draft.processGain / draft.timeConstant
  if (!Number.isFinite(a00) || !Number.isFinite(a01)) fail('derived state-space matrix entries must be finite')
  return [[a00, a01], [-1, 0]]
}

export function validatePidStudyDraft(value: unknown): PidStudyDraft {
  const draft = record(value, 'PI study draft')
  exactKeys(draft, DRAFT_KEYS, 'PI study draft')
  const validated: PidStudyDraft = {
    processGain: finite(draft.processGain, 'Process gain', 0.1, 10),
    timeConstant: finite(draft.timeConstant, 'Time constant (s)', 0.05, 100),
    proportionalGain: finite(draft.proportionalGain, 'Proportional gain', 0, 20),
    integralGain: finite(draft.integralGain, 'Integral gain (1/s)', 0, 20),
    setpoint: finite(draft.setpoint, 'Setpoint', 0.1, 100),
    duration: finite(draft.duration, 'Duration (s)', 0.1, 500),
    points: finite(draft.points, 'Points', 2, 256),
  }
  if (!Number.isInteger(validated.points)) fail('Points must be an integer in [2, 256]')
  const A = derivedMatrix(validated)
  const B = [[validated.proportionalGain * validated.processGain / validated.timeConstant], [1]]
  if (!Number.isFinite(B[0][0])) fail('derived state-space matrix entries must be finite')
  matrixNormBound(A, B, [validated.setpoint], validated.duration)
  return validated
}

export function createDefaultPidStudy(): PidStudyDraft {
  return {
    processGain: 1,
    timeConstant: 1,
    proportionalGain: 1,
    integralGain: 1,
    setpoint: 1,
    duration: 5,
    points: 51,
  }
}

export function validatePidStudyInput(value: unknown): PidStudyInput {
  const input = record(value, 'PI study input')
  exactKeys(input, INPUT_KEYS, 'PI study input')
  if (input.module !== 'sw-openmodelica-state-space-observers' || input.method !== 'state-space' || input.backend !== 'host') {
    fail('PI study input must select sw-openmodelica-state-space-observers state-space on host')
  }
  const matrix = (raw: unknown, rows: number, columns: number, name: string): number[][] => {
    if (!Array.isArray(raw) || raw.length !== rows) fail(`${name} must have ${rows} rows`)
    return raw.map((rawRow, rowIndex) => {
      if (!Array.isArray(rawRow) || rawRow.length !== columns) fail(`${name}[${rowIndex}] must have ${columns} columns`)
      return rawRow.map((entry, columnIndex) => finite(entry, `${name}[${rowIndex}][${columnIndex}]`, -Number.MAX_VALUE, Number.MAX_VALUE))
    })
  }
  const A = matrix(input.A, 2, 2, 'A') as PidStudyInput['A']
  const B = matrix(input.B, 2, 1, 'B') as PidStudyInput['B']
  const C = matrix(input.C, 1, 2, 'C')
  const D = matrix(input.D, 1, 1, 'D')
  const vector = (raw: unknown, length: number, name: string): number[] => {
    if (!Array.isArray(raw) || raw.length !== length) fail(`${name} must contain ${length} values`)
    return raw.map((entry, index) => finite(entry, `${name}[${index}]`, -Number.MAX_VALUE, Number.MAX_VALUE))
  }
  const x0 = vector(input.x0, 2, 'x0')
  const u = vector(input.u, 1, 'u')
  if (x0[0] !== 0 || x0[1] !== 0) fail('x0 must be [0, 0]')
  if (C[0][0] !== 1 || C[0][1] !== 0 || D[0][0] !== 0) fail('PI study output matrices must be C=[[1, 0]] and D=[[0]]')
  if (!Array.isArray(input.times) || input.times.length < 2 || input.times.length > 256) fail('times must contain 2 to 256 values')
  const times = input.times.map((entry, index) => finite(entry, `times[${index}]`, 0, 500))
  const duration = times[times.length - 1]
  if (times[0] !== 0 || duration < 0.1) fail('times must start at 0 and end at a duration in [0.1, 500] seconds')
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] <= times[index - 1]) fail('times must be strictly increasing')
  }
  matrixNormBound(A, B, u, duration)
  return {
    module: 'sw-openmodelica-state-space-observers', method: 'state-space', backend: 'host',
    A, B, C: [[1, 0]], D: [[0]], x0: [0, 0], u: [u[0]], times,
  }
}

export function createPidStudyJob(draft: PidStudyDraft): { input: PidStudyInput; spec: JobSpecV1 } {
  const valid = validatePidStudyDraft(draft)
  const processGain = valid.processGain
  const input = validatePidStudyInput({
    module: 'sw-openmodelica-state-space-observers', method: 'state-space', backend: 'host',
    A: derivedMatrix(valid),
    B: [[valid.proportionalGain * processGain / valid.timeConstant], [1]],
    C: [[1, 0]], D: [[0]], x0: [0, 0], u: [valid.setpoint],
    times: Array.from({ length: valid.points }, (_, index) => valid.duration * index / (valid.points - 1)),
  })
  return { input, spec: createModuleJobSpec(input as ModuleComputeInput) }
}
