import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import {
  createModuleJobSpec,
  readModuleResult,
  type ModuleComputeInput,
  type SwModuleInput,
} from './module-compute'

export type SpiceImportInput = SwModuleInput & {
  module: 'sw-ngspice-netlist'
  backend: 'host'
  method: 'method-ngspice-netlist-to-mna'
  netlist: string
  includes?: Record<string, string>
}

export type MnaImport = {
  mnaInput: Record<string, unknown> & { module: 'mna'; method: string; circuit: Record<string, unknown> }
  mnaJobSpec: JobSpecV1
  nodeMap: Record<string, number>
  diagnostics: Array<{ severity: 'warning'; message: string; line?: number; source?: string }>
}

export type MnaDcInput = {
  module: 'mna'
  method: 'method-algo-mna-dc'
  backend: 'host'
  circuit: {
    nodes: number
    resistors?: Array<{ a: number; b: number; r: number }>
    vSources?: Array<{ a: number; b: number; v: number }>
    iSources?: Array<{ a: number; b: number; i: number }>
  }
}

export type SpiceDcResult = {
  nodeVoltages: Record<string, number>
  methodId: 'method-algo-mna-dc'
  familyId: 'method-mna'
  converged: true
  iterations: number
  residualNorm: number
  backend: Record<string, unknown>
}

export type MnaDcSweepInput = {
  module: 'mna'
  method: 'method-algo-mna-dc-sweep'
  backend: 'host'
  circuit: MnaDcInput['circuit']
  sweep: { source: number; start: number; stop: number; steps: number }
}

