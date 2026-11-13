import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { AnsysHarmonicStudyInput } from './ansys-harmonic-study-input'

export type AnsysHarmonicModeResult = {
  frequencyHz: number
  frequencyRads: number
  dampingRatio: number
  participationFactor: number | null
}

export type AnsysHarmonicSweepPoint = {
  freqHz: number
  freqRads: number
  response: Array<{ re: number; im: number }>
  amplitude: number[]
  phaseDeg: number[]
}

export type AnsysHarmonicStudyResult = {
  module: 'sw-ansys-harmonic-response'
  familyId: 'method-ansys-harmonic-response'
  methodId: 'method-mode-superposition'
  method: 'mode-superposition'
  backend: { id: 'host-f64'; kind: 'cpu'; deviceName: 'w-sim-cuda-host' }
  system: 'sdof' | 'modal'
  freqUnit: 'hz' | 'rads'
  nDof: number
  nModes: number
  excitation: 'force'
  dofs: number[]
  nPoints: number
  modes: AnsysHarmonicModeResult[] | null
  sdof: {
    mass: number
    stiffness: number
    dampingCoefficient: number
    dampingRatio: number
    naturalFrequencyHz: number
    naturalFrequencyRads: number
    staticResponse: number
  } | null
  sweep: AnsysHarmonicSweepPoint[]
  peak: { amplitude: number[]; frequencyHz: number[] }
  ok: true
}

type RecordValue = Record<string, unknown>
type Expected = { freqs: number[]; freqUnit: 'hz' | 'rads'; nDof: number; nModes: number; dofs: number[] }

function object(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function exactKeys(value: RecordValue, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unknown or missing fields`)
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function integer(value: unknown, label: string, minimum = 0): number {
  const n = finite(value, label)
  if (!Number.isInteger(n) || n < minimum) throw new Error(`${label} must be an integer >= ${minimum}`)
  return n
}

function numericArray(value: unknown, label: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${label} must contain exactly ${length} values`)
  return value.map((entry, index) => finite(entry, `${label}[${index}]`))
}

function close(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-12 * Math.max(1, Math.abs(actual), Math.abs(expected))) throw new Error(`${label} is inconsistent`)
}

