import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, readModuleResult, type ModuleComputeInput } from './module-compute'
import { parseTouchstone, type ComplexPair, type TouchstoneNetwork } from './touchstone'

export type TouchstoneExportFrequencyUnit = 'HZ' | 'KHZ' | 'MHZ' | 'GHZ'
export type TouchstoneExportFormat = 'RI' | 'MA' | 'DB'
export type TouchstoneNativeComplex = { re: number; im: number }

export type TouchstoneNetworkExportOptions = {
  frequencyUnit: TouchstoneExportFrequencyUnit
  format: TouchstoneExportFormat
  title?: string
}

export type TouchstoneNetworkExportInput = {
  module: 'sw-ansys-touchstone'
  backend: 'host'
  method: 'touchstone'
  ports: number
  freqUnit: TouchstoneExportFrequencyUnit
  param: 'S'
  format: TouchstoneExportFormat
  ref: number
  freqs: number[]
  // Native complex cells use `{re, im}` objects. Multiport samples carry the
  // full N×N matrix; the native module owns Touchstone's wire ordering.
  sweep: Array<TouchstoneNativeComplex | TouchstoneNativeComplex[][]>
  title?: string
}

export type TouchstoneNetworkExportResult = {
  touchstone: string
  ports: number
  param: 'S'
  format: TouchstoneExportFormat
  freqUnit: TouchstoneExportFrequencyUnit
  ref: number
  nPoints: number
  freqMinHz: number
  freqMaxHz: number
  bytes: number
  lines: number
  ok: true
  backend: { id: 'host-f64'; kind: 'cpu'; deviceName: 'w-sim-cuda-host' }
  familyId: 'method-ansys-touchstone'
  methodId: 'method-algo-touchstone-export'
}

const MAX_POINTS = 4096
const MAX_SWEEP_CELLS = 8192
const UNIT_LABEL: Record<TouchstoneExportFrequencyUnit, TouchstoneNetwork['frequencyUnit']> = {
  HZ: 'Hz',
  KHZ: 'kHz',
  MHZ: 'MHz',
  GHZ: 'GHz',
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function finite(value: unknown, label: string, min = -Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`${label} must be finite${Number.isFinite(min) ? ` and at least ${min}` : ''}`)
}

function validateNetwork(value: TouchstoneNetwork): TouchstoneNetwork {
  const fields = object(value, 'Touchstone network')
  const keys = ['fileName', 'ports', 'frequencyUnit', 'format', 'referenceOhms', 'referenceImpedancesOhms', 'points']
  for (const key of Object.keys(fields)) if (!keys.includes(key)) throw new Error(`Touchstone network contains unsupported field '${key}'`)
  const fileName = fields.fileName
  if (typeof fileName !== 'string' || !fileName.trim()) throw new Error('Touchstone filename is required')
  const ports = fields.ports
  if (typeof ports !== 'number' || !Number.isInteger(ports) || ports < 1) throw new Error('Touchstone ports must be a positive integer')
  if (ports > 4) throw new Error(`Unsupported Touchstone export: ${ports}-port networks exceed the 4-port native export limit`)
  const frequencyUnit = fields.frequencyUnit
  if (typeof frequencyUnit !== 'string' || !new Set(['Hz', 'kHz', 'MHz', 'GHz']).has(frequencyUnit)) throw new Error('Touchstone frequency unit is unsupported')
  const format = fields.format
  if (typeof format !== 'string' || !new Set(['RI', 'MA', 'DB']).has(format)) throw new Error('Touchstone format is unsupported')
  finite(fields.referenceOhms, 'Touchstone reference impedance', Number.MIN_VALUE)
  const referenceImpedancesOhms = fields.referenceImpedancesOhms
  if (referenceImpedancesOhms !== undefined) {
    if (!Array.isArray(referenceImpedancesOhms) || referenceImpedancesOhms.length !== ports) {
      throw new Error(`Touchstone per-port reference impedances must contain one value for each of ${ports} ports`)
    }
    referenceImpedancesOhms.forEach((reference, index) => finite(reference, `Touchstone port ${index + 1} reference impedance`, Number.MIN_VALUE))
    if (referenceImpedancesOhms[0] !== fields.referenceOhms) {
      throw new Error('Touchstone referenceOhms must match the port 1 reference impedance')
    }
    if (referenceImpedancesOhms.some(reference => reference !== referenceImpedancesOhms[0])) {
      throw new Error('Native Touchstone export requires one common reference impedance for all ports; nonuniform per-port references cannot be represented in Touchstone 1.0 output')
    }
  }
  const points = fields.points
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_POINTS) {
    throw new Error(`Touchstone points must contain 1..${MAX_POINTS} records`)
  }
  const sweepCells = points.length * ports * ports
  if (sweepCells > MAX_SWEEP_CELLS) {
    throw new Error(`Touchstone export exceeds the ${MAX_SWEEP_CELLS}-cell sweep budget (${sweepCells} cells)`)
  }
  let previous = 0
  points.forEach((point, index) => {
    const row = object(point, `Touchstone point ${index}`)
    for (const key of Object.keys(row)) if (!['frequencyHz', 's'].includes(key)) throw new Error(`Touchstone point ${index} contains unsupported field '${key}'`)
    const frequencyHz = row.frequencyHz
    finite(frequencyHz, `Touchstone frequency ${index}`, Number.MIN_VALUE)
    if (frequencyHz <= previous) throw new Error('Touchstone frequencies must be strictly increasing')
    previous = frequencyHz
    const samples = row.s
    if (!Array.isArray(samples) || samples.length !== ports ** 2) throw new Error(`Touchstone point ${index} must contain the full ${ports}×${ports} S matrix`)
    samples.forEach((pair, pairIndex) => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`Touchstone point ${index} S-parameter ${pairIndex} must be a complex pair`)
      finite(pair[0], `Touchstone point ${index} S-parameter ${pairIndex} real`)
      finite(pair[1], `Touchstone point ${index} S-parameter ${pairIndex} imaginary`)
    })
  })
  return value
}

