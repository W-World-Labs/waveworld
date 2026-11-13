import type { JobResultV1 } from '@w-sim/contracts'
import type { AbaqusBeamStudyInput } from './abaqus-beam-study-input'
import { readModuleResult } from './module-compute'

export type { AbaqusBeamStudyInput } from './abaqus-beam-study-input'

export type AbaqusBeamNode = { index: number; x: number; u: number; v: number; theta: number }
export type AbaqusBeamProbe = { node: number; x: number; v: number; theta: number }
export type AbaqusBeamReaction = { node: number; dof: 'u' | 'v' | 'theta'; value: number }
export type AbaqusBeamSpringForce = { node: number; dof: 'u' | 'v' | 'theta'; stiffness: number; displacement: number; forceOnBeam: number }
export type AbaqusBeamElement = { index: number; nodes: [number, number]; endForces: [number, number, number, number, number, number] }
export type AbaqusBeamClosedForm = { deflection: number; rotation: number; maxMoment: number }

/** Native result fields; index values are zero-based and forces are in native SI units. */
export type AbaqusBeamStudyResult = {
  module: 'sw-calculix-timoshenko-beam'
  familyId: 'method-calculix-timoshenko-beam'
  methodId: 'method-algo-b31-timoshenko'
  backend: { id: 'host-f64'; kind: 'cpu'; deviceName: 'w-sim-cuda-host'; [key: string]: unknown }
  element: 'B31'
  elementNodes: 2
  dofPerNode: 3
  length: number
  nElements: number
  nNodes: number
  boundary: 'cantilever'
  shearParameter: number
  bendingStiffness: number
  shearStiffness: number
  shearCorrectionFactor: number
  shearArea: number
  nodes: AbaqusBeamNode[]
  probe: AbaqusBeamProbe
  maxDeflection: number
  maxMoment: number
  reactions: AbaqusBeamReaction[]
  springForces: AbaqusBeamSpringForce[]
  elements: AbaqusBeamElement[]
  closedForm: AbaqusBeamClosedForm | null
  ok: true
  [key: string]: unknown
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}
function integer(value: unknown, label: string, min: number, max: number): number {
  const n = finite(value, label)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} is out of range`)
  return n
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be a bounded array`)
  return value
}
function close(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-9 * Math.max(Math.abs(actual), Math.abs(expected), 1e-30)) throw new Error(`${label} does not match the submitted study`)
}

