export type AnsysHarmonicDampingDraft =
  | { kind: 'none' }
  | { kind: 'ratio'; value: number }
  | { kind: 'coefficient'; value: number }

export type AnsysHarmonicModeDraft = {
  frequencyHz: number
  shape: number[]
  dampingRatio?: number
}

export type AnsysHarmonicStudyDraft = {
  system: 'sdof'
  mass: number
  stiffness: number
  force: number
  damping: AnsysHarmonicDampingDraft
  startFrequency: number
  endFrequency: number
  points: number
  freqUnit: 'hz' | 'rads'
} | {
  system: 'modal'
  modes: AnsysHarmonicModeDraft[]
  force: number[]
  damping: { kind: 'none' } | { kind: 'ratio'; value: number } | { kind: 'rayleigh'; alpha: number; beta: number }
  startFrequency: number
  endFrequency: number
  points: number
  freqUnit: 'hz' | 'rads'
}

export type AnsysHarmonicStudyInput = {
  module: 'sw-ansys-harmonic-response'
  backend: 'host'
  system: 'sdof' | 'modal'
  freqs: number[]
  freqUnit: 'hz' | 'rads'
  mass?: number
  stiffness?: number
  force?: number | number[]
  dampingRatio?: number
  damping?: number
  modes?: Array<{ frequencyHz: number; shape: number[]; dampingRatio?: number }>
  rayleigh?: { alpha: number; beta: number }
}

const MODULE_ID = 'sw-ansys-harmonic-response' as const
const MAX_MODES = 8
const MAX_DOFS = 16
const MAX_POINTS = 201
const MAX_SAMPLES = 1_000_000
const MAX_TERMS = 50_000_000

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

function sweep(startValue: unknown, endValue: unknown, pointsValue: unknown, unitValue: unknown): { startFrequency: number; endFrequency: number; points: number; freqUnit: 'hz' | 'rads' } {
  if (unitValue !== 'hz' && unitValue !== 'rads') fail('freqUnit must be hz or rads')
  const points = finite(pointsValue, 'points', 2, MAX_POINTS)
  if (!Number.isInteger(points)) fail(`points must be an integer from 2 to ${MAX_POINTS}`)
  const startFrequency = finite(startValue, 'startFrequency', 0, 1e9)
  const endFrequency = finite(endValue, 'endFrequency', 0, 1e9)
  if (endFrequency <= startFrequency) fail('endFrequency must be greater than startFrequency')
  return { startFrequency, endFrequency, points, freqUnit: unitValue }
}

function expandSweep(draft: { startFrequency: number; endFrequency: number; points: number; freqUnit: 'hz' | 'rads' }): number[] {
  return Array.from({ length: draft.points }, (_, index) => draft.startFrequency + (draft.endFrequency - draft.startFrequency) * index / (draft.points - 1))
}

function validateDamping(value: unknown, system: 'sdof' | 'modal'): AnsysHarmonicStudyDraft['damping'] {
  const damping = record(value, 'damping')
  if (damping.kind === 'none') {
    exactKeys(damping, ['kind'], 'damping')
    return { kind: 'none' }
  }
  if (damping.kind === 'ratio') {
    exactKeys(damping, ['kind', 'value'], 'damping')
    return { kind: 'ratio', value: finite(damping.value, 'damping ratio', 0, 1000) }
  }
  if (damping.kind === 'coefficient' && system === 'sdof') {
    exactKeys(damping, ['kind', 'value'], 'damping')
    return { kind: 'coefficient', value: finite(damping.value, 'damping coefficient', 0, 1e12) }
  }
  if (damping.kind === 'rayleigh' && system === 'modal') {
    exactKeys(damping, ['kind', 'alpha', 'beta'], 'damping')
    return {
      kind: 'rayleigh', alpha: finite(damping.alpha, 'Rayleigh alpha', 0, 1e12),
      beta: finite(damping.beta, 'Rayleigh beta', 0, 1e12),
    }
  }
  fail(`unsupported ${system} damping selection`)
}

