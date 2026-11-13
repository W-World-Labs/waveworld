import type { JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, type ModuleComputeInput, type SwModuleInput } from './module-compute'

export type AbaqusBeamStudyDraft = {
  length: number
  elements: number
  section: { E: number; A: number; I: number; nu: number; k: number }
  boundary: 'cantilever'
  load: { type: 'point' | 'udl'; value: number }
}

export type AbaqusBeamStudyInput = SwModuleInput & {
  module: 'sw-calculix-timoshenko-beam'
  backend: 'host'
  element: 'B31'
  length: number
  elements: number
  section: { E: number; A: number; I: number; nu: number; k: number }
  boundary: 'cantilever'
  load: { type: 'point'; value: number; position: number } | { type: 'udl'; value: number }
}

const DRAFT_KEYS = ['length', 'elements', 'section', 'boundary', 'load'] as const
const SECTION_KEYS = ['E', 'A', 'I', 'nu', 'k'] as const
const INPUT_KEYS = ['module', 'backend', 'element', 'length', 'elements', 'section', 'boundary', 'load'] as const

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
  for (const key of allowed) if (!(key in value)) fail(`${name}.${key} is required`)
}

function bounded(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

function validateSection(value: unknown): AbaqusBeamStudyDraft['section'] {
  const section = record(value, 'section')
  exactKeys(section, SECTION_KEYS, 'section')
  const E = bounded(section.E, 'E (Pa)', 1e3, 1e13)
  const A = bounded(section.A, 'A (m²)', 1e-12, 1e4)
  const I = bounded(section.I, 'I (m⁴)', 1e-24, 1e8)
  const nu = bounded(section.nu, 'nu', -0.99, 0.499)
  const k = bounded(section.k, 'k', 1e-6, 1e3)
  return { E, A, I, nu, k }
}

function validateLoad(value: unknown, length: number, isWire: boolean): AbaqusBeamStudyDraft['load'] | AbaqusBeamStudyInput['load'] {
  const load = record(value, 'load')
  if (load.type === 'point') {
    exactKeys(load, isWire ? ['type', 'value', 'position'] : ['type', 'value'], 'load')
    const magnitude = bounded(load.value, 'point load (N)', 1e-12, 1e12)
    if (isWire && bounded(load.position, 'point load position (m)', 1e-6, 1e3) !== length) {
      fail('point load position must equal the beam length (tip load)')
    }
    return isWire ? { type: 'point', value: magnitude, position: length } : { type: 'point', value: magnitude }
  }
  if (load.type === 'udl') {
    exactKeys(load, ['type', 'value'], 'load')
    return { type: 'udl', value: bounded(load.value, 'uniform load (N/m)', 1e-12, 1e12) }
  }
  fail('load.type must be point or udl')
}

export function validateAbaqusBeamStudyDraft(value: unknown): AbaqusBeamStudyDraft {
  const draft = record(value, 'B31 beam study draft')
  exactKeys(draft, DRAFT_KEYS, 'B31 beam study draft')
  const length = bounded(draft.length, 'length (m)', 1e-6, 1e3)
  const elements = bounded(draft.elements, 'elements', 1, 2048)
  if (!Number.isInteger(elements)) fail('elements must be an integer')
  if (draft.boundary !== 'cantilever') fail('boundary must be cantilever')
  return {
    length,
    elements,
    section: validateSection(draft.section),
    boundary: 'cantilever',
    load: validateLoad(draft.load, length, false) as AbaqusBeamStudyDraft['load'],
  }
}

export function createDefaultAbaqusBeamStudy(): AbaqusBeamStudyDraft {
  return {
    length: 1,
    elements: 20,
    section: { E: 210e9, A: 0.005, I: 4.166666666666667e-6, nu: 0.3, k: 5 / 6 },
    boundary: 'cantilever',
    load: { type: 'point', value: 1000 },
  }
}

export function validateAbaqusBeamStudyInput(value: unknown): AbaqusBeamStudyInput {
  const input = record(value, 'B31 beam study input')
  exactKeys(input, INPUT_KEYS, 'B31 beam study input')
  if (input.module !== 'sw-calculix-timoshenko-beam' || input.backend !== 'host' || input.element !== 'B31') {
    fail('input must select sw-calculix-timoshenko-beam, host backend, and B31 element')
  }
  const length = bounded(input.length, 'length (m)', 1e-6, 1e3)
  const elements = bounded(input.elements, 'elements', 1, 2048)
  if (!Number.isInteger(elements)) fail('elements must be an integer')
  if (input.boundary !== 'cantilever') fail('boundary must be cantilever')
  return {
    module: 'sw-calculix-timoshenko-beam', backend: 'host', element: 'B31',
    length, elements, section: validateSection(input.section), boundary: 'cantilever',
    load: validateLoad(input.load, length, true) as AbaqusBeamStudyInput['load'],
  }
}

export function createAbaqusBeamStudyJob(draft: AbaqusBeamStudyDraft): { input: AbaqusBeamStudyInput; spec: JobSpecV1 } {
  const validated = validateAbaqusBeamStudyDraft(draft)
  const input = validateAbaqusBeamStudyInput({
    module: 'sw-calculix-timoshenko-beam', backend: 'host', element: 'B31',
    ...validated,
    load: validated.load.type === 'point'
      ? { ...validated.load, position: validated.length }
      : validated.load,
  })
  return { input, spec: createModuleJobSpec(input as ModuleComputeInput) }
}
