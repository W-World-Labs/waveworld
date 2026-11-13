import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { PemfcPolarizationInput } from './pemfc-study-input'

export type PemfcNativeResult = {
  T: number
  pH2: number
  pO2: number
  pH2O: number
  E0: number
  E0T: number
  j: number
  j0: number
  alpha: number
  n: number
  R: number
  jLim: number
  thermalVoltage: number
  E_nernst: number
  eta_act: number
  eta_ohm: number
  eta_conc: number
  V: number
  powerDensity: number
  voltageEfficiency: number
  curve: { current: number[]; voltage: number[]; power: number[] }
  units: 'V; current density A/cm^2; R ohm cm^2; power density W/cm^2'
  method: 'polarization'
  ok: true
  methodId: 'method-algo-pemfc-polarization'
  familyId: 'method-pemfc'
  scopeNote: string
}

export type PemfcStudyResult = {
  backend: { id: string; kind: string; deviceName: string }
  result: PemfcNativeResult
}

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string, min = -Infinity, max = Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number${Number.isFinite(min) || Number.isFinite(max) ? ` in [${min}, ${max}]` : ''}`)
  }
}

function close(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected))) {
    throw new Error(`PEMFC study ${label} is inconsistent`)
  }
}

/** Validate the native polarization payload and provenance without reproducing its electrochemistry. */
export function readPemfcStudyResult(jobResult: JobResultV1, input: PemfcPolarizationInput): PemfcStudyResult {
  const output = object(readModuleResult(jobResult, input as unknown as ModuleComputeInput), 'PEMFC module result')
  if (output.module !== 'sw-comsol-pemfc') throw new Error('PEMFC result module does not match the submitted study')

  const backend = object(output.backend, 'PEMFC backend provenance')
  if (backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64' || backend.deviceName !== 'w-sim-cuda-host') {
    throw new Error('PEMFC result must report the w-sim-cuda-host host-f64 backend')
  }

  const raw = object(output.result, 'PEMFC polarization payload')
  if (raw.ok !== true || raw.method !== 'polarization' || raw.methodId !== 'method-algo-pemfc-polarization' || raw.familyId !== 'method-pemfc') {
    throw new Error('PEMFC result does not report a successful polarization operation with matching method provenance')
  }
  if (typeof raw.scopeNote !== 'string' || !raw.scopeNote.trim()) throw new Error('PEMFC result must include its native scope note')
  if (raw.units !== 'V; current density A/cm^2; R ohm cm^2; power density W/cm^2') throw new Error('PEMFC result units do not match the native contract')

  const values: Record<string, number> = {}
  for (const key of ['T', 'pH2', 'pO2', 'pH2O', 'E0', 'E0T', 'j', 'j0', 'alpha', 'n', 'R', 'jLim', 'thermalVoltage', 'E_nernst', 'eta_act', 'eta_ohm', 'eta_conc', 'V', 'powerDensity', 'voltageEfficiency']) {
    finite(raw[key], `PEMFC ${key}`)
    values[key] = raw[key] as number
  }

  for (const key of ['T', 'pH2', 'pO2', 'pH2O', 'E0', 'j', 'j0', 'alpha', 'n', 'R', 'jLim'] as const) {
    if (values[key] !== input[key]) throw new Error(`PEMFC result ${key} does not echo the submitted input`)
  }
  if (values.thermalVoltage <= 0 || values.E_nernst <= 0) throw new Error('PEMFC thermal voltage and Nernst voltage must be positive')
  for (const key of ['eta_act', 'eta_ohm', 'eta_conc'] as const) {
    if (values[key] < 0) throw new Error(`PEMFC ${key} must be non-negative`)
  }
  finite(values.V, 'PEMFC cell voltage', 0, values.E_nernst)
  finite(values.voltageEfficiency, 'PEMFC voltage efficiency', 0, 1)
  close(values.V, Math.max(0, values.E_nernst - values.eta_act - values.eta_ohm - values.eta_conc), 'scalar voltage energy account')
  close(values.powerDensity, values.j * values.V, 'scalar power density')
  close(values.voltageEfficiency, values.V / values.E_nernst, 'scalar voltage efficiency')

  const curve = object(raw.curve, 'PEMFC polarization curve')
  const currentValue = curve.current
  const voltageValue = curve.voltage
  const powerValue = curve.power
  if (!Array.isArray(currentValue) || !Array.isArray(voltageValue) || !Array.isArray(powerValue)) {
    throw new Error('PEMFC curve current, voltage and power must be arrays')
  }
  const currents: unknown[] = currentValue
  const voltages: unknown[] = voltageValue
  const powers: unknown[] = powerValue
  if (currents.length !== input.points || voltages.length !== input.points || powers.length !== input.points) {
    throw new Error('PEMFC curve arrays must match the submitted number of points')
  }
  for (let i = 0; i < input.points; i += 1) {
    finite(currents[i], `PEMFC curve current[${i}]`, 0, input.imax)
    finite(voltages[i], `PEMFC curve voltage[${i}]`, 0, values.E_nernst)
    finite(powers[i], `PEMFC curve power[${i}]`, 0)
    const expectedCurrent = i * input.imax / (input.points - 1)
    close(currents[i] as number, expectedCurrent, `curve current grid at ${i}`)
    if (i > 0 && (currents[i] as number) <= (currents[i - 1] as number)) throw new Error('PEMFC curve current grid must be strictly ordered')
    close(powers[i] as number, (currents[i] as number) * (voltages[i] as number), `curve power at ${i}`)
  }
  close(voltages[0] as number, values.E_nernst, 'open-circuit voltage')
  close(powers[0] as number, 0, 'open-circuit power')

  if (values.j === 0) {
    for (const key of ['eta_act', 'eta_ohm', 'eta_conc'] as const) close(values[key], 0, `zero-current ${key}`)
    close(values.V, values.E_nernst, 'zero-current voltage')
  }
  for (let i = 0; i < input.points; i += 1) {
    if (Math.abs((currents[i] as number) - values.j) <= 1e-9 * Math.max(1, values.j)) {
      close(voltages[i] as number, values.V, 'scalar and curve voltage')
      close(powers[i] as number, values.powerDensity, 'scalar and curve power')
    }
  }

  return {
    backend: { id: backend.id as string, kind: backend.kind as string, deviceName: backend.deviceName as string },
    result: {
      T: values.T, pH2: values.pH2, pO2: values.pO2, pH2O: values.pH2O,
      E0: values.E0, E0T: values.E0T, j: values.j, j0: values.j0, alpha: values.alpha,
      n: values.n, R: values.R, jLim: values.jLim, thermalVoltage: values.thermalVoltage,
      E_nernst: values.E_nernst, eta_act: values.eta_act, eta_ohm: values.eta_ohm,
      eta_conc: values.eta_conc, V: values.V, powerDensity: values.powerDensity,
      voltageEfficiency: values.voltageEfficiency,
      curve: { current: currents as number[], voltage: voltages as number[], power: powers as number[] },
      units: raw.units as PemfcNativeResult['units'], method: 'polarization', ok: true,
      methodId: 'method-algo-pemfc-polarization', familyId: 'method-pemfc', scopeNote: raw.scopeNote,
    },
  }
}
