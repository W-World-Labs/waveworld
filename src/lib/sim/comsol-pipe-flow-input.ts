import type { JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, type ModuleComputeInput, type SwModuleInput } from './module-compute'

export type ComsolPipeFlowDraft = {
  length: number
  diameter: number
  rho: number
  mu: number
  inletPressure: number
  outletPressure: number
}

export type ComsolPipeFlowInput = SwModuleInput & {
  module: 'sw-comsol-pipe-flow'
  methodId: 'method-algo-pipe-flow-1d'
  backend: 'host'
  rho: number
  mu: number
  nodes: Array<{ id: 'inlet' | 'outlet'; pressure: number }>
  edges: Array<{ id: 'pipe'; from: 'inlet'; to: 'outlet'; length: number; diameter: number }>
}

const DRAFT_KEYS = ['length', 'diameter', 'rho', 'mu', 'inletPressure', 'outletPressure'] as const
const INPUT_KEYS = ['module', 'methodId', 'backend', 'rho', 'mu', 'nodes', 'edges'] as const

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
  for (const key of allowed) if (!(key in value)) fail(`${name}.${key} is required`)
}

function positive(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    fail(`${name} must be finite, > 0, and <= ${max}`)
  }
  return value
}

function pressure(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e8) {
    fail(`${name} must be finite and in [0, 1e8] Pa`)
  }
  return value
}

function validateDraft(value: unknown): ComsolPipeFlowDraft {
  const draft = record(value, 'Pipe flow study')
  exactKeys(draft, DRAFT_KEYS, 'Pipe flow study')
  const length = positive(draft.length, 'Pipe length (m)', 10000)
  const diameter = positive(draft.diameter, 'Pipe inner diameter (m)', 10)
  const rho = positive(draft.rho, 'Fluid density (kg/m³)', 20000)
  const mu = positive(draft.mu, 'Dynamic viscosity (Pa·s)', 1000)
  const inletPressure = pressure(draft.inletPressure, 'Inlet pressure')
  const outletPressure = pressure(draft.outletPressure, 'Outlet pressure')
  if (inletPressure <= outletPressure) fail('Inlet pressure must exceed outlet pressure for this forward-flow study')
  return { length, diameter, rho, mu, inletPressure, outletPressure }
}

export function createDefaultComsolPipeFlow(): ComsolPipeFlowDraft {
  return { length: 10, diameter: 0.05, rho: 998.2, mu: 0.001002, inletPressure: 1.01e5, outletPressure: 1e5 }
}

export function validateComsolPipeFlowInput(value: unknown): ComsolPipeFlowInput {
  const input = record(value, 'Pipe flow native input')
  exactKeys(input, INPUT_KEYS, 'Pipe flow native input')
  if (input.module !== 'sw-comsol-pipe-flow' || input.methodId !== 'method-algo-pipe-flow-1d' || input.backend !== 'host') {
    fail('Pipe flow input must select the admitted host method-algo-pipe-flow-1d operation')
  }
  const rho = positive(input.rho, 'rho', 20000)
  const mu = positive(input.mu, 'mu', 1000)
  if (!Array.isArray(input.nodes) || input.nodes.length !== 2) fail('Pipe flow study requires exactly two boundary nodes')
  const parseNode = (entry: unknown, index: number): ComsolPipeFlowInput['nodes'][number] => {
    const node = record(entry, `nodes[${index}]`)
    exactKeys(node, ['id', 'pressure'], `nodes[${index}]`)
    const expectedId = index === 0 ? 'inlet' as const : 'outlet' as const
    if (node.id !== expectedId) fail(`nodes[${index}].id must be ${expectedId}`)
    return { id: expectedId, pressure: pressure(node.pressure, `nodes[${index}].pressure`) }
  }
  const nodes: ComsolPipeFlowInput['nodes'] = [parseNode(input.nodes[0], 0), parseNode(input.nodes[1], 1)]
  if (nodes[0].pressure <= nodes[1].pressure) fail('Inlet pressure must exceed outlet pressure')
  if (!Array.isArray(input.edges) || input.edges.length !== 1) fail('Pipe flow study requires exactly one pipe edge')
  const edge = record(input.edges[0], 'edges[0]')
  exactKeys(edge, ['id', 'from', 'to', 'length', 'diameter'], 'edges[0]')
  if (edge.id !== 'pipe' || edge.from !== 'inlet' || edge.to !== 'outlet') fail('edges[0] must connect inlet to outlet as pipe')
  return {
    module: 'sw-comsol-pipe-flow', methodId: 'method-algo-pipe-flow-1d', backend: 'host', rho, mu, nodes,
    edges: [{ id: 'pipe', from: 'inlet', to: 'outlet', length: positive(edge.length, 'Pipe length (m)', 10000), diameter: positive(edge.diameter, 'Pipe diameter (m)', 10) }],
  }
}

export function createComsolPipeFlowJob(draft: ComsolPipeFlowDraft): { input: ComsolPipeFlowInput; spec: JobSpecV1 } {
  const saved = validateDraft(draft)
  const input = validateComsolPipeFlowInput({
    module: 'sw-comsol-pipe-flow', methodId: 'method-algo-pipe-flow-1d', backend: 'host',
    rho: saved.rho, mu: saved.mu,
    nodes: [{ id: 'inlet', pressure: saved.inletPressure }, { id: 'outlet', pressure: saved.outletPressure }],
    edges: [{ id: 'pipe', from: 'inlet', to: 'outlet', length: saved.length, diameter: saved.diameter }],
  })
  return { input, spec: createModuleJobSpec(input as ModuleComputeInput) }
}

export function comsolPipeFlowDraft(input: ComsolPipeFlowInput): ComsolPipeFlowDraft {
  return {
    length: input.edges[0].length, diameter: input.edges[0].diameter, rho: input.rho, mu: input.mu,
    inletPressure: input.nodes[0].pressure, outletPressure: input.nodes[1].pressure,
  }
}
