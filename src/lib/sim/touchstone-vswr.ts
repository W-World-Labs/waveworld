import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, readModuleResult, type ModuleComputeInput } from './module-compute'
import { TOUCHSTONE_MAX_PORTS, type TouchstoneNetwork } from './touchstone'

export type ComplexPair = [number, number]

export type TouchstoneVswrInput = {
  module: 'vswr'
  backend: 'host'
  operation: 'cst-s11-vswr-sweep'
  frequenciesHz: number[]
  s11: ComplexPair[]
}

export type TouchstoneVswrResult = {
  points: Array<{
    frequencyHz: number
    s11: ComplexPair
    magnitude: number
    vswr: number
    returnLossDb: number | null
    reflectedPowerFraction: number
  }>
  maxVswr: number
  meanReflectedPowerFraction: number
  backend: Record<string, unknown>
}

const MAX_POINTS = 4096
const OPERATION = 'cst-s11-vswr-sweep'

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function finite(value: unknown, label: string, min = -Infinity, max = Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite${Number.isFinite(min) || Number.isFinite(max) ? ` in [${min}, ${max}]` : ''}`)
  }
}

function close(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-10 * Math.max(1, Math.abs(expected))) throw new Error(`${label} does not match submitted S11 data`)
}

function validateNetwork(value: TouchstoneNetwork): TouchstoneNetwork {
  const network = object(value, 'Touchstone network')
  const keys = ['fileName', 'ports', 'frequencyUnit', 'format', 'referenceOhms', 'referenceImpedancesOhms', 'points']
  for (const key of Object.keys(network)) if (!keys.includes(key)) throw new Error(`Touchstone network contains unsupported field '${key}'`)
  if (typeof network.fileName !== 'string' || !network.fileName.trim()) throw new Error('Touchstone filename is required')
  const ports = network.ports
  if (typeof ports !== 'number' || !Number.isInteger(ports) || ports < 1 || ports > TOUCHSTONE_MAX_PORTS) {
    throw new Error(`Touchstone ports must be an integer from 1 to ${TOUCHSTONE_MAX_PORTS}`)
  }
  if (!['Hz', 'kHz', 'MHz', 'GHz'].includes(network.frequencyUnit as string)) throw new Error('Touchstone frequency unit is unsupported')
  if (!['RI', 'MA', 'DB'].includes(network.format as string)) throw new Error('Touchstone format is unsupported')
  finite(network.referenceOhms, 'Touchstone reference impedance', Number.MIN_VALUE)
  if (network.referenceImpedancesOhms !== undefined) {
    if (!Array.isArray(network.referenceImpedancesOhms) || network.referenceImpedancesOhms.length !== ports) {
      throw new Error(`Touchstone per-port reference impedances must contain one value for each of ${ports} ports`)
    }
    network.referenceImpedancesOhms.forEach((value, index) => finite(value, `Touchstone port ${index + 1} reference impedance`, Number.MIN_VALUE))
    if (network.referenceImpedancesOhms[0] !== network.referenceOhms) {
      throw new Error('Touchstone referenceOhms must match the port 1 reference impedance')
    }
  }
  if (!Array.isArray(network.points) || network.points.length < 1 || network.points.length > MAX_POINTS) {
    throw new Error(`Touchstone points must contain 1..${MAX_POINTS} records`)
  }
  let previous = 0
  network.points.forEach((point, index) => {
    const row = object(point, `Touchstone point ${index}`)
    for (const key of Object.keys(row)) if (!['frequencyHz', 's'].includes(key)) throw new Error(`Touchstone point ${index} contains unsupported field '${key}'`)
    finite(row.frequencyHz, `Touchstone frequency ${index}`, Number.MIN_VALUE)
    if ((row.frequencyHz as number) <= previous) throw new Error('Touchstone frequencies must be strictly increasing')
    previous = row.frequencyHz as number
    if (!Array.isArray(row.s) || row.s.length !== ports * ports) throw new Error(`Touchstone point ${index} has the wrong S-parameter dimension`)
    row.s.forEach((pair, pairIndex) => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`Touchstone point ${index} S-parameter ${pairIndex} must be a complex pair`)
      finite(pair[0], `Touchstone point ${index} S-parameter ${pairIndex} real`)
      finite(pair[1], `Touchstone point ${index} S-parameter ${pairIndex} imaginary`)
    })
    const s11 = row.s[0] as number[]
    if (!Number.isFinite(Math.hypot(s11[0], s11[1])) || Math.hypot(s11[0], s11[1]) >= 1) {
      throw new Error(`Touchstone S11 magnitude at point ${index} must be less than one for VSWR`)
    }
  })
  return value
}

export function createTouchstoneVswrJob(network: TouchstoneNetwork): { input: TouchstoneVswrInput; spec: JobSpecV1 } {
  const submitted = validateNetwork(network)
  const input: TouchstoneVswrInput = {
    module: 'vswr',
    backend: 'host',
    operation: OPERATION,
    frequenciesHz: submitted.points.map(point => point.frequencyHz),
    // Every admitted network stores S11 first; only this pair enters the job.
    s11: submitted.points.map(point => [point.s[0][0], point.s[0][1]]),
  }
  return { input, spec: createModuleJobSpec(input as unknown as ModuleComputeInput) }
}

export function readTouchstoneVswrResult(result: JobResultV1, submittedNetwork: TouchstoneNetwork): TouchstoneVswrResult {
  const network = validateNetwork(submittedNetwork)
  const input = {
    module: 'vswr', backend: 'host', operation: OPERATION,
    frequenciesHz: network.points.map(point => point.frequencyHz),
    s11: network.points.map(point => [point.s[0][0], point.s[0][1]]),
  } as unknown as ModuleComputeInput
  const output = object(readModuleResult(result, input), 'VSWR module result')
  if (output.module !== 'vswr' || output.operation !== OPERATION) throw new Error('VSWR result module or operation does not match the requested analysis')
  const backend = object(output.backend, 'VSWR backend provenance')
  if (backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64') throw new Error('VSWR result must report the pinned w-sim-cuda-host host-f64 backend')

  const data = object(output.result, 'VSWR result payload')
  if (!Number.isInteger(data.sampleCount) || data.sampleCount !== network.points.length) throw new Error('VSWR result sample count does not match submitted Touchstone data')
  if (!Array.isArray(data.points) || data.points.length !== network.points.length) throw new Error('VSWR result point dimensions do not match submitted Touchstone data')
  let maxVswr = 1
  let powerSum = 0
  const points = data.points.map((raw, index) => {
    const point = object(raw, `VSWR result point ${index}`)
    const source = network.points[index]
    finite(point.frequencyHz, `VSWR result frequency ${index}`, Number.MIN_VALUE)
    if (!Array.isArray(point.s11) || point.s11.length !== 2) throw new Error(`VSWR result S11 ${index} has invalid dimensions`)
    finite(point.s11[0], `VSWR result S11 ${index} real`); finite(point.s11[1], `VSWR result S11 ${index} imaginary`)
    const rho = Math.hypot(point.s11[0], point.s11[1])
    finite(point.magnitude, `VSWR magnitude ${index}`, 0, 1)
    finite(point.vswr, `VSWR ratio ${index}`, 1)
    finite(point.reflectedPowerFraction, `VSWR reflected power ${index}`, 0, 1)
    if (point.returnLossDb !== null) finite(point.returnLossDb, `VSWR return loss ${index}`, 0)
    if (rho === 0 && point.returnLossDb !== null) throw new Error(`VSWR return loss ${index} must be null for an ideal match`)
    if (rho !== 0 && point.returnLossDb === null) throw new Error(`VSWR return loss ${index} must be finite unless S11 is an ideal match`)
    if (point.frequencyHz !== source.frequencyHz) throw new Error(`VSWR result frequency ${index} does not match submitted Touchstone data`)
    if (point.s11[0] !== source.s[0][0] || point.s11[1] !== source.s[0][1]) throw new Error(`VSWR result S11 ${index} does not match submitted Touchstone data`)
    close(point.magnitude, rho, `VSWR magnitude ${index}`)
    close(point.vswr, (1 + rho) / (1 - rho), `VSWR ratio ${index}`)
    close(point.reflectedPowerFraction, rho * rho, `VSWR reflected power ${index}`)
    if (rho !== 0) {
      close(point.returnLossDb as number, -20 * Math.log10(rho), `VSWR return loss ${index}`)
    }
    maxVswr = Math.max(maxVswr, point.vswr)
    powerSum += point.reflectedPowerFraction
    return {
      frequencyHz: point.frequencyHz,
      s11: [point.s11[0], point.s11[1]] as ComplexPair,
      magnitude: point.magnitude,
      vswr: point.vswr,
      returnLossDb: point.returnLossDb as number | null,
      reflectedPowerFraction: point.reflectedPowerFraction,
    }
  })
  finite(data.maxVswr, 'VSWR maximum', 1)
  finite(data.meanReflectedPowerFraction, 'VSWR mean reflected power', 0, 1)
  close(data.maxVswr, maxVswr, 'VSWR maximum')
  close(data.meanReflectedPowerFraction, powerSum / points.length, 'VSWR mean reflected power')
  return { points, maxVswr: data.maxVswr, meanReflectedPowerFraction: data.meanReflectedPowerFraction, backend }
}
