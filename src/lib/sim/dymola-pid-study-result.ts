import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { PidStudyInput } from './dymola-pid-study-input'

export type PidStudyResult = {
  backend: string
  methodId: 'method-openmodelica-state-space'
  times: number[]
  output: number[]
}

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string, min = -Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${label} must be a finite number${Number.isFinite(min) ? ` >= ${min}` : ''}`)
  }
}

/** Read the native PI response as reported, preserving its submitted time grid and samples. */
export function readPidStudyResult(result: JobResultV1, input: PidStudyInput): PidStudyResult {
  const moduleResult = object(readModuleResult(result, input as unknown as ModuleComputeInput), 'Dymola PI module result')
  if (moduleResult.module !== 'sw-openmodelica-state-space-observers') {
    throw new Error('Dymola PI result module does not match the submitted study')
  }
  if (moduleResult.backend !== 'w-sim-cuda-host') {
    throw new Error('Dymola PI result must report the w-sim-cuda-host backend')
  }

  const payload = object(moduleResult.result, 'Dymola PI result payload')
  if (payload.methodId !== 'method-openmodelica-state-space' || payload.method !== 'state-space') {
    throw new Error('Dymola PI result method does not match the submitted state-space study')
  }
  if (payload.discrete !== false) throw new Error('Dymola PI result must report a continuous system')
  if (payload.finite !== true || payload.ok !== true) throw new Error('Dymola PI result must report a finite successful response')

  if (!Array.isArray(input.times) || !Array.isArray(payload.times) || payload.times.length !== input.times.length) {
    throw new Error('Dymola PI result time count does not match the submitted study')
  }
  const nativeTimes = payload.times
  const times = nativeTimes.map((time, index) => {
    finite(time, `Dymola PI result time ${index}`, 0)
    finite(input.times[index], `submitted Dymola PI time ${index}`, 0)
    if (index > 0 && time <= (nativeTimes[index - 1] as number)) {
      throw new Error('Dymola PI result times must be strictly ascending')
    }
    if (time !== input.times[index]) throw new Error(`Dymola PI result time ${index} does not match the submitted time grid`)
    return time
  })

  if (!Array.isArray(payload.y) || payload.y.length !== times.length) {
    throw new Error('Dymola PI result output row count does not match the submitted time grid')
  }
  const output = payload.y.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 1) throw new Error(`Dymola PI result y[${index}] must contain exactly one output`)
    finite(row[0], `Dymola PI result y[${index}][0]`)
    return row[0] as number
  })

  return { backend: moduleResult.backend, methodId: 'method-openmodelica-state-space', times, output }
}