function validateDraft(value: unknown): AnsysHarmonicStudyDraft {
  const draft = record(value, 'Ansys harmonic study draft')
  if (draft.system === 'sdof') {
    exactKeys(draft, ['system', 'mass', 'stiffness', 'force', 'damping', 'startFrequency', 'endFrequency', 'points', 'freqUnit'], 'Ansys harmonic study draft')
    const damping = validateDamping(draft.damping, 'sdof') as AnsysHarmonicDampingDraft
    return {
      system: 'sdof', mass: finite(draft.mass, 'mass', Number.MIN_VALUE, 1e12),
      stiffness: finite(draft.stiffness, 'stiffness', Number.MIN_VALUE, 1e12),
      force: finite(draft.force, 'force', -1e12, 1e12), damping,
      ...sweep(draft.startFrequency, draft.endFrequency, draft.points, draft.freqUnit),
    }
  }
  if (draft.system !== 'modal') fail('system must be sdof or modal')
  exactKeys(draft, ['system', 'modes', 'force', 'damping', 'startFrequency', 'endFrequency', 'points', 'freqUnit'], 'Ansys harmonic study draft')
  const sw = sweep(draft.startFrequency, draft.endFrequency, draft.points, draft.freqUnit)
  if (!Array.isArray(draft.modes) || draft.modes.length < 1 || draft.modes.length > MAX_MODES) {
    fail(`modes must contain 1 to ${MAX_MODES} entries`)
  }
  const modes = draft.modes.map((value, i) => {
    const mode = record(value, `modes[${i}]`)
    exactKeys(mode, ['frequencyHz', 'shape', 'dampingRatio'], `modes[${i}]`)
    if (!Array.isArray(mode.shape) || mode.shape.length < 1 || mode.shape.length > MAX_DOFS) {
      fail(`modes[${i}].shape must contain 1 to ${MAX_DOFS} values`)
    }
    return {
      frequencyHz: finite(mode.frequencyHz, `modes[${i}].frequencyHz`, Number.MIN_VALUE, 1e9),
      shape: mode.shape.map((shape, j) => finite(shape, `modes[${i}].shape[${j}]`, -1e6, 1e6)),
      ...(mode.dampingRatio === undefined ? {} : { dampingRatio: finite(mode.dampingRatio, `modes[${i}].dampingRatio`, 0, 1000) }),
    }
  })
  const dofs = modes[0].shape.length
  if (modes.some(mode => mode.shape.length !== dofs)) fail('all modal shapes must have the same DOF count')
  if (!Array.isArray(draft.force) || draft.force.length !== dofs) fail(`force must contain exactly ${dofs} values`)
  const force = draft.force.map((load, i) => finite(load, `force[${i}]`, -1e12, 1e12))
  if (sw.points * dofs > MAX_SAMPLES) fail(`frequency-by-DOF samples exceed ${MAX_SAMPLES}`)
  if (sw.points * dofs * modes.length > MAX_TERMS) fail(`modal response terms exceed ${MAX_TERMS}`)
  return { system: 'modal', modes, force, damping: validateDamping(draft.damping, 'modal') as Extract<AnsysHarmonicStudyDraft, { system: 'modal' }>['damping'], ...sw }
}

export function createDefaultAnsysHarmonicStudy(): Extract<AnsysHarmonicStudyDraft, { system: 'sdof' }> {
  return {
    system: 'sdof', mass: 1, stiffness: 1000, force: 1,
    damping: { kind: 'ratio', value: 0.05 }, startFrequency: 0, endFrequency: 15, points: 4, freqUnit: 'hz',
  }
}

export function createDefaultAnsysModalHarmonicStudy(): Extract<AnsysHarmonicStudyDraft, { system: 'modal' }> {
  return {
    system: 'modal', modes: [{ frequencyHz: 5, shape: [1, 0] }],
    force: [1, 0], damping: { kind: 'ratio', value: 0.05 }, startFrequency: 0, endFrequency: 15, points: 4, freqUnit: 'hz',
  }
}

