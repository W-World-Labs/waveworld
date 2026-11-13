import type { JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, type ModuleComputeInput, type SwModuleInput } from './module-compute'
import { createExchangerUaValues, type ExchangerSweepRange } from './exchanger-sweep-range'

export type ExchangerStudyDraft = {
  arrangement: 'counterflow' | 'parallel'
  Chot: number
  Ccold: number
  T_hot_in: number
  T_cold_in: number
  range: ExchangerSweepRange
}

export type ExchangerSweepInput = SwModuleInput & {
  module: 'sw-openmodelica-heat-exchanger'
  backend: 'host'
  dynamic: false
  arrangement: 'counterflow' | 'parallel'
  Chot: number
  Ccold: number
  T_hot_in: number
  T_cold_in: number
  sweep_UA: number[]
}

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
  for (const key of allowed) if (!(key in value)) fail(`${name}.${key} is required`)
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

function validatePhysicalValues(ChotValue: unknown, CcoldValue: unknown, hotValue: unknown, coldValue: unknown) {
  const Chot = finite(ChotValue, 'Chot (W/K)', 1e-6, 1e9)
  const Ccold = finite(CcoldValue, 'Ccold (W/K)', 1e-6, 1e9)
  const T_hot_in = finite(hotValue, 'T_hot_in (K)', 1, 2000)
  const T_cold_in = finite(coldValue, 'T_cold_in (K)', 1, 2000)
  if (T_hot_in < T_cold_in) fail('T_hot_in must be greater than or equal to T_cold_in')
  const ratio = Math.min(Chot, Ccold) / Math.max(Chot, Ccold)
  if (ratio < 1e-6) fail('min(Chot, Ccold) / max(Chot, Ccold) must be at least 1e-6')
  return { Chot, Ccold, T_hot_in, T_cold_in }
}

function validateSweep(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 64) fail('sweep_UA must contain 2 to 64 values')
  const sweep = value.map((item, index) => finite(item, `sweep_UA[${index}]`, 1e-6, 1e9))
  for (let index = 1; index < sweep.length; index += 1) {
    if (sweep[index] <= sweep[index - 1]) fail('sweep_UA must be strictly increasing')
  }
  return sweep
}

function validateDraft(value: unknown): ExchangerStudyDraft {
  const draft = record(value, 'Exchanger study draft')
  exactKeys(draft, ['arrangement', 'Chot', 'Ccold', 'T_hot_in', 'T_cold_in', 'range'], 'Exchanger study draft')
  if (draft.arrangement !== 'counterflow' && draft.arrangement !== 'parallel') fail('arrangement must be counterflow or parallel')
  const physical = validatePhysicalValues(draft.Chot, draft.Ccold, draft.T_hot_in, draft.T_cold_in)
  createExchangerUaValues(draft.range as ExchangerSweepRange)
  return { arrangement: draft.arrangement, ...physical, range: draft.range as ExchangerSweepRange }
}

export function createDefaultExchangerStudy(): ExchangerStudyDraft {
  return {
    arrangement: 'counterflow', Chot: 100, Ccold: 100,
    T_hot_in: 363.15, T_cold_in: 293.15,
    range: { start: 100, end: 300, points: 3, spacing: 'linear' },
  }
}

export function validateExchangerSweepInput(input: unknown): ExchangerSweepInput {
  const value = record(input, 'Exchanger sweep input')
  exactKeys(value, ['module', 'backend', 'dynamic', 'arrangement', 'Chot', 'Ccold', 'T_hot_in', 'T_cold_in', 'sweep_UA'], 'Exchanger sweep input')
  if (value.module !== 'sw-openmodelica-heat-exchanger' || value.backend !== 'host' || value.dynamic !== false) {
    fail('Exchanger sweep input must select the host steady exchanger module')
  }
  if (value.arrangement !== 'counterflow' && value.arrangement !== 'parallel') fail('arrangement must be counterflow or parallel')
  const physical = validatePhysicalValues(value.Chot, value.Ccold, value.T_hot_in, value.T_cold_in)
  const sweep_UA = validateSweep(value.sweep_UA)
  const Cmin = Math.min(physical.Chot, physical.Ccold)
  if (sweep_UA.some(UA => UA / Cmin < 1e-6 || UA / Cmin > 1e6)) fail('every UA / min(Chot, Ccold) must be in [1e-6, 1e6]')
  return {
    module: 'sw-openmodelica-heat-exchanger', backend: 'host', dynamic: false,
    arrangement: value.arrangement, ...physical, sweep_UA,
  }
}

export function createExchangerStudyJob(draft: ExchangerStudyDraft): { input: ExchangerSweepInput; spec: JobSpecV1 } {
  const validated = validateDraft(draft)
  const input = validateExchangerSweepInput({
    module: 'sw-openmodelica-heat-exchanger', backend: 'host', dynamic: false,
    arrangement: validated.arrangement, Chot: validated.Chot, Ccold: validated.Ccold,
    T_hot_in: validated.T_hot_in, T_cold_in: validated.T_cold_in,
    sweep_UA: createExchangerUaValues(validated.range),
  })
  return { input, spec: createModuleJobSpec(input as ModuleComputeInput) }
}
