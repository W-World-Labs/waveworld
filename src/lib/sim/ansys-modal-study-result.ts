import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { AnsysModalStudyInput } from './ansys-modal-study-input'

export type AnsysModalNativeInput = {
  module: 'sw-ansys-modal'
  backend: 'host'
  method: 'block-lanczos'
  stiffness: readonly (readonly number[])[]
  mass: readonly (readonly number[])[] | readonly number[]
  numModes: number
  direction?: readonly number[]
}

export type AnsysModalStudyResult = {
  module: 'sw-ansys-modal'
  familyId: 'method-ansys-modal-analysis'
  ok: true
  methodId: 'method-block-lanczos'
  method: 'block-lanczos'
  backend: { id: 'host-f64'; kind: 'cpu'; deviceName: 'w-sim-cuda-host'; [key: string]: unknown }
  n: number
  numModes: number
  solver: { algorithm: string; converged: true; residual: number; tolerance: number; [key: string]: unknown }
  eigenvalues: number[]
  frequenciesHz: number[]
  frequenciesRadS: number[]
  periodsS: number[]
  modeShapes: number[][]
  modalMass: number[]
  participationFactors: number[]
  effectiveMass: number[]
  effectiveMassRatio: number[]
  massNormalized: true
  system: { type: 'explicit'; n: number; [key: string]: unknown }
  [key: string]: unknown
}

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function vector(value: unknown, label: string, length: number, min = -Infinity, strictMin = false): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${label} must contain exactly ${length} values`)
  return value.map((entry, index) => {
    const number = finite(entry, `${label}[${index}]`)
    if (strictMin ? number <= min : number < min) throw new Error(`${label}[${index}] is out of range`)
    return number
  })
}

function close(actual: number, expected: number, label: string, tolerance = 1e-8): void {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance * Math.max(1, Math.abs(actual), Math.abs(expected))) {
    throw new Error(`${label} is inconsistent`)
  }
}

/** Validate the authenticated job envelope and native modal result; this function never solves locally. */
export function parseAnsysModalStudyResult(remote: JobResultV1, input: AnsysModalNativeInput | AnsysModalStudyInput): AnsysModalStudyResult {
  const moduleResult = readModuleResult(remote, input as unknown as ModuleComputeInput)
  return parseAnsysModalNativeOutput(moduleResult, input)
}

/** Validate a native modal payload after a shared module-compute hook has checked its job envelope. */
export function parseAnsysModalNativeOutput(nativeOutput: unknown, input: AnsysModalNativeInput | AnsysModalStudyInput): AnsysModalStudyResult {
  if (input.module !== 'sw-ansys-modal' || input.backend !== 'host' || input.method !== 'block-lanczos') {
    throw new Error('unsupported ANSYS modal study input')
  }
  const n = input.stiffness.length
  if (!Number.isInteger(n) || n < 1 || n > 128 || input.stiffness.some(row => !Array.isArray(row) || row.length !== n || row.some(value => typeof value !== 'number' || !Number.isFinite(value)))) {
    throw new Error('submitted stiffness matrix must be a finite square matrix with n in 1..128')
  }
  const massIsDiagonal = input.mass.length === n && input.mass.every(value => typeof value === 'number')
  const mass: number[][] = massIsDiagonal
    ? Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? finite(input.mass[i], `submitted mass[${i}]`) : 0))
    : (input.mass as readonly (readonly number[])[]).map((row, i) => {
      if (!Array.isArray(row) || row.length !== n) throw new Error('submitted mass matrix must be square and match the stiffness dimension')
      return row.map((value, j) => finite(value, `submitted mass[${i}][${j}]`))
    })
  if (mass.length !== n) throw new Error('submitted mass matrix must match the stiffness dimension')
  if (!Number.isInteger(input.numModes) || input.numModes < 1 || input.numModes > n) throw new Error('submitted modal count is out of range')
  const output = object(nativeOutput, 'native modal result')
  if (output.module !== 'sw-ansys-modal' || output.familyId !== 'method-ansys-modal-analysis') throw new Error('modal result module identity does not match the submitted study')
  if (output.ok !== true || output.methodId !== 'method-block-lanczos' || output.method !== 'block-lanczos') throw new Error('modal result did not report successful Block-Lanczos execution')

  const backend = object(output.backend, 'modal backend')
  if (backend.id !== 'host-f64' || backend.kind !== 'cpu' || backend.deviceName !== 'w-sim-cuda-host') {
    throw new Error('modal result backend provenance is invalid')
  }
  if (finite(output.n, 'modal system size') !== n || integer(output.numModes, 'modal count') !== input.numModes) {
    throw new Error('modal result dimensions do not match the submitted study')
  }
  const solver = object(output.solver, 'modal solver status')
  if (solver.converged !== true) throw new Error('modal solver did not converge')
  const residual = finite(solver.residual, 'solver residual')
  const tolerance = finite(solver.tolerance, 'solver tolerance')
  if (residual < 0 || tolerance <= 0 || typeof solver.algorithm !== 'string' || !solver.algorithm.trim()) {
    throw new Error('modal solver status is invalid')
  }
  if (residual > Math.max(tolerance, 1e-12)) throw new Error('modal solver residual exceeds its convergence tolerance')

  const count = input.numModes
  const eigenvalues = vector(output.eigenvalues, 'eigenvalues', count, 0)
  const frequenciesHz = vector(output.frequenciesHz, 'frequenciesHz', count, 0)
  const frequenciesRadS = vector(output.frequenciesRadS, 'frequenciesRadS', count, 0)
  const periodsS = vector(output.periodsS, 'periodsS', count, 0, true)
  const modalMass = vector(output.modalMass, 'modalMass', count, 0, true)
  const participationFactors = vector(output.participationFactors, 'participationFactors', count)
  const effectiveMass = vector(output.effectiveMass, 'effectiveMass', count, 0)
  const effectiveMassRatio = vector(output.effectiveMassRatio, 'effectiveMassRatio', count, 0)
  if (output.massNormalized !== true) throw new Error('modal mode shapes must be mass normalized')
  const rawShapes = output.modeShapes
  if (!Array.isArray(rawShapes) || rawShapes.length !== count) throw new Error(`modeShapes must contain exactly ${count} vectors`)
  const modeShapes = rawShapes.map((shape, index) => vector(shape, `modeShapes[${index}]`, n))

  const system = object(output.system, 'modal system')
  if (system.n !== n || system.type !== 'explicit') throw new Error('modal system dimension or type does not match the submitted explicit model')
  if (eigenvalues.some(value => value <= 0)) throw new Error('modal eigenvalues must be positive')
  for (let i = 0; i < count; i += 1) {
    if (effectiveMassRatio[i] > 1 + 1e-8 || (i > 0 && effectiveMassRatio[i] < effectiveMassRatio[i - 1])) {
      throw new Error('cumulative effective mass ratios must be ascending and no greater than one')
    }
    const phi = modeShapes[i]
    let phiMPhi = 0
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) phiMPhi += phi[row] * mass[row][col] * phi[col]
    }
    close(phiMPhi, 1, `modeShapes[${i}] mass normalization`, 1e-6)
    close(modalMass[i], phiMPhi, `modalMass[${i}]`, 1e-6)
    if (i > 0 && (frequenciesHz[i] < frequenciesHz[i - 1] || frequenciesRadS[i] < frequenciesRadS[i - 1] || eigenvalues[i] < eigenvalues[i - 1])) {
      throw new Error('modal frequencies and eigenvalues must be ascending')
    }
  }

  return {
    ...output,
    module: 'sw-ansys-modal', familyId: 'method-ansys-modal-analysis', ok: true,
    methodId: 'method-block-lanczos', method: 'block-lanczos',
    backend: backend as AnsysModalStudyResult['backend'], n, numModes: count,
    solver: { ...solver, algorithm: solver.algorithm, converged: true, residual, tolerance },
    eigenvalues, frequenciesHz, frequenciesRadS, periodsS, modeShapes, modalMass,
    participationFactors, effectiveMass, effectiveMassRatio, massNormalized: true,
    system: { ...system, type: 'explicit', n },
  } as AnsysModalStudyResult
}

function integer(value: unknown, label: string): number {
  const number = finite(value, label)
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer`)
  return number
}