function validateOptions(options: TouchstoneNetworkExportOptions): TouchstoneNetworkExportOptions {
  const value = object(options, 'Touchstone export options')
  for (const key of Object.keys(value)) if (!['frequencyUnit', 'format', 'title'].includes(key)) throw new Error(`Touchstone export options contain unsupported field '${key}'`)
  if (!['HZ', 'KHZ', 'MHZ', 'GHZ'].includes(value.frequencyUnit as string)) throw new Error('Touchstone export frequencyUnit must be HZ, KHZ, MHZ, or GHZ')
  if (!['RI', 'MA', 'DB'].includes(value.format as string)) throw new Error('Touchstone export format must be RI, MA, or DB')
  if (value.title !== undefined && (typeof value.title !== 'string' || [...value.title].length > 1024 || /[^\x20-\x7e]/.test(value.title))) {
    throw new Error('Touchstone export title must contain at most 1024 printable ASCII characters')
  }
  return options
}

function fullMatrix(sample: ComplexPair[], ports: number): TouchstoneNativeComplex[][] {
  const copy = (pair: ComplexPair): TouchstoneNativeComplex => ({ re: pair[0], im: pair[1] })
  // The imported Touchstone two-port vector is S11,S21,S12,S22. The native
  // API accepts row/column matrices and performs that special ordering itself.
  if (ports === 2) return [[copy(sample[0]), copy(sample[2])], [copy(sample[1]), copy(sample[3])]]
  return Array.from({ length: ports }, (_, row) => sample.slice(row * ports, (row + 1) * ports).map(copy))
}

export function createTouchstoneNetworkExportJob(
  networkValue: TouchstoneNetwork,
  optionsValue: TouchstoneNetworkExportOptions,
): { input: TouchstoneNetworkExportInput; spec: JobSpecV1 } {
  const network = validateNetwork(networkValue)
  const options = validateOptions(optionsValue)
  const input: TouchstoneNetworkExportInput = {
    module: 'sw-ansys-touchstone',
    backend: 'host',
    method: 'touchstone',
    ports: network.ports,
    freqUnit: options.frequencyUnit,
    param: 'S',
    format: options.format,
    ref: network.referenceOhms,
    freqs: network.points.map(point => point.frequencyHz),
    sweep: network.points.map(point => network.ports === 1
      ? { re: point.s[0][0], im: point.s[0][1] }
      : fullMatrix(point.s, network.ports)),
    ...(options.title === undefined ? {} : { title: options.title }),
  }
  return { input, spec: createModuleJobSpec(input as unknown as ModuleComputeInput) }
}

