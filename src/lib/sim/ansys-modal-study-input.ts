export type AnsysModalStudyDraft = {
  stiffness: { k11: number; k12: number; k22: number }
  mass: { m11: number; m12: number; m22: number }
  direction: [number, number]
  numModes: 1 | 2
}

export type AnsysModalStudyInput = {
  module: 'sw-ansys-modal'
  backend: 'host'
  method: 'block-lanczos'
  stiffness: [[number, number], [number, number]]
  mass: [[number, number], [number, number]]
  direction: [number, number]
  numModes: 1 | 2
}

function fail(message: string): never {
  throw new Error(message)
}

function finite(value: unknown, name: string, maxMagnitude: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`${name} must be a finite number`)
  }
  if (Math.abs(value) > maxMagnitude) {
    return fail(`${name} magnitude must be <= ${maxMagnitude}`)
  }
  return value
}

function matrixEntries(value: unknown, name: 'Stiffness' | 'Mass', diagonalA: string, offDiagonal: string, diagonalB: string): [number, number, number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(`${name} must be an object`)
  }
  const matrix = value as Record<string, unknown>
  return [
    finite(matrix[diagonalA], `${name}.${diagonalA}`, 1e12),
    finite(matrix[offDiagonal], `${name}.${offDiagonal}`, 1e12),
    finite(matrix[diagonalB], `${name}.${diagonalB}`, 1e12),
  ]
}

function positiveDefinite(a: number, c: number, b: number, name: 'Stiffness' | 'Mass'): void {
  const scale = Math.max(a, b, Math.abs(c))
  const normalizedDeterminant = scale > 0 ? (a / scale) * (b / scale) - (c / scale) ** 2 : 0
  if (a <= 0 || b <= 0 || normalizedDeterminant <= 0) {
    fail(`${name} matrix must be positive definite (a > 0, b > 0, and a*b - c*c > 0)`)
  }
}

export function createDefaultAnsysModalStudy(): AnsysModalStudyDraft {
  return {
    stiffness: { k11: 1000, k12: 0, k22: 1000 },
    mass: { m11: 1, m12: 0, m22: 1 },
    direction: [1, 0],
    numModes: 2,
  }
}

export function buildAnsysModalStudyInput(draft: AnsysModalStudyDraft): AnsysModalStudyInput {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) fail('Modal study draft must be an object')

  const [k11, k12, k22] = matrixEntries(draft.stiffness, 'Stiffness', 'k11', 'k12', 'k22')
  const [m11, m12, m22] = matrixEntries(draft.mass, 'Mass', 'm11', 'm12', 'm22')
  positiveDefinite(k11, k12, k22, 'Stiffness')
  positiveDefinite(m11, m12, m22, 'Mass')

  if (!Array.isArray(draft.direction) || draft.direction.length !== 2) {
    fail('Direction must contain exactly two finite numbers')
  }
  const direction: [number, number] = [
    finite(draft.direction[0], 'Direction[0]', 1e6),
    finite(draft.direction[1], 'Direction[1]', 1e6),
  ]
  if (direction[0] === 0 && direction[1] === 0) fail('Direction must not be the zero vector')

  if (draft.numModes !== 1 && draft.numModes !== 2) fail('numModes must be the integer 1 or 2')

  return {
    module: 'sw-ansys-modal',
    backend: 'host',
    method: 'block-lanczos',
    stiffness: [[k11, k12], [k12, k22]],
    mass: [[m11, m12], [m12, m22]],
    direction,
    numModes: draft.numModes,
  }
}
