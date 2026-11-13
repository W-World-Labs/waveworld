import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import {
  createModuleJobSpec,
  readModuleJobInput,
  readModuleResult,
  type ModuleComputeInput,
} from './module-compute'
import type { MnaImport } from './spice-import-adapter'

export type MnaTransientInput = {
  module: 'mna'
  method: 'method-algo-mna-transient-be'
  backend: 'host'
  circuit: Record<string, unknown>
  dt: number
  steps: number
  outputNode: number
  initial?: MnaTransientInitial
}

export type MnaTransientInitial = {
  nodeVoltages?: number[]
  capacitorCurrents?: number[]
  inductorCurrents?: number[]
}

export type SpiceTransientInitialState = {
  nodeVoltages?: Record<string, number>
  inductorCurrents?: Record<string, number>
}

export type SpiceTransientInitialOptions = {
  nodeNames: string[]
  inductorNames: string[]
}

export type SpiceTransientResult = {
  methodId: 'method-algo-mna-transient-be'
  familyId: 'method-mna'
  scheme: 'be'
  dt: number
  steps: number
  outputNode: number
  nodeName: string
  initial: MnaTransientInitial | null
  samples: Array<{ time: number; value: number }>
  finalNodeVoltages: Record<string, number>
  finalCapacitorCurrents: number[]
  finalInductorCurrents: number[]
  finalOutput: number
  newtonIterations: number
  converged: true
  backend: Record<string, unknown>
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} contains unsupported field '${key}'`)
}

function namedElements(netlist: string): { inductors: string[] } {
  const inductors: string[] = []
  const seenInductors = new Set<string>()
  let titleSeen = false
  for (const raw of netlist.split(/\r?\n/)) {
    const line = raw.split('$', 1)[0].trim()
    if (!line || line.startsWith('*')) continue
    if (!titleSeen) { titleSeen = true; continue }
    if (line.startsWith('+') || line.startsWith('.')) continue
    const match = line.match(/^([A-Za-z][^\s]*)\s+/)
    if (!match) continue
    const name = match[1]
    const kind = name[0].toLowerCase()
    if (kind === 'l') {
      const normalized = name.toLowerCase()
      if (seenInductors.has(normalized)) throw new Error(`SPICE inductor name '${name}' is duplicated`)
      seenInductors.add(normalized)
      inductors.push(name)
    }
  }
  return { inductors }
}

/** Return the names available for explicit initial state entry on a supported deck. */
export function getSpiceTransientInitialOptions(
  netlist: string,
  imported: MnaImport,
): SpiceTransientInitialOptions {
  const input = validateImport(imported)
  if (!validateNetlist(netlist, input.dt, input.steps)) throw new Error('SPICE deck is not an eligible fixed-step transient input')
  const nodeMap = object(imported.nodeMap, 'SPICE importer node map')
  const nodeEntries = Object.entries(nodeMap)
  if (nodeEntries.length !== (input.circuit.nodes as number) + 1 || nodeMap['0'] !== 0) {
    throw new Error('SPICE importer node map must label ground and every circuit node exactly once')
  }
  const seenNodes = new Set<number>()
  for (const [name, index] of nodeEntries) {
    if (!name || !Number.isInteger(index) || (index as number) < 0 || (index as number) > (input.circuit.nodes as number) || seenNodes.has(index as number)) {
      throw new Error(`SPICE importer node index for '${name}' is invalid or duplicated`)
    }
    seenNodes.add(index as number)
  }
  const nodeNames = nodeEntries
    .filter(([name, index]) => name !== '0' && Number.isInteger(index))
    .sort((a, b) => (a[1] as number) - (b[1] as number))
    .map(([name]) => name)
  const names = namedElements(netlist)
  const circuit = object(input.circuit, 'MNA transient circuit')
  const inductors = Array.isArray(circuit.inductors) ? circuit.inductors.length : 0
  if (names.inductors.length !== inductors) {
    throw new Error('SPICE inductor card order does not match the imported MNA circuit')
  }
  return { nodeNames, inductorNames: names.inductors }
}

function normalizeInitialState(
  value: SpiceTransientInitialState | undefined,
  options: SpiceTransientInitialOptions,
): MnaTransientInitial | undefined {
  if (value === undefined) return undefined
  const state = object(value, 'SPICE transient initial state')
  exactKeys(state, ['nodeVoltages', 'inductorCurrents'], 'SPICE transient initial state')
  const normalize = (raw: unknown, names: string[], label: string): number[] | undefined => {
    if (raw === undefined) return undefined
    const values = object(raw, label)
    for (const name of Object.keys(values)) {
      if (!names.includes(name)) throw new Error(`${label} contains unknown name '${name}'`)
      const amount = values[name]
      if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > 1e20) {
        throw new Error(`${label}.${name} must be finite with magnitude at most 1e20`)
      }
    }
    if (Object.keys(values).length === 0) return undefined
    return names.map(name => (values[name] as number | undefined) ?? 0)
  }
  const nodeVoltages = normalize(state.nodeVoltages, options.nodeNames, 'initial nodeVoltages')
  const inductorCurrents = normalize(state.inductorCurrents, options.inductorNames, 'initial inductorCurrents')
  // The simulator's initial state is a complete state vector. Once the user
  // supplies any named value, unspecified nodes/elements retain the model's
  // zero-state default explicitly so the submitted job is deterministic.
  const anyInitialValues = Boolean(nodeVoltages || inductorCurrents)
  const initial: MnaTransientInitial = {
    ...(anyInitialValues ? { nodeVoltages: nodeVoltages ?? options.nodeNames.map(() => 0) } : {}),
    ...(anyInitialValues ? { inductorCurrents: inductorCurrents ?? options.inductorNames.map(() => 0) } : {}),
  }
  return Object.keys(initial).length > 0 ? initial : undefined
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

function spiceNumber(token: string): number | null {
  const match = token.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|[tgkmunpf])?$/i)
  if (!match) return null
  const scale = (match[2] ?? '').toLowerCase()
  const factor = scale === 'meg' ? 1e6
    : scale === 't' ? 1e12
      : scale === 'g' ? 1e9
        : scale === 'k' ? 1e3
          : scale === 'm' ? 1e-3
            : scale === 'u' ? 1e-6
              : scale === 'n' ? 1e-9
                : scale === 'p' ? 1e-12
                  : scale === 'f' ? 1e-15 : 1
  const value = Number(match[1]) * factor
  return Number.isFinite(value) ? value : null
}

function validateNetlist(netlist: string, dt: number, steps: number): boolean {
  if (typeof netlist !== 'string' || !netlist.trim()) return false
  const lines = netlist.split(/\r?\n/)
  let titleSeen = false
  let tranCount = 0
  let reactiveCardSeen = false
  for (const raw of lines) {
    const line = raw.split('$', 1)[0].trim()
    if (!line || line.startsWith('*')) continue
    if (!titleSeen) {
      titleSeen = true
      continue
    }
    if (line.startsWith('+')) return false
    if (/^[cl]\S*\s/i.test(line)) reactiveCardSeen = true
    if (line.startsWith('.')) {
      const directive = line.match(/^\.([a-z]+)\b(.*)$/i)
      if (!directive) return false
      const name = directive[1].toLowerCase()
      if (name === 'end' || name === 'title') continue
      if (name !== 'tran') return false
      tranCount += 1
      const args = directive[2].trim().split(/\s+/).filter(Boolean)
      if (tranCount !== 1 || args.length !== 2 || /\buic\b/i.test(directive[2])) return false
      const importedStep = spiceNumber(args[0])
      const importedStop = spiceNumber(args[1])
      const expectedStop = dt * steps
      if (!Number.isFinite(expectedStop) || importedStep === null || importedStop === null) return false
      const matches = (actual: number, expected: number) =>
        Math.abs(actual - expected) <= 1e-9 * Math.max(Math.abs(actual), Math.abs(expected), Number.MIN_VALUE)
      if (!matches(importedStep, dt) || !matches(importedStop, expectedStop)) return false
      continue
    }
    if (/^[vi]\S*\s/i.test(line)) {
      if (/\b(?:ac|pulse|sin|sine|exp|pwl|puls|sffm|am|fm)\b/i.test(line) || /[()]/.test(line)) return false
    }
    // Initial conditions and simulator control statements are not device lines.
    if (/^(?:\.ic|\.nodeset|\.uic|uic)\b/i.test(line)) return false
  }
  return titleSeen && tranCount === 1 && reactiveCardSeen
}

function validateImport(imported: MnaImport): MnaTransientInput {
  const rawInput = object(imported.mnaInput, 'MNA transient input')
  exactKeys(rawInput, ['module', 'method', 'circuit', 'dt', 'steps', 'initial'], 'MNA transient input')
  if (rawInput.module !== 'mna' || rawInput.method !== 'method-algo-mna-transient-be') {
    throw new Error('SPICE import is not a backward-Euler transient analysis')
  }
  const dt = rawInput.dt
  const steps = rawInput.steps
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) throw new Error('MNA transient dt must be positive and finite')
  if (!Number.isInteger(steps) || (steps as number) < 1 || (steps as number) > 2000) {
    throw new Error('MNA transient steps must be an integer from 1 to 2000')
  }
  const circuit = object(rawInput.circuit, 'MNA transient circuit')
  exactKeys(circuit, ['nodes', 'resistors', 'capacitors', 'inductors', 'vSources', 'iSources', 'diodes'], 'MNA transient circuit')
  if (!Number.isInteger(circuit.nodes) || (circuit.nodes as number) < 1 || (circuit.nodes as number) > 64) {
    throw new Error('MNA transient circuit.nodes must be an integer from 1 to 64')
  }
  const nodeCount = circuit.nodes as number
  let total = 0
  const count = (key: string, valueKey: string, positive: boolean) => {
    const entries = circuit[key]
    if (entries === undefined) return 0
    if (!Array.isArray(entries)) throw new Error(`MNA transient circuit.${key} must be an array`)
    total += entries.length
    if (total > 512) throw new Error('MNA transient circuit supports at most 512 elements')
    for (const [index, raw] of entries.entries()) {
      const label = `MNA transient circuit.${key}[${index}]`
      const element = object(raw, label)
      exactKeys(element, ['a', 'b', valueKey], label)
      for (const endpoint of ['a', 'b']) {
        if (!Number.isInteger(element[endpoint]) || (element[endpoint] as number) < 0 || (element[endpoint] as number) > nodeCount) {
          throw new Error(`${label}.${endpoint} is outside the circuit node range`)
        }
      }
      const amount = element[valueKey]
      if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > 1e20 || (positive && amount <= 0)) {
        throw new Error(`${label}.${valueKey} must be finite${positive ? ' and positive' : ''}`)
      }
    }
    return entries.length
  }
  count('resistors', 'r', true)
  const capacitorCount = count('capacitors', 'c', true)
  const inductorCount = count('inductors', 'l', true)
  const voltageCount = count('vSources', 'v', false)
  const currentCount = count('iSources', 'i', false)
  if (capacitorCount + inductorCount === 0) throw new Error('MNA transient circuit requires at least one capacitor or inductor')
  if (voltageCount + currentCount === 0) throw new Error('MNA transient circuit requires an independent constant source')
  if (circuit.diodes !== undefined && (!Array.isArray(circuit.diodes) || circuit.diodes.length !== 0)) {
    throw new Error('MNA transient circuit.diodes must be empty')
  }
  let initial: MnaTransientInitial | undefined
  if (rawInput.initial !== undefined && rawInput.initial !== null) {
    const rawInitial = object(rawInput.initial, 'MNA transient initial state')
    exactKeys(rawInitial, ['nodeVoltages', 'capacitorCurrents', 'inductorCurrents'], 'MNA transient initial state')
    const initialArray = (key: keyof MnaTransientInitial, expected: number): number[] | undefined => {
      const raw = rawInitial[key]
      if (raw === undefined) return undefined
      if (!Array.isArray(raw) || raw.length !== expected) throw new Error(`MNA transient initial.${key} must have length ${expected}`)
      return raw.map((value, index) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e20) {
          throw new Error(`MNA transient initial.${key}[${index}] must be finite with magnitude at most 1e20`)
        }
        return value
      })
    }
    const nodeVoltages = initialArray('nodeVoltages', nodeCount)
    const capacitorCurrents = initialArray('capacitorCurrents', capacitorCount)
    const inductorCurrents = initialArray('inductorCurrents', inductorCount)
    initial = {
      ...(nodeVoltages ? { nodeVoltages } : {}),
      ...(capacitorCurrents ? { capacitorCurrents } : {}),
      ...(inductorCurrents ? { inductorCurrents } : {}),
    }
    if (Object.keys(initial).length === 0) initial = undefined
    if (initial?.capacitorCurrents?.some(value => value !== 0)) {
      throw new Error('MNA backward-Euler does not use initial capacitor currents')
    }
  }
  const nodeMap = object(imported.nodeMap, 'SPICE importer node map')
  if (nodeMap['0'] !== 0) throw new Error('SPICE importer node map must map ground "0" to node 0')
  for (const [name, index] of Object.entries(nodeMap)) {
    if (!name || !Number.isInteger(index) || (index as number) < 0 || (index as number) > nodeCount) {
      throw new Error(`MNA node index for '${name}' is invalid`)
    }
  }
  const spec = object(imported.mnaJobSpec, 'MNA JobSpec')
  const model = object(spec.model, 'MNA JobSpec model')
  const inline = object(model.inline, 'MNA JobSpec model.inline')
  const inlineInput = { ...inline }
  const inlineBackend = inlineInput.backend
  delete inlineInput.backend
  if (spec.schemaVersion !== 1 || spec.kind !== 'waveworld-module' || model.source !== 'inline'
      || object(spec.parameters, 'MNA JobSpec parameters').module !== 'mna'
      || (inlineBackend !== undefined && inlineBackend !== 'host') || !sameJson(inlineInput, rawInput)
      || object(spec.run, 'MNA JobSpec run').maxSteps !== steps) {
    throw new Error('MNA JobSpec does not exactly match the imported transient method, circuit, and time grid')
  }
  return {
    module: 'mna', method: 'method-algo-mna-transient-be', backend: 'host',
    circuit, dt, steps: steps as number, outputNode: 1,
    ...(initial ? { initial } : {}),
  }
}

/** Admit fixed-step RLC decks with constant independent sources and no .ic/UIC cards. */
export function supportsSpiceTransient(netlist: string, imported: MnaImport): boolean {
  try {
    const input = validateImport(imported)
    const circuit = object(input.circuit, 'MNA transient circuit')
    const hasReactiveElement = (Array.isArray(circuit.capacitors) && circuit.capacitors.length > 0)
      || (Array.isArray(circuit.inductors) && circuit.inductors.length > 0)
    return hasReactiveElement && validateNetlist(netlist, input.dt, input.steps)
  } catch {
    return false
  }
}

/** Create the native backward-Euler MNA job while preserving the imported circuit and grid. */
export function createSpiceTransientJob(
  imported: MnaImport,
  outputNode: number,
  netlist: string,
  initialState?: SpiceTransientInitialState,
): { input: MnaTransientInput; spec: JobSpecV1 } {
  const validated = validateImport(imported)
  if (!Number.isInteger(outputNode) || outputNode < 1 || outputNode > (validated.circuit.nodes as number)) {
    throw new Error(`MNA transient outputNode must be in 1..=${validated.circuit.nodes as number}`)
  }
  const options = getSpiceTransientInitialOptions(netlist, imported)
  const initial = normalizeInitialState(initialState, options)
  const input: MnaTransientInput = { ...validated, outputNode, ...(initial ? { initial } : {}) }
  const spec = createModuleJobSpec(input as unknown as ModuleComputeInput)
  if (!sameJson(readModuleJobInput(spec), input)) throw new Error('MNA transient JobSpec does not round-trip the submitted input')
  return { input, spec }
}

/** Validate native solver provenance, time grid, dimensions, and restore imported node names. */
export function readSpiceTransientResult(
  result: JobResultV1,
  submittedInput: MnaTransientInput,
  submittedNodeMap: Record<string, number>,
): SpiceTransientResult {
  if (submittedInput.module !== 'mna' || submittedInput.method !== 'method-algo-mna-transient-be' || submittedInput.backend !== 'host') {
    throw new Error('submitted MNA job is not the requested host backward-Euler transient method')
  }
  const circuit = object(submittedInput.circuit, 'submitted MNA transient circuit')
  const normalized = validateImport({
    mnaInput: { module: 'mna', method: submittedInput.method, circuit, dt: submittedInput.dt, steps: submittedInput.steps, ...(submittedInput.initial ? { initial: submittedInput.initial } : {}) },
    mnaJobSpec: createModuleJobSpec(({ module: 'mna', method: submittedInput.method, backend: 'host', circuit, dt: submittedInput.dt, steps: submittedInput.steps, ...(submittedInput.initial ? { initial: submittedInput.initial } : {}) } as unknown) as ModuleComputeInput),
    nodeMap: submittedNodeMap,
    diagnostics: [],
  })
  if (!Number.isInteger(submittedInput.outputNode) || submittedInput.outputNode < 1 || submittedInput.outputNode > (circuit.nodes as number)) {
    throw new Error('submitted MNA transient outputNode is invalid')
  }
  const output = object(readModuleResult(result, submittedInput as unknown as ModuleComputeInput), 'MNA transient module result')
  if (output.module !== 'mna') throw new Error('MNA transient result module does not match the submitted job')
  const backend = object(output.backend, 'MNA transient backend')
  if (typeof backend.id !== 'string' || !backend.id.startsWith('host-f64')) throw new Error('MNA transient result must report native host-f64 backend provenance')
  const payload = object(output.result, 'MNA transient result payload')
  exactKeys(payload, ['methodId', 'familyId', 'scheme', 'dt', 'steps', 'outputNode', 'finalNodeVoltages', 'finalCapacitorCurrents', 'finalInductorCurrents', 'outputWaveform', 'finalOutput', 'newtonIterations', 'converged'], 'MNA transient result payload')
  if (payload.methodId !== submittedInput.method || payload.familyId !== 'method-mna' || payload.scheme !== 'be') {
    throw new Error('MNA transient result method, family, or scheme does not match the submitted job')
  }
  if (payload.dt !== submittedInput.dt || payload.steps !== submittedInput.steps || payload.outputNode !== submittedInput.outputNode) {
    throw new Error('MNA transient result time grid or output node does not match the submitted job')
  }
  if (payload.converged !== true || !Number.isInteger(payload.newtonIterations) || (payload.newtonIterations as number) < 0) {
    throw new Error('MNA transient solver did not report convergence and valid iteration count')
  }
  const nodes = normalized.circuit.nodes
  const finalRaw = payload.finalNodeVoltages
  if (!Array.isArray(finalRaw) || finalRaw.length !== nodes) throw new Error('MNA transient final node voltage dimension does not match the submitted circuit')
  const finals = finalRaw.map((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`MNA transient final node voltage ${index + 1} is not finite`)
    return value
  })
  const checkCurrents = (key: 'finalCapacitorCurrents' | 'finalInductorCurrents', expected: number) => {
    const values = payload[key]
    if (!Array.isArray(values) || values.length !== expected) throw new Error(`MNA transient ${key} dimension does not match the submitted circuit`)
    return values.map((value, index) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`MNA transient ${key}[${index}] is not finite`)
      return value
    })
  }
  const capacitors = Array.isArray(circuit.capacitors) ? circuit.capacitors.length : 0
  const inductors = Array.isArray(circuit.inductors) ? circuit.inductors.length : 0
  const finalCapacitorCurrents = checkCurrents('finalCapacitorCurrents', capacitors)
  const finalInductorCurrents = checkCurrents('finalInductorCurrents', inductors)
  if (!Array.isArray(payload.outputWaveform) || payload.outputWaveform.length !== submittedInput.steps) {
    throw new Error('MNA transient waveform length does not match the submitted step count')
  }
  const samples = payload.outputWaveform.map((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`MNA transient waveform sample ${index + 1} is not finite`)
    return { time: (index + 1) * submittedInput.dt, value }
  })
  if (typeof payload.finalOutput !== 'number' || !Number.isFinite(payload.finalOutput)
      || payload.finalOutput !== samples[samples.length - 1]?.value
      || payload.finalOutput !== finals[submittedInput.outputNode - 1]) {
    throw new Error('MNA transient final output does not match the last waveform sample')
  }
  const entries = Object.entries(submittedNodeMap)
  if (submittedNodeMap['0'] !== 0 || entries.length !== nodes + 1) throw new Error('submitted node map must label every circuit node and ground exactly once')
  const seen = new Set<number>()
  const finalNodeVoltages = Object.fromEntries(entries.map(([name, index]) => {
    if (!name || !Number.isInteger(index) || index < 0 || index > nodes || seen.has(index)) throw new Error(`submitted node index for '${name}' is invalid or duplicated`)
    seen.add(index)
    return [name, index === 0 ? 0 : finals[index - 1]]
  }))
  const nodeName = entries.find(([, index]) => index === submittedInput.outputNode)?.[0]
  if (!nodeName) throw new Error('submitted node map does not name the selected output node')
  return {
    methodId: submittedInput.method, familyId: 'method-mna', scheme: 'be', dt: submittedInput.dt,
    steps: submittedInput.steps, outputNode: submittedInput.outputNode, nodeName, initial: submittedInput.initial ?? null, samples,
    finalNodeVoltages, finalCapacitorCurrents, finalInductorCurrents,
    finalOutput: payload.finalOutput, newtonIterations: payload.newtonIterations as number,
    converged: true, backend,
  }
}
