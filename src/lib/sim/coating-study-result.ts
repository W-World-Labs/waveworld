import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { CoatingStudyInput } from './coating-study-input'

export type CoatingSweepSample = {
  lambda: number
  Rs: number
  Ts: number
  As: number
  Rp: number
  Tp: number
  Ap: number
  R: number
  T: number
  A: number
  energyResidual: number
}

export type CoatingStudyResult = {
  backend: { id: 'w-sim-cuda-host'; deviceName: 'w-sim-cuda-host'; kind?: 'host-f64' }
  spectrum: CoatingSweepSample[]
}

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

/** Validate native coating samples and provenance without recalculating optical physics. */
export function readCoatingStudyResult(result: JobResultV1, submitted: CoatingStudyInput): CoatingStudyResult {
  if (submitted.module !== 'sw-optics-thinfilm' || submitted.method !== 'method-algo-thinfilm-rt' || submitted.backend !== 'host') {
    throw new Error('coating input must select the host thin-film R/T method')
  }
  const output = object(readModuleResult(result, submitted as unknown as ModuleComputeInput), 'coating module result')
  if (output.ok === false || output.module !== 'sw-optics-thinfilm') {
    throw new Error('coating result does not report a successful matching native module')
  }

  const backend = object(output.backend, 'coating backend provenance')
  if (backend.id !== 'w-sim-cuda-host' || backend.deviceName !== 'w-sim-cuda-host' || (backend.kind !== undefined && backend.kind !== 'host-f64')) {
    throw new Error('coating result must report the w-sim-cuda-host host backend')
  }

  const raw = object(output.result, 'coating result payload')
  if (raw.ok !== true || raw.methodId !== 'method-algo-thinfilm-rt' || raw.familyId !== 'method-sw-optics-thinfilm') {
    throw new Error('coating result does not report the requested method and family')
  }
  if (raw.polarization !== submitted.polarization) throw new Error('coating result polarization does not match the submitted study')
  if (!Array.isArray(raw.spectrum)) throw new Error('coating result spectrum must be an array')
  if (!Array.isArray(submitted.wavelengths) || raw.spectrum.length !== submitted.wavelengths.length) {
    throw new Error('coating result sweep count does not match the submitted wavelengths')
  }

  const keys = ['Rs', 'Ts', 'As', 'Rp', 'Tp', 'Ap', 'R', 'T', 'A', 'energyResidual'] as const
  const spectrum = raw.spectrum.map((item, index): CoatingSweepSample => {
    const row = object(item, `coating sweep sample ${index}`)
    finite(row.lambda, `coating sweep sample ${index} wavelength`)
    if (row.lambda !== submitted.wavelengths[index]) throw new Error(`coating sweep wavelength ${index} does not match the submitted order`)
    const values = {} as Record<typeof keys[number], number>
    for (const key of keys) {
      finite(row[key], `coating sweep sample ${index} ${key}`, key === 'energyResidual' ? -Infinity : 0, key === 'energyResidual' ? Infinity : 1)
      values[key] = row[key] as number
    }
    // Native ENERGY_TOL is 1e-9. Preserve its residual and selected R/T/A verbatim.
    if (Math.abs(values.energyResidual) > 1e-9) throw new Error(`coating sweep sample ${index} exceeds the native energy tolerance`)
    return { lambda: row.lambda, ...values }
  })

  return {
    backend: {
      id: 'w-sim-cuda-host', deviceName: 'w-sim-cuda-host',
      ...(backend.kind === 'host-f64' ? { kind: 'host-f64' as const } : {}),
    },
    spectrum,
  }
}
