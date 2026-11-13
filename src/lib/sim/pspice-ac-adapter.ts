import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import {
  createModuleJobSpec,
  readModuleJobInput,
  readModuleResult,
  type ModuleComputeInput,
} from './module-compute'

export const PSPICE_AC_MIN_FREQUENCY_HZ = 1e-6
export const PSPICE_AC_MAX_FREQUENCY_HZ = 1e12

export type PspiceAcCircuit = {
  nodes: number
  resistors: Array<{ a: number; b: number; r: number }>
  capacitors: Array<{ a: number; b: number; c: number }>
  inductors: Array<{ a: number; b: number; l: number }>
  vSources: Array<{ a: number; b: number; v: number }>
  iSources: Array<{ a: number; b: number; i: number }>
  /** Empty for this linear adapter; nonlinear diode branches are unsupported. */
  diodes?: []
}

export type PspiceAcStudyInput = {
  frequencyHz: number
  circuit: PspiceAcCircuit
  /** Labels for nodes 1..nodes, in index order; ground is implicitly named "0". */
  nodeLabels: string[]
}

export type MnaAcInput = {
  module: 'mna'
  method: 'method-algo-mna-ac'
  backend: 'host'
  omega: number
  circuit: PspiceAcCircuit
}

export type PspiceAcInput = MnaAcInput

