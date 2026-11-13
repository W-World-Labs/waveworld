import type { JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, type ModuleComputeInput, type SwModuleInput } from './module-compute'

type ComsolJouleBaseDraft = {
  sigma0: number
  alpha: number
  T_ref: number
  k: number
  L: number
  area: number
  T_0: number
  T_L: number
  N: number
}

export type ComsolJouleHeatingDraft = ComsolJouleBaseDraft & (
  | { drive: 'current'; current: number; voltage?: never }
  | { drive: 'voltage'; voltage: number; current?: never }
)

export type ComsolJouleHeatingInput = SwModuleInput & {
  module: 'sw-comsol-joule-heating-b'
  methodId: 'method-algo-comsol-joule-heating-1d-coupled'
  backend: 'host'
  mode: 'joule'
  current?: number
  voltage?: number
  sigma0: number
  alpha: number
  T_ref: number
  k: number
  L: number
  area: number
  T_0: number
  T_L: number
  N: number
}

const DRAFT_BASE_KEYS = ['sigma0', 'alpha', 'T_ref', 'k', 'L', 'area', 'T_0', 'T_L', 'N'] as const
const INPUT_KEYS = ['module', 'methodId', 'backend', 'mode', 'current', 'voltage', ...DRAFT_BASE_KEYS] as const

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
  for (const key of allowed) if (!(key in value)) fail(`${name}.${key} is required`)
}

function finiteIn(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

function positive(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    fail(`${name} must be finite, > 0, and <= ${max}`)
  }
  return value
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${name} must be an integer in [${min}, ${max}]`)
  }
  return value
}

function validateBase(source: Record<string, unknown>): ComsolJouleBaseDraft {
  return {
    sigma0: positive(source.sigma0, 'Electrical conductivity sigma0 (S/m)', 1e9),
    alpha: finiteIn(source.alpha, 'Temperature coefficient alpha (1/K)', 0, 1),
    T_ref: positive(source.T_ref, 'Reference temperature T_ref (K)', 1e5),
    k: positive(source.k, 'Thermal conductivity k (W/(m·K))', 1e6),
    L: positive(source.L, 'Conductor length L (m)', 1e4),
    area: positive(source.area, 'Conductor cross-sectional area (m²)', 100),
    T_0: positive(source.T_0, 'Left boundary temperature T_0 (K)', 1e5),
    T_L: positive(source.T_L, 'Right boundary temperature T_L (K)', 1e5),
    N: integer(source.N, 'Profile sample count N', 2, 4096),
  }
}

function validateDraft(value: unknown): ComsolJouleHeatingDraft {
  const draft = record(value, 'Joule heating study')
  if (draft.drive === 'current') {
    exactKeys(draft, ['drive', 'current', ...DRAFT_BASE_KEYS], 'Joule heating study')
    return { drive: 'current', current: finiteIn(draft.current, 'Current (A)', 0, 1e6), ...validateBase(draft) }
  }
  if (draft.drive === 'voltage') {
    exactKeys(draft, ['drive', 'voltage', ...DRAFT_BASE_KEYS], 'Joule heating study')
    return { drive: 'voltage', voltage: finiteIn(draft.voltage, 'Voltage (V)', 0, 1e6), ...validateBase(draft) }
  }
  fail('Joule heating drive must be current or voltage')
}

export function createDefaultComsolJouleHeating(): ComsolJouleHeatingDraft {
  return {
    drive: 'current', current: 10, sigma0: 5.8e7, alpha: 0.0039,
    T_ref: 293.15, k: 400, L: 0.05, area: 1e-6, T_0: 293.15, T_L: 293.15, N: 5,
  }
}

export function validateComsolJouleHeatingInput(value: unknown): ComsolJouleHeatingInput {
  const input = record(value, 'Joule heating native input')
  for (const key of Object.keys(input)) if (!INPUT_KEYS.includes(key as typeof INPUT_KEYS[number])) {
    fail(`Joule heating native input has unsupported field ${key}`)
  }
  for (const key of ['module', 'methodId', 'backend', 'mode', ...DRAFT_BASE_KEYS]) {
    if (!(key in input)) fail(`Joule heating native input.${key} is required`)
  }
  if (input.module !== 'sw-comsol-joule-heating-b' || input.methodId !== 'method-algo-comsol-joule-heating-1d-coupled' || input.backend !== 'host' || input.mode !== 'joule') {
    fail('Joule heating input must select the admitted host DC method-algo-comsol-joule-heating-1d-coupled operation')
  }
  const hasCurrent = 'current' in input
  const hasVoltage = 'voltage' in input
  if (hasCurrent === hasVoltage) fail('Joule heating input requires exactly one of current or voltage')
  const base = validateBase(input)
  const drive = hasCurrent
    ? { current: finiteIn(input.current, 'Current (A)', 0, 1e6) }
    : { voltage: finiteIn(input.voltage, 'Voltage (V)', 0, 1e6) }
  return {
    module: 'sw-comsol-joule-heating-b', methodId: 'method-algo-comsol-joule-heating-1d-coupled',
    backend: 'host', mode: 'joule', ...drive, ...base,
  }
}

export function createComsolJouleHeatingJob(draft: ComsolJouleHeatingDraft): { input: ComsolJouleHeatingInput; spec: JobSpecV1 } {
  const saved = validateDraft(draft)
  const drive = saved.drive === 'current' ? { current: saved.current } : { voltage: saved.voltage }
  const input = validateComsolJouleHeatingInput({
    module: 'sw-comsol-joule-heating-b', methodId: 'method-algo-comsol-joule-heating-1d-coupled',
    backend: 'host', mode: 'joule', ...drive,
    sigma0: saved.sigma0, alpha: saved.alpha, T_ref: saved.T_ref, k: saved.k, L: saved.L,
    area: saved.area, T_0: saved.T_0, T_L: saved.T_L, N: saved.N,
  })
  return { input, spec: createModuleJobSpec(input as ModuleComputeInput) }
}

export function comsolJouleHeatingDraft(input: ComsolJouleHeatingInput): ComsolJouleHeatingDraft {
  const base = {
    sigma0: input.sigma0, alpha: input.alpha, T_ref: input.T_ref, k: input.k, L: input.L,
    area: input.area, T_0: input.T_0, T_L: input.T_L, N: input.N,
  }
  return 'current' in input
    ? { drive: 'current', current: input.current!, ...base }
    : { drive: 'voltage', voltage: input.voltage!, ...base }
}