/** Validate a direct module payload against the exact subset emitted by this helper. */
export function validateAnsysHarmonicStudyInput(input: unknown): AnsysHarmonicStudyInput {
  const value = record(input, 'Ansys harmonic input')
  const common = ['module', 'backend', 'system', 'freqs', 'freqUnit']
  if (value.module !== MODULE_ID || value.backend !== 'host') fail(`input must select ${MODULE_ID} on host`)
  const nativeFreqs = (freqsValue: unknown, unitValue: unknown) => {
    if (!Array.isArray(freqsValue) || freqsValue.length < 2 || freqsValue.length > MAX_POINTS) fail(`freqs must contain 2 to ${MAX_POINTS} values`)
    const freqs = freqsValue.map((frequency, i) => finite(frequency, `freqs[${i}]`, 0, 1e9))
    const { startFrequency, endFrequency, points } = sweep(freqs[0], freqs[freqs.length - 1], freqs.length, unitValue)
    if (freqs.some((frequency, i) => Math.abs(frequency - (startFrequency + (endFrequency - startFrequency) * i / (points - 1))) > 1e-9 * Math.max(1, Math.abs(frequency)))) fail('freqs must be a uniform increasing sweep')
    return { startFrequency, endFrequency, points }
  }
  if (value.system === 'sdof') {
    exactKeys(value, [...common, 'mass', 'stiffness', 'force', 'dampingRatio', 'damping'], 'Ansys harmonic input')
    if (value.dampingRatio !== undefined && value.damping !== undefined) fail('choose dampingRatio or damping, not both')
    const freqDraft = nativeFreqs(value.freqs, value.freqUnit)
    const draft = validateDraft({
      system: 'sdof', mass: value.mass, stiffness: value.stiffness, force: value.force,
      damping: value.dampingRatio !== undefined ? { kind: 'ratio', value: value.dampingRatio }
        : value.damping !== undefined ? { kind: 'coefficient', value: value.damping } : { kind: 'none' },
      ...freqDraft, freqUnit: value.freqUnit,
    }) as Extract<AnsysHarmonicStudyDraft, { system: 'sdof' }>
    return {
      module: MODULE_ID, backend: 'host', system: 'sdof', mass: draft.mass,
      stiffness: draft.stiffness, force: draft.force,
      ...(draft.damping.kind === 'ratio' ? { dampingRatio: draft.damping.value }
        : draft.damping.kind === 'coefficient' ? { damping: draft.damping.value } : {}),
      freqs: expandSweep(draft), freqUnit: draft.freqUnit,
    }
  }
  if (value.system !== 'modal') fail('system must be sdof or modal')
  exactKeys(value, [...common, 'modes', 'force', 'dampingRatio', 'rayleigh'], 'Ansys harmonic input')
  if (value.dampingRatio !== undefined && value.rayleigh !== undefined) fail('choose dampingRatio or rayleigh, not both')
  if (!Array.isArray(value.modes)) fail('modes must be an array')
  const modes = value.modes.map((item, i) => {
    const mode = record(item, `modes[${i}]`)
    exactKeys(mode, ['frequencyHz', 'shape', 'dampingRatio'], `modes[${i}]`)
    return {
      frequencyHz: mode.frequencyHz,
      shape: mode.shape,
      ...(mode.dampingRatio === undefined ? {} : { dampingRatio: mode.dampingRatio }),
    }
  })
  let damping: Extract<AnsysHarmonicStudyDraft, { system: 'modal' }>['damping']
  if (value.rayleigh !== undefined) {
    const rayleigh = record(value.rayleigh, 'rayleigh')
    exactKeys(rayleigh, ['alpha', 'beta'], 'rayleigh')
    damping = {
      kind: 'rayleigh', alpha: finite(rayleigh.alpha, 'rayleigh.alpha', 0, 1e12),
      beta: finite(rayleigh.beta, 'rayleigh.beta', 0, 1e12),
    }
  } else if (value.dampingRatio !== undefined) damping = { kind: 'ratio', value: finite(value.dampingRatio, 'dampingRatio', 0, 1000) }
  else damping = { kind: 'none' }
  const freqDraft = nativeFreqs(value.freqs, value.freqUnit)
  const inputFreqs = value.freqs as number[]
  const draft = validateDraft({ system: 'modal', modes, force: value.force, damping,
    ...freqDraft, freqUnit: value.freqUnit }) as Extract<AnsysHarmonicStudyDraft, { system: 'modal' }>
  const validatedFreqs = inputFreqs as number[]
  return {
    module: MODULE_ID, backend: 'host', system: 'modal', modes: draft.modes,
    force: draft.force,
    ...(draft.damping.kind === 'ratio' ? { dampingRatio: draft.damping.value }
      : draft.damping.kind === 'rayleigh' ? { rayleigh: { alpha: draft.damping.alpha, beta: draft.damping.beta } } : {}),
    freqs: validatedFreqs, freqUnit: draft.freqUnit,
  }
}

export function createAnsysHarmonicStudyInput(draftValue: unknown): AnsysHarmonicStudyInput {
  const draft = validateDraft(draftValue)
  const common = { module: MODULE_ID, backend: 'host' as const, system: draft.system, freqs: expandSweep(draft), freqUnit: draft.freqUnit }
  if (draft.system === 'sdof') {
    return validateAnsysHarmonicStudyInput({
      ...common, mass: draft.mass, stiffness: draft.stiffness, force: draft.force,
      ...(draft.damping.kind === 'ratio' ? { dampingRatio: draft.damping.value }
        : draft.damping.kind === 'coefficient' ? { damping: draft.damping.value } : {}),
    })
  }
  return validateAnsysHarmonicStudyInput({
    ...common, modes: draft.modes, force: draft.force,
    ...(draft.damping.kind === 'ratio' ? { dampingRatio: draft.damping.value }
      : draft.damping.kind === 'rayleigh' ? { rayleigh: { alpha: draft.damping.alpha, beta: draft.damping.beta } } : {}),
  })
}