function close(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-8 * Math.max(1, Math.abs(expected))) throw new Error(`${label} does not match submitted network metadata`)
}

export function readTouchstoneNetworkExportResult(
  result: JobResultV1,
  submittedInput: TouchstoneNetworkExportInput,
): TouchstoneNetworkExportResult {
  const input = object(submittedInput, 'Submitted Touchstone export input') as unknown as TouchstoneNetworkExportInput
  if (input.module !== 'sw-ansys-touchstone' || input.backend !== 'host' || input.method !== 'touchstone' || input.param !== 'S') throw new Error('Submitted job is not the expected Touchstone S-parameter export')
  const output = object(readModuleResult(result, input as unknown as ModuleComputeInput), 'Touchstone export module result')
  if (output.module !== 'sw-ansys-touchstone') throw new Error('Touchstone export result module does not match the request')
  if (output.familyId !== 'method-ansys-touchstone' || output.methodId !== 'method-algo-touchstone-export') throw new Error('Touchstone export result family or method provenance does not match the native exporter')
  const backend = object(output.backend, 'Touchstone export backend provenance')
  if (backend.id !== 'host-f64' || backend.kind !== 'cpu' || backend.deviceName !== 'w-sim-cuda-host') throw new Error('Touchstone export result must report the expected native host-f64 backend')
  // The native Touchstone module emits its metadata flat on moduleResult; it
  // does not wrap this payload in a second `result` object.
  const payload = output
  if (payload.ok !== true) throw new Error('Touchstone native result must report ok=true')
  if (payload.ports !== input.ports || payload.param !== 'S' || payload.format !== input.format || payload.freqUnit !== input.freqUnit || payload.ref !== input.ref) {
    throw new Error('Touchstone result metadata does not match the submitted export options')
  }
  const freqs = input.freqs
  if (!Array.isArray(freqs) || freqs.length < 1 || !Array.isArray(input.sweep) || input.sweep.length !== freqs.length) throw new Error('Submitted Touchstone sweep dimensions are invalid')
  if (payload.nPoints !== freqs.length) throw new Error('Touchstone result point count does not match the submitted sweep')
  finite(payload.freqMinHz, 'Touchstone result minimum frequency', Number.MIN_VALUE)
  finite(payload.freqMaxHz, 'Touchstone result maximum frequency', Number.MIN_VALUE)
  close(payload.freqMinHz, freqs[0], 'Touchstone minimum frequency')
  close(payload.freqMaxHz, freqs[freqs.length - 1], 'Touchstone maximum frequency')
  if (typeof payload.touchstone !== 'string' || !payload.touchstone.length) throw new Error('Touchstone result must contain nonempty Touchstone text')
  const bytes = new TextEncoder().encode(payload.touchstone).byteLength
  if (bytes > 512 * 1024) throw new Error('Touchstone result exceeds the 512 KiB validation limit')
  if (payload.bytes !== bytes) throw new Error('Touchstone result byte count does not match its text')
  const lines = payload.touchstone.split('\n').length - (payload.touchstone.endsWith('\n') ? 1 : 0)
  if (payload.lines !== lines) throw new Error('Touchstone result line count does not match its text')
  const fileName = `native-export.s${input.ports}p`
  const parsed = parseTouchstone(payload.touchstone, fileName)
  if (parsed.ports !== input.ports || parsed.frequencyUnit !== UNIT_LABEL[input.freqUnit] || parsed.format !== input.format || parsed.referenceOhms !== input.ref || parsed.points.length !== freqs.length) {
    throw new Error('Touchstone text header or dimensions do not match native result metadata')
  }
  parsed.points.forEach((point, index) => close(point.frequencyHz, freqs[index], `Touchstone text frequency ${index}`))
  const expectedLines = freqs.length * (input.ports > 2 ? input.ports : 1) + 2
  if (lines !== expectedLines) throw new Error('Touchstone text line count does not match its port and point dimensions')
  return {
    touchstone: payload.touchstone,
    ports: input.ports,
    param: 'S',
    format: input.format,
    freqUnit: input.freqUnit,
    ref: input.ref,
    nPoints: freqs.length,
    freqMinHz: payload.freqMinHz as number,
    freqMaxHz: payload.freqMaxHz as number,
    bytes,
    lines,
    ok: true,
    backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
    familyId: 'method-ansys-touchstone',
    methodId: 'method-algo-touchstone-export',
  }
}
