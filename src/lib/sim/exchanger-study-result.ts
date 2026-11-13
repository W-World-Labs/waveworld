import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { ExchangerSweepInput } from './exchanger-study-input'

export type ExchangerStudyCase = {
  model: 'steady-effectiveness-NTU'
  arrangement: 'counterflow' | 'parallel'
  Chot: number
  Ccold: number
  UA: number
  Cmin: number
  Cmax: number
  Cr: number
  NTU: number
  effectiveness: number
  T_hot_in: number
  T_cold_in: number
  Q: number
  T_hot_out: number
  T_cold_out: number
  hotLoss: number
  coldGain: number
  energyBalance: 'hotLoss == coldGain == Q'
  methodId: 'method-algo-sw-openmodelica-heat-exchanger'
  familyId: 'method-sw-openmodelica-heat-exchanger'
}

export type ExchangerStudyResult = { backend: string; cases: ExchangerStudyCase[] }

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string, min = -Infinity, max = Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite${Number.isFinite(min) || Number.isFinite(max) ? ` in [${min}, ${max}]` : ''}`)
  }
}

function close(actual: number, expected: number, label: string, scale = Math.max(Math.abs(actual), Math.abs(expected), 1)): void {
  if (Math.abs(actual - expected) > 1e-9 * scale) throw new Error(`exchanger study ${label} is inconsistent`)
}

/** Validate the pinned native sweep payload and its provenance without solving exchanger physics in the client. */
export function readExchangerStudyResult(result: JobResultV1, input: ExchangerSweepInput): ExchangerStudyResult {
  const output = object(readModuleResult(result, input as unknown as ModuleComputeInput), 'exchanger module result')
  if (output.ok !== true || output.module !== 'sw-openmodelica-heat-exchanger') {
    throw new Error('exchanger result does not report a successful matching native module')
  }
  if (typeof output.backend !== 'string' || output.backend !== 'w-sim-cuda-host') {
    throw new Error('exchanger result must report the w-sim-cuda-host backend')
  }

  const payload = object(output.result, 'exchanger sweep payload')
  if (payload.model !== 'steady-effectiveness-NTU-UA-parameter-sweep' || payload.parameter !== 'UA') {
    throw new Error('exchanger result model or sweep parameter does not match the requested study')
  }
  if (payload.methodId !== 'method-algo-sw-openmodelica-heat-exchanger' || payload.familyId !== 'method-sw-openmodelica-heat-exchanger') {
    throw new Error('exchanger result method or family does not match the pinned native method')
  }
  if (!Array.isArray(payload.cases) || payload.cases.length !== input.sweep_UA.length) {
    throw new Error('exchanger result case count does not match the submitted sweep')
  }

  const cases = payload.cases.map((raw, index): ExchangerStudyCase => {
    const row = object(raw, `exchanger case ${index}`)
    if (row.model !== 'steady-effectiveness-NTU' || row.arrangement !== input.arrangement) {
      throw new Error(`exchanger case ${index} model or arrangement does not match the submitted study`)
    }
    if (row.methodId !== 'method-algo-sw-openmodelica-heat-exchanger' || row.familyId !== 'method-sw-openmodelica-heat-exchanger') {
      throw new Error(`exchanger case ${index} method or family does not match the pinned native method`)
    }

    const positive = (key: string, max = 1e9): number => {
      finite(row[key], `exchanger case ${index} ${key}`, 1e-6, max)
      return row[key] as number
    }
    const Chot = positive('Chot')
    const Ccold = positive('Ccold')
    const UA = positive('UA')
    const Cmin = positive('Cmin')
    const Cmax = positive('Cmax')
    finite(row.Cr, `exchanger case ${index} Cr`, 0, 1)
    finite(row.NTU, `exchanger case ${index} NTU`, 1e-6, 1e6)
    finite(row.effectiveness, `exchanger case ${index} effectiveness`, 0, 1)
    for (const key of ['T_hot_in', 'T_cold_in', 'Q', 'T_hot_out', 'T_cold_out', 'hotLoss', 'coldGain']) {
      finite(row[key], `exchanger case ${index} ${key}`)
    }
    if (row.energyBalance !== 'hotLoss == coldGain == Q') throw new Error(`exchanger case ${index} has no recognized energy balance declaration`)

    if (Chot !== input.Chot || Ccold !== input.Ccold || row.T_hot_in !== input.T_hot_in || row.T_cold_in !== input.T_cold_in) {
      throw new Error(`exchanger case ${index} conditions do not match the submitted study`)
    }
    if (UA !== input.sweep_UA[index]) throw new Error(`exchanger case ${index} UA is out of submitted order or does not match`)
    if ((row.T_hot_in as number) < (row.T_cold_in as number) || (row.Q as number) < 0) throw new Error(`exchanger case ${index} violates the submitted hot-to-cold temperature direction`)

    const expectedMin = Math.min(Chot, Ccold)
    const expectedMax = Math.max(Chot, Ccold)
    close(Cmin, expectedMin, `case ${index} Cmin`, expectedMax)
    close(Cmax, expectedMax, `case ${index} Cmax`, expectedMax)
    close(row.Cr as number, Cmin / Cmax, `case ${index} Cr`)
    close(row.NTU as number, UA / Cmin, `case ${index} NTU`, Math.max(1, UA / Cmin))
    const qHot = Chot * ((row.T_hot_in as number) - (row.T_hot_out as number))
    const qCold = Ccold * ((row.T_cold_out as number) - (row.T_cold_in as number))
    const energyScale = Math.max(1, Math.abs(row.Q as number), Math.abs(qHot), Math.abs(qCold), Chot * Math.abs((row.T_hot_in as number) - (row.T_hot_out as number)), Ccold * Math.abs((row.T_cold_out as number) - (row.T_cold_in as number)))
    close(row.hotLoss as number, qHot, `case ${index} hot outlet energy`, energyScale)
    close(row.coldGain as number, qCold, `case ${index} cold outlet energy`, energyScale)
    close(row.hotLoss as number, row.Q as number, `case ${index} hot loss`, energyScale)
    close(row.coldGain as number, row.Q as number, `case ${index} cold gain`, energyScale)

    return {
      model: 'steady-effectiveness-NTU', arrangement: row.arrangement as ExchangerStudyCase['arrangement'],
      Chot, Ccold, UA, Cmin, Cmax, Cr: row.Cr as number, NTU: row.NTU as number,
      effectiveness: row.effectiveness as number, T_hot_in: row.T_hot_in as number,
      T_cold_in: row.T_cold_in as number, Q: row.Q as number,
      T_hot_out: row.T_hot_out as number, T_cold_out: row.T_cold_out as number,
      hotLoss: row.hotLoss as number, coldGain: row.coldGain as number,
      energyBalance: 'hotLoss == coldGain == Q', methodId: 'method-algo-sw-openmodelica-heat-exchanger',
      familyId: 'method-sw-openmodelica-heat-exchanger',
    }
  })

  return { backend: output.backend, cases }
}
