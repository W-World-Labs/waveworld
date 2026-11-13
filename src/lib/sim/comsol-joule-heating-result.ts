import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { ComsolJouleHeatingInput } from './comsol-joule-heating-input'

type RecordValue = Record<string, unknown>

export type ComsolJouleHeatingProfile = {
  x: number[]
  T: number[]
  V: number[]
  sigma: number[]
  E: number[]
  qDot: number[]
}

export type ComsolJouleHeatingResult = {
  backend: { id: 'w-sim-cuda-host'; kind: 'host-f64'; deviceName: 'w-sim-cuda-host' }
  result: {
    drive: 'current' | 'voltage'
    current: number
    voltageDrop: number
    currentDensity: number
    eFieldMean: number
    resistance: number
    resistanceNominal: number
    resistanceRatio: number
    power: number
    powerFromGeneration: number
    powerResidual: number
    qDotMax: number
    qDotMean: number
    sigma0: number
    alpha: number
    tRef: number
    thermalConductivity: number
    length: number
    area: number
    T0: number
    TL: number
    Tmax: number
    TmaxX: number
    selfHeating: boolean
    beta: number
    generationPerArea: number
    conductionPerArea: number
    energyBalanceResidual: number
    profile: ComsolJouleHeatingProfile
    ok: true
    methodId: 'method-algo-comsol-joule-heating-1d-coupled'
    familyId: 'method-comsol-joule-heating'
  }
}

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string, min = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${label} must be a finite number${min > -Infinity ? ` >= ${min}` : ''}`)
  }
  return value
}

function close(actual: number, expected: number, label: string, tolerance = 1e-8): void {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected))
  if (Math.abs(actual - expected) > tolerance * scale) {
    throw new Error(`Joule heating ${label} does not match the submitted study`)
  }
}

function profileArray(value: unknown, label: string, count: number, min = -Infinity): number[] {
  if (!Array.isArray(value) || value.length !== count) {
    throw new Error(`Joule heating profile ${label} must contain exactly ${count} samples`)
  }
  return value.map((entry, index) => finite(entry, `native profile ${label}[${index}]`, min))
}

/** Validate the released W-Sim DC Joule result and preserve its native values. */
export function readComsolJouleHeatingResult(
  jobResult: JobResultV1,
  input: ComsolJouleHeatingInput,
): ComsolJouleHeatingResult {
  if (input.module !== 'sw-comsol-joule-heating-b' || input.methodId !== 'method-algo-comsol-joule-heating-1d-coupled' || input.backend !== 'host' || input.mode !== 'joule') {
    throw new Error('Joule heating input must select the admitted host DC Joule method')
  }
  const output = object(readModuleResult(jobResult, input as unknown as ModuleComputeInput), 'Joule heating module result')
  if (output.module !== 'sw-comsol-joule-heating-b') throw new Error('Joule heating result module does not match the submitted study')

  const backend = object(output.backend, 'Joule heating backend provenance')
  if (backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64' || backend.deviceName !== 'w-sim-cuda-host') {
    throw new Error('Joule heating result must report the w-sim-cuda-host host-f64 backend')
  }

  const raw = object(output.result, 'Joule heating native payload')
  if (raw.ok !== true || raw.methodId !== 'method-algo-comsol-joule-heating-1d-coupled' || raw.familyId !== 'method-comsol-joule-heating') {
    throw new Error('Joule heating result does not report the successful native DC method and family')
  }
  const drive = 'current' in input ? 'current' : 'voltage'
  if (raw.drive !== drive) {
    throw new Error('Joule heating native drive does not match the submitted drive')
  }

  const current = finite(raw.current, 'native current', 0)
  const voltageDrop = finite(raw.voltageDrop, 'native voltage drop', 0)
  const currentDensity = finite(raw.currentDensity, 'native current density', 0)
  const eFieldMean = finite(raw.eFieldMean, 'native mean electric field', 0)
  const resistance = finite(raw.resistance, 'native resistance', Number.MIN_VALUE)
  const resistanceNominal = finite(raw.resistanceNominal, 'native nominal resistance', Number.MIN_VALUE)
  const resistanceRatio = finite(raw.resistanceRatio, 'native resistance ratio', Number.MIN_VALUE)
  const power = finite(raw.power, 'native power', 0)
  const powerFromGeneration = finite(raw.powerFromGeneration, 'native generated power', 0)
  const powerResidual = finite(raw.powerResidual, 'native power residual', 0)
  const qDotMax = finite(raw.qDotMax, 'native maximum volumetric generation', 0)
  const qDotMean = finite(raw.qDotMean, 'native mean volumetric generation', 0)
  const sigma0 = finite(raw.sigma0, 'native reference conductivity', Number.MIN_VALUE)
  const alpha = finite(raw.alpha, 'native temperature coefficient', 0)
  const tRef = finite(raw.tRef, 'native reference temperature', 0)
  const thermalConductivity = finite(raw.thermalConductivity, 'native thermal conductivity', Number.MIN_VALUE)
  const length = finite(raw.length, 'native conductor length', Number.MIN_VALUE)
  const area = finite(raw.area, 'native conductor area', Number.MIN_VALUE)
  const T0 = finite(raw.T0, 'native left endpoint temperature', 0)
  const TL = finite(raw.TL, 'native right endpoint temperature', 0)
  const Tmax = finite(raw.Tmax, 'native maximum temperature', 0)
  const TmaxX = finite(raw.TmaxX, 'native maximum temperature position', 0)
  if (raw.selfHeating !== true && raw.selfHeating !== false) throw new Error('Joule heating native self-heating flag must be boolean')
  const beta = finite(raw.beta, 'native thermal feedback coefficient', 0)
  const generationPerArea = finite(raw.generationPerArea, 'native generated power per area', 0)
  const conductionPerArea = finite(raw.conductionPerArea, 'native conducted power per area', 0)
  const energyBalanceResidual = finite(raw.energyBalanceResidual, 'native energy balance residual', 0)

  close(sigma0, input.sigma0, 'reference conductivity')
  close(alpha, input.alpha, 'temperature coefficient')
  close(tRef, input.T_ref, 'reference temperature')
  close(thermalConductivity, input.k, 'thermal conductivity')
  close(length, input.L, 'conductor length')
  close(area, input.area, 'conductor area')
  close(T0, input.T_0, 'left endpoint temperature')
  close(TL, input.T_L, 'right endpoint temperature')
  if ('current' in input) close(current, input.current!, 'current drive')
  else close(voltageDrop, input.voltage!, 'voltage drive')
  close(currentDensity, current / area, 'current density')
  close(eFieldMean, voltageDrop / length, 'mean electric field')
  if (current > 0) close(resistance, voltageDrop / current, 'resistance')
  close(resistanceRatio, resistance / resistanceNominal, 'resistance ratio')

  const profile = object(raw.profile, 'Joule heating native profile')
  const count = input.N
  if (!Number.isInteger(count) || count < 2 || count > 4096) throw new Error('Joule heating submitted profile count must be in [2, 4096]')
  const x = profileArray(profile.x, 'x', count)
  const T = profileArray(profile.T, 'T', count, 0)
  const V = profileArray(profile.V, 'V', count)
  const sigma = profileArray(profile.sigma, 'sigma', count, 0)
  const E = profileArray(profile.E, 'E', count, 0)
  const qDot = profileArray(profile.qDot, 'qDot', count, 0)
  if (sigma.some(value => value <= 0)) throw new Error('Joule heating native profile conductivity must be positive')
  close(x[0]!, 0, 'profile start position')
  close(x[count - 1]!, length, 'profile end position')
  close(T[0]!, T0, 'profile left endpoint')
  close(T[count - 1]!, TL, 'profile right endpoint')
  close(V[0]!, 0, 'profile reference potential')
  close(V[count - 1]!, -voltageDrop, 'profile voltage drop')
  for (let index = 0; index < count; index += 1) {
    close(x[index]!, length * index / (count - 1), `profile position ${index}`)
  }

  close(power, current * voltageDrop, 'electrical power')
  close(powerFromGeneration, generationPerArea * area, 'power from volumetric generation')
  close(powerResidual, Math.abs(power - powerFromGeneration), 'power residual')
  close(energyBalanceResidual, Math.abs(generationPerArea - conductionPerArea), 'energy balance residual')
  if (powerResidual > 1e-9 * Math.max(1, Math.abs(power))) throw new Error('Joule heating result exceeds its native power-closure tolerance')
  if (energyBalanceResidual > 1e-9 * Math.max(1, Math.abs(generationPerArea))) throw new Error('Joule heating result exceeds its native energy-balance tolerance')

  return {
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
    result: {
      drive,
      current, voltageDrop, currentDensity, eFieldMean, resistance, resistanceNominal, resistanceRatio,
      power, powerFromGeneration, powerResidual, qDotMax, qDotMean, sigma0, alpha, tRef,
      thermalConductivity, length, area, T0, TL, Tmax, TmaxX, selfHeating: raw.selfHeating, beta,
      generationPerArea, conductionPerArea, energyBalanceResidual,
      profile: { x, T, V, sigma, E, qDot },
      ok: true, methodId: 'method-algo-comsol-joule-heating-1d-coupled', familyId: 'method-comsol-joule-heating',
    },
  }
}