function validateInput(input: AnsysHarmonicStudyInput): Expected {
  const raw = input as unknown as RecordValue
  if (raw.module !== 'sw-ansys-harmonic-response' || raw.backend !== 'host' || (raw.system !== 'sdof' && raw.system !== 'modal')) throw new Error('unsupported ANSYS harmonic study input')
  if (raw.freqUnit !== 'hz' && raw.freqUnit !== 'rads') throw new Error('submitted frequency unit must be hz or rads')
  if (!Array.isArray(raw.freqs) || raw.freqs.length < 2 || raw.freqs.length > 201) throw new Error('submitted frequencies must contain 2..201 values')
  const freqs = raw.freqs.map((value, index) => finite(value, `submitted frequency ${index}`))
  if (freqs.some((value, index) => value < 0 || (index > 0 && value <= freqs[index - 1]))) throw new Error('submitted frequencies must be non-negative and ascending')
  if (raw.system === 'sdof') {
    if (finite(raw.mass, 'submitted mass') <= 0 || finite(raw.stiffness, 'submitted stiffness') <= 0) throw new Error('submitted SDOF mass and stiffness must be positive')
    finite(raw.force, 'submitted force')
    if (raw.dampingRatio !== undefined && raw.damping !== undefined) throw new Error('submitted SDOF input has conflicting damping forms')
    if (raw.dampingRatio !== undefined && finite(raw.dampingRatio, 'submitted damping ratio') < 0) throw new Error('submitted damping ratio must be non-negative')
    if (raw.damping !== undefined && finite(raw.damping, 'submitted damping coefficient') < 0) throw new Error('submitted damping coefficient must be non-negative')
    return { freqs, freqUnit: raw.freqUnit, nDof: 1, nModes: 1, dofs: [0] }
  }
  if (raw.dampingRatio !== undefined && raw.rayleigh !== undefined) throw new Error('submitted modal input has conflicting damping forms')
  if (raw.dampingRatio !== undefined && finite(raw.dampingRatio, 'submitted damping ratio') < 0) throw new Error('submitted damping ratio must be non-negative')
  if (!Array.isArray(raw.modes) || raw.modes.length < 1 || raw.modes.length > 128) throw new Error('submitted modes must contain 1..128 values')
  const modes = raw.modes.map((entry, mode) => object(entry, `submitted mode ${mode}`))
  const firstShape = modes[0].shape
  if (!Array.isArray(firstShape) || firstShape.length < 1 || firstShape.length > 4096) throw new Error('submitted mode shapes must contain 1..4096 DOFs')
  const nDof = firstShape.length
  for (const [index, mode] of modes.entries()) {
    finite(mode.frequencyHz, `submitted mode ${index} frequency`)
    if ((mode.frequencyHz as number) <= 0 || !Array.isArray(mode.shape) || mode.shape.length !== nDof) throw new Error(`submitted mode ${index} dimensions or frequency are invalid`)
    mode.shape.forEach((value, dof) => finite(value, `submitted mode ${index} shape ${dof}`))
    if (mode.dampingRatio !== undefined && finite(mode.dampingRatio, `submitted mode ${index} damping ratio`) < 0) throw new Error(`submitted mode ${index} damping ratio is out of range`)
  }
  if (!Array.isArray(raw.force) || raw.force.length !== nDof) throw new Error(`submitted force must contain exactly ${nDof} DOFs`)
  raw.force.forEach((value, dof) => finite(value, `submitted force ${dof}`))
  if (raw.rayleigh !== undefined) {
    const rayleigh = object(raw.rayleigh, 'submitted Rayleigh damping')
    if (finite(rayleigh.alpha, 'submitted Rayleigh alpha') < 0 || finite(rayleigh.beta, 'submitted Rayleigh beta') < 0) throw new Error('submitted Rayleigh damping must be non-negative')
  }
  return { freqs, freqUnit: raw.freqUnit, nDof, nModes: modes.length, dofs: Array.from({ length: nDof }, (_, index) => index) }
}

/** Validate the JobResultV1 envelope, then the native harmonic result; this never solves locally. */
export function parseAnsysHarmonicStudyResult(remote: JobResultV1, input: AnsysHarmonicStudyInput): AnsysHarmonicStudyResult {
  const native = readModuleResult(remote, input as unknown as ModuleComputeInput)
  return parseAnsysHarmonicNativeOutput(native, input)
}