export type PspiceAcResult = {
  frequencyHz: number
  omega: number
  nodePhasors: Record<string, { magnitude: number; phaseRad: number; phaseDeg: number }>
  methodId: 'method-algo-mna-ac'
  familyId: 'method-mna'
  backend: Record<string, unknown>
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} contains unsupported field '${key}'`)
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]))
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = Object.keys(left as Record<string, unknown>).sort()
    const b = Object.keys(right as Record<string, unknown>).sort()
    return a.length === b.length && a.every((key, index) => key === b[index]
      && sameJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
  }
  return false
}

/** Validate and normalize a direct native linear MNA AC input. */
export function validatePspiceAcInput(value: unknown): PspiceAcInput {
  const input = object(value, 'PSpice AC input')
  exactKeys(input, ['module', 'method', 'backend', 'omega', 'circuit'], 'PSpice AC input')
  if (input.module !== 'mna' || input.method !== 'method-algo-mna-ac' || input.backend !== 'host') {
    throw new Error('PSpice AC input must select the native host MNA AC method')
  }
  if (typeof input.omega !== 'number' || !Number.isFinite(input.omega) || input.omega <= 0) {
    throw new Error('PSpice AC omega must be positive and finite')
  }

  const rawCircuit = object(input.circuit, 'PSpice AC circuit')
  exactKeys(rawCircuit, ['nodes', 'resistors', 'capacitors', 'inductors', 'vSources', 'iSources', 'diodes'], 'PSpice AC circuit')
  if (rawCircuit.diodes !== undefined && (!Array.isArray(rawCircuit.diodes) || rawCircuit.diodes.length !== 0)) {
    throw new Error('PSpice AC circuit.diodes must be empty; nonlinear diodes are unsupported')
  }
  if (!Number.isInteger(rawCircuit.nodes) || (rawCircuit.nodes as number) < 1 || (rawCircuit.nodes as number) > 64) {
    throw new Error('PSpice AC circuit.nodes must be an integer from 1 to 64')
  }
  const nodes = rawCircuit.nodes as number
  let elementCount = 0
  const elements = <K extends 'resistors' | 'capacitors' | 'inductors' | 'vSources' | 'iSources'>(
    key: K,
    valueKey: 'r' | 'c' | 'l' | 'v' | 'i',
    positive: boolean,
  ): NonNullable<PspiceAcCircuit[K]> => {
    const raw = rawCircuit[key]
    if (raw === undefined) throw new Error(`PSpice AC circuit.${key} is required`)
    if (!Array.isArray(raw)) throw new Error(`PSpice AC circuit.${key} must be an array`)
    elementCount += raw.length
    if (elementCount > 512) throw new Error('PSpice AC circuit supports at most 512 total elements')
    return raw.map((entry, index) => {
      const label = `PSpice AC circuit.${key}[${index}]`
      const element = object(entry, label)
      exactKeys(element, ['a', 'b', valueKey], label)
      for (const endpoint of ['a', 'b']) {
        const node = element[endpoint]
        if (!Number.isInteger(node) || (node as number) < 0 || (node as number) > nodes) {
          throw new Error(`${label}.${endpoint} must be an integer node from 0 to ${nodes}`)
        }
      }
      const amount = element[valueKey]
      if (typeof amount !== 'number' || !Number.isFinite(amount)
          || (positive ? amount <= 0 : Math.abs(amount) > 1e20)) {
        throw new Error(`${label}.${valueKey} must be finite${positive ? ' and positive' : ' with magnitude at most 1e20'}`)
      }
      return { a: element.a as number, b: element.b as number, [valueKey]: amount }
    }) as NonNullable<PspiceAcCircuit[K]>
  }
  return {
    module: 'mna', method: 'method-algo-mna-ac', backend: 'host', omega: input.omega,
    circuit: {
      nodes,
      resistors: elements('resistors', 'r', true),
      capacitors: elements('capacitors', 'c', true),
      inductors: elements('inductors', 'l', true),
      vSources: elements('vSources', 'v', false),
      iSources: elements('iSources', 'i', false),
      ...(rawCircuit.diodes !== undefined ? { diodes: [] } : {}),
    },
  }
}

/** Convert the guided UI frequency in Hz to a one-step native MNA AC job. */
export function createPspiceAcJob(input: PspiceAcStudyInput): { input: MnaAcInput; spec: JobSpecV1; nodeMap: Record<string, number> } {
  const study = object(input, 'PSpice AC study')
  exactKeys(study, ['frequencyHz', 'circuit', 'nodeLabels'], 'PSpice AC study')
  if (!Number.isFinite(input.frequencyHz)
      || input.frequencyHz < PSPICE_AC_MIN_FREQUENCY_HZ
      || input.frequencyHz > PSPICE_AC_MAX_FREQUENCY_HZ) {
    throw new Error(`PSpice AC frequency must be in [${PSPICE_AC_MIN_FREQUENCY_HZ}, ${PSPICE_AC_MAX_FREQUENCY_HZ}] Hz`)
  }
  const normalizedInput = validatePspiceAcInput({
    module: 'mna', method: 'method-algo-mna-ac', backend: 'host',
    omega: 2 * Math.PI * input.frequencyHz, circuit: input.circuit,
  })
  if (!Array.isArray(input.nodeLabels) || input.nodeLabels.length !== normalizedInput.circuit.nodes) {
    throw new Error('PSpice AC nodeLabels must provide one label for each node 1..nodes')
  }
  const nodeMap: Record<string, number> = { '0': 0 }
  input.nodeLabels.forEach((label, index) => {
    if (typeof label !== 'string' || !label.trim() || label !== label.trim()
        || label === '0' || Object.prototype.hasOwnProperty.call(nodeMap, label)) {
      throw new Error(`PSpice AC node label ${index + 1} must be non-empty and unique`)
    }
    nodeMap[label] = index + 1
  })
  const normalized = normalizedInput
  const spec = createModuleJobSpec(normalized as unknown as ModuleComputeInput)
  spec.run.maxSteps = 1
  const roundTrip = readModuleJobInput(spec)
  if (!sameJson(roundTrip, normalized)) throw new Error('PSpice AC JobSpec does not round-trip the normalized MNA input')
  return { input: normalized, spec, nodeMap }
}

/** Verify the native phasor response and restore caller node labels. */
export function readPspiceAcResult(
  result: JobResultV1,
  submittedInput: PspiceAcInput,
  submittedNodeMap: Record<string, number>,
): PspiceAcResult {
  if (submittedInput.module !== 'mna' || submittedInput.method !== 'method-algo-mna-ac' || submittedInput.backend !== 'host') {
    throw new Error('submitted MNA job is not the requested host AC method')
  }
  const normalized = validatePspiceAcInput(submittedInput)
  const output = object(readModuleResult(result, normalized as unknown as ModuleComputeInput), 'PSpice AC module result')
  if (output.module !== 'mna') throw new Error('PSpice AC result module does not match the submitted job')
  const backend = object(output.backend, 'PSpice AC backend')
  if (typeof backend.id !== 'string' || !backend.id.startsWith('host-f64')) {
    throw new Error('PSpice AC result must report native host-f64 backend provenance')
  }
  const payload = object(output.result, 'PSpice AC result payload')
  if (payload.methodId !== normalized.method || payload.familyId !== 'method-mna') {
    throw new Error('PSpice AC result method or family does not match the submitted job')
  }
  if (payload.omega !== normalized.omega) throw new Error('PSpice AC result omega does not match the submitted frequency')
  const fields = [payload.nodeMagnitudes, payload.nodePhases, payload.nodePhasesDeg]
  if (fields.some(field => !Array.isArray(field) || field.length !== normalized.circuit.nodes)) {
    throw new Error('PSpice AC result dimensions do not match the submitted circuit')
  }
  const magnitudes = payload.nodeMagnitudes as unknown[]
  const phases = payload.nodePhases as unknown[]
  const phasesDeg = payload.nodePhasesDeg as unknown[]
  const values = magnitudes.map((magnitude, index) => {
    const phase = phases[index], phaseDeg = phasesDeg[index]
    if ([magnitude, phase, phaseDeg].some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`PSpice AC phasor ${index + 1} contains a non-finite value`)
    }
    return { magnitude: magnitude as number, phase: phase as number, phaseDeg: phaseDeg as number }
  })
  if (submittedNodeMap['0'] !== 0) throw new Error('submitted node map must map ground "0" to node 0')
  const mapEntries = Object.entries(submittedNodeMap)
  if (mapEntries.length !== normalized.circuit.nodes + 1) {
    throw new Error('submitted node map must label every native circuit node exactly once')
  }
  const mappedIndices = new Set<number>()
  const nodePhasors = Object.fromEntries(mapEntries.map(([name, index]) => {
    if (!name || !Number.isInteger(index) || index < 0 || index > normalized.circuit.nodes) {
      throw new Error(`submitted node index for '${name}' is invalid`)
    }
    if (mappedIndices.has(index)) throw new Error(`submitted node index ${index} is mapped more than once`)
    mappedIndices.add(index)
    const value = index === 0 ? { magnitude: 0, phase: 0, phaseDeg: 0 } : values[index - 1]
    return [name, { magnitude: value.magnitude, phaseRad: value.phase, phaseDeg: value.phaseDeg }]
  }))
  return {
    frequencyHz: normalized.omega / (2 * Math.PI), omega: normalized.omega, nodePhasors,
    methodId: 'method-algo-mna-ac', familyId: 'method-mna', backend,
  }
}
