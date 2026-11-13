import {
  createPspiceAcJob,
  PSPICE_AC_MAX_FREQUENCY_HZ,
  PSPICE_AC_MIN_FREQUENCY_HZ,
  type MnaAcInput,
  type PspiceAcResult,
  type PspiceAcStudyInput,
} from './pspice-ac-adapter'
import type { JobSpecV1 } from '@w-sim/contracts'

export type PspiceAcSweepConfig = {
  scale: 'linear' | 'log'
  startFrequencyHz: number
  stopFrequencyHz: number
  points: number
}

export type PspiceAcSweepStudyInput = Omit<PspiceAcStudyInput, 'frequencyHz'> & {
  sweep: PspiceAcSweepConfig
}

export type PspiceAcSweepPlanPoint = {
  frequencyHz: number
  input: MnaAcInput
  spec: JobSpecV1
  nodeMap: Record<string, number>
}

export type PspiceAcSweepResultRow = {
  frequencyHz: number
  input: MnaAcInput
  spec: JobSpecV1
  nodeMap: Record<string, number>
  result: PspiceAcResult
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${label} contains unsupported field '${key}'`)
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

/** Build one independent, normalized native AC job for each sweep frequency. */
export function buildPspiceAcSweepPlan(study: PspiceAcSweepStudyInput): PspiceAcSweepPlanPoint[] {
  const input = object(study, 'PSpice AC sweep study')
  exactKeys(input, ['circuit', 'nodeLabels', 'sweep'], 'PSpice AC sweep study')

  const sweep = object(input.sweep, 'PSpice AC sweep config')
  exactKeys(sweep, ['scale', 'startFrequencyHz', 'stopFrequencyHz', 'points'], 'PSpice AC sweep config')
  if (sweep.scale !== 'linear' && sweep.scale !== 'log') {
    throw new Error("PSpice AC sweep scale must be 'linear' or 'log'")
  }
  const start = sweep.startFrequencyHz
  const stop = sweep.stopFrequencyHz
  if (typeof start !== 'number' || !Number.isFinite(start)
      || typeof stop !== 'number' || !Number.isFinite(stop)
      || start < PSPICE_AC_MIN_FREQUENCY_HZ || stop > PSPICE_AC_MAX_FREQUENCY_HZ
      || start >= stop) {
    throw new Error(`PSpice AC sweep endpoints must be ascending and within [${PSPICE_AC_MIN_FREQUENCY_HZ}, ${PSPICE_AC_MAX_FREQUENCY_HZ}] Hz`)
  }
  const points = sweep.points
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 2 || points > 31) {
    throw new Error('PSpice AC sweep points must be an integer from 2 to 31')
  }

  const count = points as number
  const frequencies = Array.from({ length: count }, (_, index) => {
    if (index === 0) return start as number
    if (index === count - 1) return stop as number
    const fraction = index / (count - 1)
    return sweep.scale === 'linear'
      ? (start as number) + ((stop as number) - (start as number)) * fraction
      : (start as number) * Math.pow((stop as number) / (start as number), fraction)
  })
  for (let index = 0; index < frequencies.length; index += 1) {
    const frequency = frequencies[index]
    if (!Number.isFinite(frequency) || (index > 0 && frequency <= frequencies[index - 1])) {
      throw new Error('PSpice AC sweep frequencies must be finite and strictly increasing')
    }
  }

  return frequencies.map(frequencyHz => {
    const job = createPspiceAcJob({ circuit: study.circuit, nodeLabels: study.nodeLabels, frequencyHz })
    return deepFreeze({ frequencyHz, input: job.input, spec: job.spec, nodeMap: job.nodeMap })
  })
}