/** Validate an already-unwrapped payload from sw-ansys-harmonic-response. */
export function parseAnsysHarmonicNativeOutput(nativeOutput: unknown, input: AnsysHarmonicStudyInput): AnsysHarmonicStudyResult {
  const expected = validateInput(input)
  const output = object(nativeOutput, 'ANSYS harmonic result')
  exactKeys(output, ['module', 'familyId', 'methodId', 'backend', 'method', 'system', 'freqUnit', 'nDof', 'nModes', 'excitation', 'dofs', 'nPoints', 'modes', 'sdof', 'sweep', 'peak', 'ok'], 'ANSYS harmonic result')
  if (output.module !== 'sw-ansys-harmonic-response' || output.familyId !== 'method-ansys-harmonic-response' ||
      output.methodId !== 'method-mode-superposition' || output.method !== 'mode-superposition' || output.system !== input.system ||
      output.excitation !== 'force' || output.ok !== true) throw new Error('harmonic result identity or success status does not match the submitted study')
  const backend = object(output.backend, 'harmonic backend')
  exactKeys(backend, ['id', 'kind', 'deviceName'], 'harmonic backend')
  if (backend.id !== 'host-f64' || backend.kind !== 'cpu' || backend.deviceName !== 'w-sim-cuda-host') throw new Error('harmonic result backend provenance is invalid')
  if (output.freqUnit !== expected.freqUnit) throw new Error('harmonic frequency unit does not match the submitted study')
  if (integer(output.nDof, 'harmonic DOF count', 1) !== expected.nDof || integer(output.nModes, 'harmonic mode count', 1) !== expected.nModes) throw new Error('harmonic result dimensions do not match the submitted study')
  if (integer(output.nPoints, 'harmonic point count', 1) !== expected.freqs.length) throw new Error('harmonic result point count does not match the submitted sweep')
  const reportedDofs = numericArray(output.dofs, 'harmonic DOFs', expected.dofs.length)
  if (reportedDofs.some((dof, index) => !Number.isInteger(dof) || dof !== expected.dofs[index])) throw new Error('harmonic DOFs do not match the submitted study')

  let modes: AnsysHarmonicModeResult[] | null = null
  let sdof: AnsysHarmonicStudyResult['sdof'] = null
  if (input.system === 'sdof') {
    if (output.modes !== null) throw new Error('SDOF harmonic result must have null modal metadata')
    const value = object(output.sdof, 'harmonic SDOF metadata')
    exactKeys(value, ['mass', 'stiffness', 'dampingCoefficient', 'dampingRatio', 'naturalFrequencyHz', 'naturalFrequencyRads', 'staticResponse'], 'harmonic SDOF metadata')
    sdof = {
      mass: finite(value.mass, 'reported mass'), stiffness: finite(value.stiffness, 'reported stiffness'),
      dampingCoefficient: finite(value.dampingCoefficient, 'reported damping coefficient'), dampingRatio: finite(value.dampingRatio, 'reported damping ratio'),
      naturalFrequencyHz: finite(value.naturalFrequencyHz, 'reported natural frequency'),
      naturalFrequencyRads: finite(value.naturalFrequencyRads, 'reported natural angular frequency'), staticResponse: finite(value.staticResponse, 'reported static response'),
    }
    if (sdof.mass !== input.mass || sdof.stiffness !== input.stiffness) throw new Error('reported SDOF input metadata does not match the submitted study')
    if (input.dampingRatio !== undefined && sdof.dampingRatio !== input.dampingRatio) throw new Error('reported damping ratio does not match the submitted study')
    if (input.damping !== undefined && sdof.dampingCoefficient !== input.damping) throw new Error('reported damping coefficient does not match the submitted study')
    if (input.damping !== undefined && sdof.dampingRatio !== input.damping / (2 * Math.sqrt(input.mass * input.stiffness))) throw new Error('reported normalized damping ratio does not match the submitted coefficient')
    if (input.dampingRatio === undefined && input.damping === undefined && (sdof.dampingCoefficient !== 0 || sdof.dampingRatio !== 0)) throw new Error('reported damping metadata does not match the undamped submitted study')
  } else {
    if (output.sdof !== null || !Array.isArray(output.modes) || output.modes.length !== expected.nModes) throw new Error('modal result metadata does not match the submitted study')
    const submittedModes = input.modes!
    modes = output.modes.map((rawMode, index): AnsysHarmonicModeResult => {
      const mode = object(rawMode, `harmonic mode ${index}`)
      exactKeys(mode, ['frequencyHz', 'frequencyRads', 'dampingRatio', 'participationFactor'], `harmonic mode ${index}`)
      const frequencyHz = finite(mode.frequencyHz, `mode ${index} frequency`)
      const frequencyRads = finite(mode.frequencyRads, `mode ${index} angular frequency`)
      const dampingRatio = finite(mode.dampingRatio, `mode ${index} damping ratio`)
      if (frequencyHz !== submittedModes[index].frequencyHz) throw new Error(`mode ${index} frequency does not match the submitted study`)
      close(frequencyRads, 2 * Math.PI * frequencyHz, `mode ${index} angular frequency`)
      const expectedRatio = submittedModes[index].dampingRatio ?? input.dampingRatio ?? (input.rayleigh ? input.rayleigh.alpha / (2 * frequencyRads) + input.rayleigh.beta * frequencyRads / 2 : 0)
      if (dampingRatio !== expectedRatio) throw new Error(`mode ${index} damping metadata does not match the submitted study`)
      if (mode.participationFactor !== null) throw new Error(`mode ${index} participation factor is unexpected for force excitation`)
      return { frequencyHz, frequencyRads, dampingRatio, participationFactor: null }
    })
  }

  if (!Array.isArray(output.sweep) || output.sweep.length !== expected.freqs.length) throw new Error('harmonic sweep dimensions do not match the submitted frequency count')
  const sweep = output.sweep.map((rawPoint, index): AnsysHarmonicSweepPoint => {
    const point = object(rawPoint, `sweep point ${index}`)
    exactKeys(point, ['freqHz', 'freqRads', 'response', 'amplitude', 'phaseDeg'], `sweep point ${index}`)
    const freqHz = finite(point.freqHz, `sweep point ${index} frequency`)
    const freqRads = finite(point.freqRads, `sweep point ${index} angular frequency`)
    if (freqHz < 0 || freqRads < 0 || (expected.freqUnit === 'hz' ? freqHz !== expected.freqs[index] : freqRads !== expected.freqs[index])) throw new Error(`sweep point ${index} does not match the submitted frequency grid`)
    close(freqRads, 2 * Math.PI * freqHz, `sweep point ${index} angular frequency`)
    if (!Array.isArray(point.response) || point.response.length !== expected.dofs.length) throw new Error(`sweep point ${index} response dimension does not match the selected DOFs`)
    const response = point.response.map((rawValue, dof) => {
      const value = object(rawValue, `sweep point ${index} response ${dof}`)
      exactKeys(value, ['re', 'im'], `sweep point ${index} response ${dof}`)
      return { re: finite(value.re, `sweep point ${index} response ${dof} real part`), im: finite(value.im, `sweep point ${index} response ${dof} imaginary part`) }
    })
    const amplitude = numericArray(point.amplitude, `sweep point ${index} amplitude`, expected.dofs.length)
    const phaseDeg = numericArray(point.phaseDeg, `sweep point ${index} phase`, expected.dofs.length)
    if (amplitude.some(value => value < 0)) throw new Error(`sweep point ${index} amplitude is out of range`)
    return { freqHz, freqRads, response, amplitude, phaseDeg }
  })

  const peakValue = object(output.peak, 'harmonic peak')
  exactKeys(peakValue, ['amplitude', 'frequencyHz'], 'harmonic peak')
  const peak = {
    amplitude: numericArray(peakValue.amplitude, 'peak amplitude', expected.dofs.length),
    frequencyHz: numericArray(peakValue.frequencyHz, 'peak frequency', expected.dofs.length),
  }
  for (let dof = 0; dof < expected.dofs.length; dof += 1) {
    const maxAmplitude = Math.max(...sweep.map(point => point.amplitude[dof]))
    if (peak.amplitude[dof] !== maxAmplitude || peak.amplitude[dof] < 0) throw new Error(`harmonic peak amplitude for DOF ${dof} does not match the returned sweep`)
    if (maxAmplitude === 0 && peak.frequencyHz[dof] === 0) continue
    const index = sweep.findIndex(point => point.amplitude[dof] === maxAmplitude)
    if (peak.frequencyHz[dof] !== sweep[index].freqHz) throw new Error(`harmonic peak frequency for DOF ${dof} does not match the returned sweep`)
  }

  return {
    module: 'sw-ansys-harmonic-response', familyId: 'method-ansys-harmonic-response', methodId: 'method-mode-superposition',
    method: 'mode-superposition', backend: backend as AnsysHarmonicStudyResult['backend'], system: input.system,
    freqUnit: expected.freqUnit, nDof: expected.nDof, nModes: expected.nModes, excitation: 'force', dofs: reportedDofs,
    nPoints: expected.freqs.length, modes, sdof, sweep, peak, ok: true,
  }
}
