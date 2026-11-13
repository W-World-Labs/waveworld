import type { JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, type ModuleComputeInput, type SwModuleInput } from './module-compute'

export type PemfcStudyDraft = {
  T: number
  pH2: number
  pO2: number
  pH2O: number
  j0: number
  alpha: number
  R: number
  jLim: number
  j: number
  imax: number
  points: number
}

export type PemfcPolarizationInput = SwModuleInput & {
  module: 'sw-comsol-pemfc'
  method: 'polarization'
  backend: 'host'
  n: 2
  E0: 1.229
} & PemfcStudyDraft

const DRAFT_KEYS = ['T', 'pH2', 'pO2', 'pH2O', 'j0', 'alpha', 'R', 'jLim', 'j', 'imax', 'points'] as const
const INPUT_KEYS = ['module', 'method', 'backend', 'n', 'E0', ...DRAFT_KEYS] as const

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
  for (const key of allowed) if (!(key in value) || value[key] === undefined) fail(`${name}.${key} is required`)
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

function validateDraft(value: unknown): PemfcStudyDraft {
  const draft = record(value, 'PEMFC study draft')
  exactKeys(draft, DRAFT_KEYS, 'PEMFC study draft')
  const T = finite(draft.T, 'T (K)', 273.15, 393.15)
  const pH2 = finite(draft.pH2, 'pH2 (atm)', 0.01, 10)
  const pO2 = finite(draft.pO2, 'pO2 (atm)', 0.01, 10)
  const pH2O = finite(draft.pH2O, 'pH2O (atm)', 0.01, 10)
  const j0 = finite(draft.j0, 'j0 (A/cm^2)', 1e-8, 0.1)
  const alpha = finite(draft.alpha, 'alpha', 0.1, 1)
  const R = finite(draft.R, 'R (ohm cm^2)', 0, 5)
  const jLim = finite(draft.jLim, 'jLim (A/cm^2)', 0.01, 10)
  const imax = finite(draft.imax, 'imax (A/cm^2)', 0.001, 10)
  const j = finite(draft.j, 'j (A/cm^2)', 0, imax)
  const points = finite(draft.points, 'points', 2, 201)
  if (!Number.isInteger(points)) fail('points must be an integer')
  if (imax >= jLim) fail('imax must be less than jLim')
  if (j !== 0 && j < j0) fail('j must be zero or at least j0 for the Tafel model')
  if (imax / (points - 1) < j0) fail('the first positive curve sample must be at least j0 for the Tafel model')
  return { T, pH2, pO2, pH2O, j0, alpha, R, jLim, j, imax, points }
}

export function createDefaultPemfcStudy(): PemfcStudyDraft {
  return {
    T: 353.15, pH2: 1, pO2: 0.21, pH2O: 1,
    j0: 1e-4, alpha: 0.5, R: 0.05, jLim: 2,
    j: 0.5, imax: 1, points: 21,
  }
}

export function validatePemfcPolarizationInput(value: unknown): PemfcPolarizationInput {
  const input = record(value, 'PEMFC polarization input')
  exactKeys(input, INPUT_KEYS, 'PEMFC polarization input')
  if (input.module !== 'sw-comsol-pemfc' || input.method !== 'polarization' || input.backend !== 'host' || input.n !== 2 || input.E0 !== 1.229) {
    fail('PEMFC input must select the host polarization method with n=2 and E0=1.229 V')
  }
  return {
    module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host', n: 2, E0: 1.229,
    ...validateDraft(Object.fromEntries(DRAFT_KEYS.map(key => [key, input[key]]))),
  }
}

export function createPemfcStudyJob(draft: PemfcStudyDraft): { input: PemfcPolarizationInput; spec: JobSpecV1 } {
  const validated = validateDraft(draft)
  const input = validatePemfcPolarizationInput({
    module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host', n: 2, E0: 1.229,
    ...validated,
  })
  return { input, spec: createModuleJobSpec(input as ModuleComputeInput) }
}