/** Reads the authenticated job envelope, then validates and types its native beam payload. */
export function parseAbaqusBeamStudyResult(jobResult: JobResultV1, input: AbaqusBeamStudyInput): AbaqusBeamStudyResult {
  if (input.module !== 'sw-calculix-timoshenko-beam' || input.backend !== 'host' || input.element !== 'B31' || input.boundary !== 'cantilever') throw new Error('unsupported Abaqus-mapped beam study input')
  const output = object(readModuleResult(jobResult, input), 'native module result')
  if (output.module !== input.module || output.familyId !== 'method-calculix-timoshenko-beam' || output.methodId !== 'method-algo-b31-timoshenko') throw new Error('native beam identity does not match the requested B31 study')
  if (output.ok !== true || output.element !== 'B31' || output.elementNodes !== 2 || output.dofPerNode !== 3 || output.boundary !== 'cantilever') throw new Error('native beam result reports an incompatible model')
  const backend = object(output.backend, 'backend')
  if (backend.id !== 'host-f64' || backend.kind !== 'cpu' || backend.deviceName !== 'w-sim-cuda-host') throw new Error('native beam result is not from the expected host-f64 backend')
  const n = integer(input.elements, 'submitted element count', 1, 2048)
  const length = finite(input.length, 'submitted length')
  if (!(length > 0)) throw new Error('submitted length must be positive')
  const nodesCount = n + 1
  if (integer(output.nElements, 'element count', 1, 2048) !== n || integer(output.nNodes, 'node count', 2, 2049) !== nodesCount) throw new Error('native beam mesh size does not match the submitted study')
  close(finite(output.length, 'length'), length, 'native length')

  const section = input.section
  const shearArea = section.k * section.A
  const shearStiffness = section.E / (2 * (1 + section.nu)) * shearArea
  close(finite(output.shearArea, 'shear area'), shearArea, 'native shear area')
  close(finite(output.shearCorrectionFactor, 'shear correction factor'), section.k, 'native shear correction factor')
  close(finite(output.bendingStiffness, 'bending stiffness'), section.E * section.I, 'native bending stiffness')
  close(finite(output.shearStiffness, 'shear stiffness'), shearStiffness, 'native shear stiffness')
  close(finite(output.shearParameter, 'shear parameter'), 12 * section.E * section.I / (shearStiffness * length * length), 'native shear parameter')

  const rawNodes = array(output.nodes, 'nodes', 2049)
  if (rawNodes.length !== nodesCount) throw new Error('native node count mismatch')
  const nodes = rawNodes.map((raw, i): AbaqusBeamNode => {
    const row = object(raw, `node ${i}`)
    if (integer(row.index, `node ${i} index`, 0, 2048) !== i) throw new Error('native node indices are not ordered')
    const x = finite(row.x, `node ${i} x`)
    close(x, length * i / n, `node ${i} position`)
    return { index: i, x, u: finite(row.u, `node ${i} axial displacement`), v: finite(row.v, `node ${i} deflection`), theta: finite(row.theta, `node ${i} rotation`) }
  })
  const probeRaw = object(output.probe, 'probe')
  if (integer(probeRaw.node, 'probe node', 0, n) !== n) throw new Error('cantilever probe must be at the free end')
  close(finite(probeRaw.x, 'probe x'), length, 'probe position')
  close(finite(probeRaw.v, 'probe deflection'), nodes[n].v, 'probe deflection')
  close(finite(probeRaw.theta, 'probe rotation'), nodes[n].theta, 'probe rotation')

  const reactions = array(output.reactions, 'reactions', 3).map((raw, i): AbaqusBeamReaction => {
    const row = object(raw, `reaction ${i}`)
    const dof = row.dof
    if (dof !== 'u' && dof !== 'v' && dof !== 'theta') throw new Error(`reaction ${i} has an invalid degree of freedom`)
    return { node: integer(row.node, `reaction ${i} node`, 0, n), dof, value: finite(row.value, `reaction ${i} value`) }
  })
  if (reactions.length !== 3 || reactions.some(r => r.node !== 0) || new Set(reactions.map(r => r.dof)).size !== 3) throw new Error('cantilever must return three fixed-end reactions')
  const springForces = array(output.springForces, 'spring forces', 0).map(() => { throw new Error('unexpected spring force in this study') }) as AbaqusBeamSpringForce[]
  const elements = array(output.elements, 'elements', 2048)
  if (elements.length !== n) throw new Error('native element count mismatch')
  const parsedElements = elements.map((raw, i): AbaqusBeamElement => {
    const row = object(raw, `element ${i}`)
    if (integer(row.index, `element ${i} index`, 0, 2047) !== i) throw new Error('native element indices are not ordered')
    const ids = array(row.nodes, `element ${i} nodes`, 2)
    if (ids.length !== 2 || integer(ids[0], 'element start node', 0, n) !== i || integer(ids[1], 'element end node', 0, n) !== i + 1) throw new Error(`element ${i} connectivity does not match the submitted mesh`)
    const forces = array(row.endForces, `element ${i} end forces`, 6)
    if (forces.length !== 6) throw new Error(`element ${i} must return six end forces`)
    return { index: i, nodes: [i, i + 1], endForces: forces.map((v, j) => finite(v, `element ${i} end force ${j}`)) as AbaqusBeamElement['endForces'] }
  })
  const closedRaw = output.closedForm
  let closedForm: AbaqusBeamClosedForm | null
  if (closedRaw === null) closedForm = null
  else {
    const cf = object(closedRaw, 'closed-form comparison')
    closedForm = { deflection: finite(cf.deflection, 'closed-form deflection'), rotation: finite(cf.rotation, 'closed-form rotation'), maxMoment: finite(cf.maxMoment, 'closed-form moment') }
  }
  return {
    ...output,
    module: 'sw-calculix-timoshenko-beam', familyId: 'method-calculix-timoshenko-beam', methodId: 'method-algo-b31-timoshenko',
    backend: backend as AbaqusBeamStudyResult['backend'], element: 'B31', elementNodes: 2, dofPerNode: 3,
    length, nElements: n, nNodes: nodesCount, boundary: 'cantilever',
    shearParameter: finite(output.shearParameter, 'shear parameter'), bendingStiffness: finite(output.bendingStiffness, 'bending stiffness'),
    shearStiffness, shearCorrectionFactor: section.k, shearArea, nodes,
    probe: { node: n, x: length, v: probeRaw.v as number, theta: probeRaw.theta as number },
    maxDeflection: finite(output.maxDeflection, 'maximum deflection'), maxMoment: finite(output.maxMoment, 'maximum moment'),
    reactions, springForces, elements: parsedElements, closedForm, ok: true,
  } as AbaqusBeamStudyResult
}
