import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { ComsolPipeFlowInput } from './comsol-pipe-flow-input'

type RecordValue = Record<string, unknown>
export type ComsolPipeFlowNode = { id: string; pressure: number; head: number; z: number; boundary: boolean }
export type ComsolPipeFlowEdge = { id: string; from: string; to: string; length: number; hydraulicDiameter: number; flow: number; velocity: number; reynolds: number; rheology: 'Newtonian'; frictionFactor: number | null; regime: string; headLoss: number }
export type ComsolPipeFlowResult = {
  backend: { id: string; kind: string; deviceName: string }
  result: { rho: number; mu: number; g: number; iterations: number; maxEnergyResidual: number; maxMassResidual: number; nodeCount: number; edgeCount: number; nodes: [ComsolPipeFlowNode, ComsolPipeFlowNode]; edges: [ComsolPipeFlowEdge]; ok: true; methodId: string; familyId: string; scopeNote: string }
}

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string, min = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`${label} must be a finite number${min > -Infinity ? ` >= ${min}` : ''}`)
  return value
}

function close(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-8 * Math.max(1, Math.abs(actual), Math.abs(expected))) throw new Error(`Pipe flow ${label} does not match the submitted study`)
}

/** Validate native operation identity, convergence, and the exact submitted single-pipe snapshot. */
export function readComsolPipeFlowResult(jobResult: JobResultV1, input: ComsolPipeFlowInput): ComsolPipeFlowResult {
  const output = object(readModuleResult(jobResult, input as unknown as ModuleComputeInput), 'Pipe flow module result')
  if (output.module !== 'sw-comsol-pipe-flow') throw new Error('Pipe flow result module does not match the submitted study')
  const backend = object(output.backend, 'Pipe flow backend provenance')
  if (backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64' || backend.deviceName !== 'w-sim-cuda-host') throw new Error('Pipe flow result must report the w-sim-cuda-host host-f64 backend')
  const raw = object(output.result, 'Pipe flow native payload')
  if (raw.ok !== true || raw.methodId !== 'method-algo-pipe-flow-1d' || raw.familyId !== 'method-pipe-flow-1d') throw new Error('Pipe flow native result is not a successful method-algo-pipe-flow-1d operation')
  if (typeof raw.scopeNote !== 'string' || !raw.scopeNote.trim()) throw new Error('Pipe flow result must include its native scope note')
  const rho = finite(raw.rho, 'native density', 0)
  const mu = finite(raw.mu, 'native viscosity', 0)
  const g = finite(raw.g, 'native gravity', 0)
  if (rho !== input.rho || mu !== input.mu || !(g > 0)) throw new Error('Pipe flow native fluid properties do not match the submitted input')
  const iterations = finite(raw.iterations, 'Newton iterations', 0)
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 200) throw new Error('Pipe flow result has an invalid iteration count')
  const maxEnergyResidual = finite(raw.maxEnergyResidual, 'energy residual', 0)
  const maxMassResidual = finite(raw.maxMassResidual, 'mass residual', 0)
  if (maxEnergyResidual > 1e-8 * Math.max(1, Math.abs(input.nodes[0].pressure / (rho * g)))) throw new Error('Pipe flow native result did not converge within its reported energy residual bound')
  if (raw.nodeCount !== 2 || raw.edgeCount !== 1 || !Array.isArray(raw.nodes) || raw.nodes.length !== 2 || !Array.isArray(raw.edges) || raw.edges.length !== 1) throw new Error('Pipe flow native result dimensions do not match the submitted single pipe')
  const nodes = raw.nodes.map((entry, index) => {
    const node = object(entry, `native node ${index}`)
    const id = index === 0 ? 'inlet' : 'outlet'
    if (node.id !== id || node.boundary !== true) throw new Error(`Pipe flow native result is missing the prescribed ${id} endpoint`)
    const pressure = finite(node.pressure, `${id} pressure`)
    close(pressure, input.nodes[index].pressure, `${id} pressure`)
    return { id, pressure, head: finite(node.head, `${id} head`), z: finite(node.z, `${id} elevation`), boundary: true }
  }) as [ComsolPipeFlowNode, ComsolPipeFlowNode]
  const nativeEdge = object(raw.edges[0], 'native pipe edge')
  if (nativeEdge.id !== 'pipe' || nativeEdge.from !== 'inlet' || nativeEdge.to !== 'outlet') throw new Error('Pipe flow native edge does not match the submitted endpoint mapping')
  const length = finite(nativeEdge.length, 'native pipe length', 0)
  const hydraulicDiameter = finite(nativeEdge.hydraulicDiameter, 'native hydraulic diameter', 0)
  close(length, input.edges[0].length, 'pipe length')
  close(hydraulicDiameter, input.edges[0].diameter, 'pipe diameter')
  const flow = finite(nativeEdge.flow, 'native flow')
  const velocity = finite(nativeEdge.velocity, 'native velocity')
  const reynolds = finite(nativeEdge.reynolds, 'native Reynolds number', 0)
  if (!(flow > 0) || !(velocity > 0) || !(reynolds > 0)) throw new Error('Pipe flow result must report positive forward flow for the submitted pressure ordering')
  if (maxMassResidual > 1e-8 * Math.max(Math.abs(flow), 1e-12)) throw new Error('Pipe flow native result did not converge within its reported mass residual bound')
  const frictionFactor = nativeEdge.frictionFactor === null ? null : finite(nativeEdge.frictionFactor, 'native Darcy friction factor', 0)
  const regime = nativeEdge.regime
  if (nativeEdge.rheology !== 'Newtonian') throw new Error('Pipe flow native result does not report the submitted Newtonian fluid operation')
  if (regime !== 'laminar' && regime !== 'transitional' && regime !== 'turbulent') throw new Error('Pipe flow native result must report its flow regime')
  if (frictionFactor === null || !(frictionFactor > 0)) throw new Error('Pipe flow native result must report a positive Darcy friction factor')
  const headLoss = finite(nativeEdge.headLoss, 'native head loss')
  const pressureBalanceError = Math.abs(rho * g * headLoss - (nodes[0].pressure - nodes[1].pressure))
  const pressureBalanceTolerance = 1e-8 * Math.max(rho * g, Math.abs(input.nodes[0].pressure))
  if (pressureBalanceError > pressureBalanceTolerance) throw new Error('Pipe flow pressure/head-loss balance does not match the native residual tolerance')
  return {
    backend: { id: backend.id as string, kind: backend.kind as string, deviceName: backend.deviceName as string },
    result: {
      rho, mu, g, iterations, maxEnergyResidual, maxMassResidual, nodeCount: 2, edgeCount: 1,
      nodes, edges: [{ id: 'pipe', from: 'inlet', to: 'outlet', length, hydraulicDiameter, flow, velocity, reynolds, rheology: 'Newtonian', frictionFactor, regime, headLoss }],
      ok: true, methodId: 'method-algo-pipe-flow-1d', familyId: 'method-pipe-flow-1d', scopeNote: raw.scopeNote,
    },
  }
}