export type SpiceDcSweepResult = {
  methodId: 'method-algo-mna-dc-sweep'
  familyId: 'method-mna'
  sweepSource: number
  points: Array<{ value: number; nodeVoltages: Record<string, number> }>
  backend: Record<string, unknown>
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
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

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} contains unsupported field '${key}'`)
}

function dcCircuit(value: unknown): MnaDcInput['circuit'] {
  const circuit = object(value, 'MNA DC circuit')
  exactKeys(circuit, ['nodes', 'resistors', 'capacitors', 'inductors', 'vSources', 'iSources', 'diodes'], 'MNA DC circuit')
  for (const key of ['capacitors', 'inductors', 'diodes'] as const) {
    if (circuit[key] !== undefined && (!Array.isArray(circuit[key]) || circuit[key].length !== 0)) {
      throw new Error(`MNA DC circuit.${key} must be an empty array for the R/V/I operating-point adapter`)
    }
  }
  if (!Number.isInteger(circuit.nodes) || (circuit.nodes as number) < 1 || (circuit.nodes as number) > 64) {
    throw new Error('MNA DC circuit.nodes must be an integer from 1 to 64')
  }
  const nodes = circuit.nodes as number
  let elementCount = 0
  const checkElements = <K extends 'resistors' | 'vSources' | 'iSources'>(key: K, fields: readonly string[], positiveField?: string) => {
    const raw = circuit[key]
    if (raw === undefined) return undefined
    if (!Array.isArray(raw)) throw new Error(`MNA DC circuit.${key} must be an array`)
    elementCount += raw.length
    if (elementCount > 512) throw new Error('MNA DC circuit supports at most 512 R/V/I elements')
    return raw.map((entry, index) => {
      const label = `MNA DC circuit.${key}[${index}]`
      const element = object(entry, label)
      exactKeys(element, fields, label)
      for (const endpoint of ['a', 'b']) {
        const node = element[endpoint]
        if (!Number.isInteger(node) || (node as number) < 0 || (node as number) > nodes) {
          throw new Error(`${label}.${endpoint} must be an integer node from 0 to ${nodes}`)
        }
      }
      const valueKey = fields[2]
      const amount = element[valueKey]
      if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > 1e20
          || (positiveField === valueKey && amount <= 0)) {
        throw new Error(`${label}.${valueKey} must be finite${positiveField === valueKey ? ' and positive' : ''}`)
      }
      return element as unknown as { a: number; b: number; r: number } & { v?: number; i?: number }
    })
  }
  const resistors = checkElements('resistors', ['a', 'b', 'r'], 'r') as unknown as MnaDcInput['circuit']['resistors']
  const vSources = checkElements('vSources', ['a', 'b', 'v']) as unknown as MnaDcInput['circuit']['vSources']
  const iSources = checkElements('iSources', ['a', 'b', 'i']) as unknown as MnaDcInput['circuit']['iSources']
  return { nodes, ...(resistors ? { resistors } : {}), ...(vSources ? { vSources } : {}), ...(iSources ? { iSources } : {}) }
}

function validateDcImport(imported: MnaImport): MnaDcInput {
  const mnaInput = object(imported.mnaInput, 'MNA input')
  exactKeys(mnaInput, ['module', 'method', 'circuit'], 'MNA input')
  if (mnaInput.module !== 'mna' || mnaInput.method !== 'method-algo-mna-dc') {
    throw new Error('SPICE import is not a DC operating-point analysis')
  }
  const circuit = dcCircuit(mnaInput.circuit)
  const nodeMap = object(imported.nodeMap, 'SPICE importer node map')
  if (nodeMap['0'] !== 0) throw new Error('SPICE importer node map must map ground "0" to node 0')
  for (const [name, index] of Object.entries(nodeMap)) {
    if (!name || !Number.isInteger(index) || (index as number) < 0 || (index as number) > circuit.nodes) {
      throw new Error(`MNA node index for '${name}' is invalid`)
    }
  }
  const exportedSpec = object(imported.mnaJobSpec, 'MNA JobSpec')
  const model = object(exportedSpec.model, 'MNA JobSpec model')
  const inline = object(model.inline, 'MNA JobSpec model.inline')
  if (exportedSpec.schemaVersion !== 1 || exportedSpec.kind !== 'waveworld-module'
      || object(exportedSpec.parameters, 'MNA JobSpec parameters').module !== 'mna'
      || model.source !== 'inline' || object(exportedSpec.run, 'MNA JobSpec run').maxSteps !== 1
      || !sameJson(inline, mnaInput)) {
    throw new Error('MNA JobSpec does not exactly match the imported module, method, and circuit')
  }
  return { module: 'mna', method: 'method-algo-mna-dc', backend: 'host', circuit }
}

function validateSweepImport(imported: MnaImport): MnaDcSweepInput {
  const mnaInput = object(imported.mnaInput, 'MNA input')
  exactKeys(mnaInput, ['module', 'method', 'circuit', 'sweep'], 'MNA input')
  if (mnaInput.module !== 'mna' || mnaInput.method !== 'method-algo-mna-dc-sweep') {
    throw new Error('SPICE import module or method is not an MNA DC sweep analysis')
  }
  const circuit = dcCircuit(mnaInput.circuit)
  const rawCircuit = object(mnaInput.circuit, 'MNA DC sweep circuit')
  const rawSources = rawCircuit.vSources
  if (!Array.isArray(rawSources)) throw new Error('MNA DC sweep circuit.vSources must be an array')
  const sweep = object(mnaInput.sweep, 'MNA DC sweep')
  exactKeys(sweep, ['source', 'start', 'stop', 'steps'], 'MNA DC sweep')
  if (!Number.isInteger(sweep.source) || (sweep.source as number) < 0 || (sweep.source as number) >= rawSources.length) {
    throw new Error('MNA DC sweep source must be a valid independent voltage-source index')
  }
  if (typeof sweep.start !== 'number' || !Number.isFinite(sweep.start)
      || typeof sweep.stop !== 'number' || !Number.isFinite(sweep.stop) || sweep.start >= sweep.stop) {
    throw new Error('MNA DC sweep endpoints must be finite and ascending')
  }
  if (!Number.isInteger(sweep.steps) || (sweep.steps as number) < 2 || (sweep.steps as number) > 1001) {
    throw new Error('MNA DC sweep steps must be an integer from 2 to 1001')
  }
  const nodeMap = object(imported.nodeMap, 'SPICE importer node map')
  if (nodeMap['0'] !== 0) throw new Error('SPICE importer node map must map ground "0" to node 0')
  for (const [name, index] of Object.entries(nodeMap)) {
    if (!name || !Number.isInteger(index) || (index as number) < 0 || (index as number) > circuit.nodes) {
      throw new Error(`MNA node index for '${name}' is invalid`)
    }
  }
  const exportedSpec = object(imported.mnaJobSpec, 'MNA JobSpec')
  const model = object(exportedSpec.model, 'MNA JobSpec model')
  const inline = object(model.inline, 'MNA JobSpec model.inline')
  if (exportedSpec.schemaVersion !== 1 || exportedSpec.kind !== 'waveworld-module'
      || object(exportedSpec.parameters, 'MNA JobSpec parameters').module !== 'mna'
      || model.source !== 'inline' || object(exportedSpec.run, 'MNA JobSpec run').maxSteps !== sweep.steps
      || !sameJson(inline, mnaInput)) {
    throw new Error('MNA JobSpec does not exactly match the imported module, method, circuit, and sweep')
  }
  return {
    module: 'mna', method: 'method-algo-mna-dc-sweep', backend: 'host', circuit,
    sweep: { source: sweep.source as number, start: sweep.start, stop: sweep.stop, steps: sweep.steps as number },
  }
}

/** Build the existing native module JobSpec for a parse-only SPICE import. */
export function createSpiceImportJob(input: {
  netlist: string
  includes?: Record<string, string>
}): { input: SpiceImportInput; spec: JobSpecV1 } {
  if (!input.netlist.trim()) throw new Error('SPICE netlist is empty')
  const moduleInput: SpiceImportInput = {
    module: 'sw-ngspice-netlist',
    backend: 'host',
    method: 'method-ngspice-netlist-to-mna',
    netlist: input.netlist,
    ...(input.includes && Object.keys(input.includes).length > 0 ? { includes: input.includes } : {}),
  }
  return { input: moduleInput, spec: createModuleJobSpec(moduleInput) }
}

/** Convert only a validated linear R/V/I .op import into the native MNA host solver job. */
export function createSpiceDcJob(imported: MnaImport): { input: MnaDcInput; spec: JobSpecV1 } {
  const input = validateDcImport(imported)
  return { input, spec: createModuleJobSpec(input as unknown as ModuleComputeInput) }
}

/** Convert only a validated linear R/V/I .dc import into the native MNA host solver job. */
export function createSpiceDcSweepJob(imported: MnaImport): { input: MnaDcSweepInput; spec: JobSpecV1 } {
  const input = validateSweepImport(imported)
  const spec = createModuleJobSpec(input as unknown as ModuleComputeInput)
  return { input, spec }
}

/** Read the native solver's real DC response and restore names from the importer node map. */
export function readSpiceDcResult(
  result: JobResultV1,
  submittedInput: MnaDcInput,
  submittedNodeMap: Record<string, number>,
): SpiceDcResult {
  if (submittedInput.module !== 'mna' || submittedInput.method !== 'method-algo-mna-dc' || submittedInput.backend !== 'host') {
    throw new Error('submitted MNA job is not the requested host DC operating-point method')
  }
  const normalized = dcCircuit(submittedInput.circuit)
  const output = object(readModuleResult(result, submittedInput as unknown as ModuleComputeInput), 'MNA DC module result')
  if (output.module !== 'mna') throw new Error('MNA DC result module does not match the submitted job')
  const backend = object(output.backend, 'MNA DC backend')
  if (typeof backend.id !== 'string' || !backend.id.startsWith('host-f64')) throw new Error('MNA DC result must report native host-f64 backend provenance')
  const payload = object(output.result, 'MNA DC result payload')
  if (payload.methodId !== submittedInput.method || payload.familyId !== 'method-mna') throw new Error('MNA DC result method or family does not match the submitted job')
  if (payload.converged !== true) throw new Error('MNA DC solver did not converge')
  if (!Number.isInteger(payload.iterations) || (payload.iterations as number) < 0 || (payload.iterations as number) > 1000) throw new Error('MNA DC iterations are invalid')
  if (typeof payload.residualNorm !== 'number' || !Number.isFinite(payload.residualNorm) || payload.residualNorm < 0) throw new Error('MNA DC residualNorm must be finite and non-negative')
  if (!Array.isArray(payload.nodeVoltages) || payload.nodeVoltages.length !== normalized.nodes) throw new Error('MNA DC node voltage dimension does not match the submitted circuit')
  const nodeVoltages = payload.nodeVoltages.map((voltage, index) => {
    if (typeof voltage !== 'number' || !Number.isFinite(voltage)) throw new Error(`MNA DC node voltage ${index + 1} is not finite`)
    return voltage
  })
  if (submittedNodeMap['0'] !== 0) throw new Error('submitted node map must map ground "0" to node 0')
  const named = Object.fromEntries(Object.entries(submittedNodeMap).map(([name, index]) => {
    if (!name || !Number.isInteger(index) || index < 0 || index > normalized.nodes) throw new Error(`submitted node index for '${name}' is invalid`)
    return [name, index === 0 ? 0 : nodeVoltages[index - 1]]
  }))
  return {
    nodeVoltages: named,
    methodId: 'method-algo-mna-dc',
    familyId: 'method-mna',
    converged: true,
    iterations: payload.iterations as number,
    residualNorm: payload.residualNorm,
    backend,
  }
}

/** Read the native solver's real DC sweep and restore node names from the importer map. */
export function readSpiceDcSweepResult(
  result: JobResultV1,
  submittedInput: MnaDcSweepInput,
  submittedNodeMap: Record<string, number>,
): SpiceDcSweepResult {
  if (submittedInput.module !== 'mna' || submittedInput.method !== 'method-algo-mna-dc-sweep' || submittedInput.backend !== 'host') {
    throw new Error('submitted MNA job is not the requested host DC sweep method')
  }
  const normalized = dcCircuit(submittedInput.circuit)
  const sweep = submittedInput.sweep
  if (!Number.isInteger(sweep.source) || sweep.source < 0
      || !Array.isArray(normalized.vSources) || sweep.source >= normalized.vSources.length
      || typeof sweep.start !== 'number' || !Number.isFinite(sweep.start)
      || typeof sweep.stop !== 'number' || !Number.isFinite(sweep.stop) || sweep.start >= sweep.stop
      || !Number.isInteger(sweep.steps) || sweep.steps < 2 || sweep.steps > 1001) {
    throw new Error('submitted MNA DC sweep parameters are invalid')
  }
  const { source, start, stop, steps } = sweep
  const output = object(readModuleResult(result, submittedInput as unknown as ModuleComputeInput), 'MNA DC sweep module result')
  if (output.module !== 'mna') throw new Error('MNA DC sweep result module does not match the submitted job')
  const backend = object(output.backend, 'MNA DC sweep backend')
  if (typeof backend.id !== 'string' || !backend.id.startsWith('host-f64')) throw new Error('MNA DC sweep result must report native host-f64 backend provenance')
  const payload = object(output.result, 'MNA DC sweep result payload')
  if (payload.methodId !== submittedInput.method || payload.familyId !== 'method-mna'
      || payload.sweepSource !== source) throw new Error('MNA DC sweep result method, family, or source does not match the submitted job')
  if (!Array.isArray(payload.points) || payload.points.length !== steps) throw new Error('MNA DC sweep point count does not match the submitted sweep')
  const tolerance = (expected: number) => 1e-9 * Math.max(1, Math.abs(expected), Math.abs(start), Math.abs(stop))
  const points = payload.points.map((entry, index) => {
    const point = object(entry, `MNA DC sweep point ${index + 1}`)
    const expected = start + index / (steps - 1) * (stop - start)
    if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
      throw new Error(`MNA DC sweep point ${index + 1} value must be finite`)
    }
    if (Math.abs(point.value - expected) > tolerance(expected)) {
      throw new Error(`MNA DC sweep point ${index + 1} has an unexpected sweep coordinate`)
    }
    if (!Array.isArray(point.nodeVoltages) || point.nodeVoltages.length !== normalized.nodes) {
      throw new Error(`MNA DC sweep point ${index + 1} node voltage dimension does not match the submitted circuit`)
    }
    const voltages = point.nodeVoltages.map((voltage, nodeIndex) => {
      if (typeof voltage !== 'number' || !Number.isFinite(voltage)) throw new Error(`MNA DC sweep point ${index + 1} node voltage ${nodeIndex + 1} is not finite`)
      return voltage
    })
    return { value: point.value, nodeVoltages: voltages }
  })
  if (submittedNodeMap['0'] !== 0) throw new Error('submitted node map must map ground "0" to node 0')
  const nodeNames = Object.entries(submittedNodeMap).map(([name, index]) => {
    if (!name || !Number.isInteger(index) || index < 0 || index > normalized.nodes) throw new Error(`submitted node index for '${name}' is invalid`)
    return [name, index] as const
  })
  return {
    methodId: 'method-algo-mna-dc-sweep', familyId: 'method-mna', sweepSource: source,
    points: points.map(point => ({
      value: point.value,
      nodeVoltages: Object.fromEntries(nodeNames.map(([name, index]) => [name, index === 0 ? 0 : point.nodeVoltages[index - 1]])),
    })),
    backend,
  }
}

function isMnaJobSpec(value: unknown): value is JobSpecV1 {
  const spec = object(value, 'MNA JobSpec')
  const model = object(spec.model, 'MNA JobSpec model')
  const inline = object(model.inline, 'MNA JobSpec model.inline')
  const parameters = object(spec.parameters, 'MNA JobSpec parameters')
  return spec.schemaVersion === 1
    && spec.kind === 'waveworld-module'
    && parameters.module === 'mna'
    && model.source === 'inline'
    && inline.module === 'mna'
}

/** Validate the native importer payload before displaying or exporting it. */
export function readSpiceImportResult(result: JobResultV1, input: SpiceImportInput): MnaImport {
  const output = readModuleResult(result, input)
  if (output.module !== input.module) throw new Error('SPICE importer returned a different module result')
  const payload = object((output as unknown as Record<string, unknown>).result, 'SPICE importer result')
  if (payload.ok !== true || payload.methodId !== input.method) {
    throw new Error('SPICE importer result does not match the requested conversion method')
  }
  const imported = object(payload.import, 'SPICE importer MNA import')
  const mnaInput = object(imported.mnaInput, 'MNA input')
  if (mnaInput.module !== 'mna' || typeof mnaInput.method !== 'string') {
    throw new Error('SPICE importer did not return a supported MNA input')
  }
  object(mnaInput.circuit, 'MNA circuit')
  if (!isMnaJobSpec(imported.mnaJobSpec)) throw new Error('SPICE importer did not return an MNA JobSpec')
  const nodeMap = object(imported.nodeMap, 'SPICE importer node map')
  for (const [name, index] of Object.entries(nodeMap)) {
    if (!Number.isInteger(index) || (index as number) < 0) throw new Error(`MNA node index for '${name}' is invalid`)
  }
  if (!Array.isArray(imported.diagnostics)) throw new Error('SPICE importer diagnostics must be an array')
  const diagnostics = imported.diagnostics.map((entry, index) => {
    const diagnostic = object(entry, `SPICE importer diagnostic ${index + 1}`)
    if ((diagnostic.severity !== 'warning' && diagnostic.severity !== 'error') || typeof diagnostic.message !== 'string') {
      throw new Error(`SPICE importer diagnostic ${index + 1} is invalid`)
    }
    if (diagnostic.severity === 'error') throw new Error(`SPICE import diagnostic: ${diagnostic.message}`)
    return diagnostic as MnaImport['diagnostics'][number]
  })
  return {
    mnaInput: mnaInput as MnaImport['mnaInput'],
    mnaJobSpec: imported.mnaJobSpec,
    nodeMap: nodeMap as Record<string, number>,
    diagnostics,
  }
}
