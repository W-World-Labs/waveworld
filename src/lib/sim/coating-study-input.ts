import type { JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, type ModuleComputeInput, type SwModuleInput } from './module-compute'

export type CoatingStudyDraft = {
  startWavelength: number
  stopWavelength: number
  samples: number
  n0: number
  ns: number
  ks: number
  theta: number
  polarization: 's' | 'p' | 'unpolarized'
  layers: Array<{ n: number; k: number; d: number }>
}

/** Exact native input for the thin-film coating reflectance/transmittance sweep. */
export type CoatingStudyInput = SwModuleInput & {
  module: 'sw-optics-thinfilm'
  method: 'method-algo-thinfilm-rt'
  backend: 'host'
  lambda0: number
  wavelengths: number[]
  n0: number
  ns: number
  ks: number
  theta: number
  polarization: 's' | 'p' | 'unpolarized'
  layers: Array<{ n: number; k: number; d: number }>
}

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
  for (const key of allowed) if (!(key in value)) fail(`${name}.${key} is required`)
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be a finite number in [${min}, ${max}]`)
  }
  return value
}

function validateDraft(draft: unknown): CoatingStudyDraft {
  const value = record(draft, 'Coating study draft')
  exactKeys(value, ['startWavelength', 'stopWavelength', 'samples', 'n0', 'ns', 'ks', 'theta', 'polarization', 'layers'], 'Coating study draft')
  const startWavelength = finite(value.startWavelength, 'Start wavelength (nm)', 100, 2500)
  const stopWavelength = finite(value.stopWavelength, 'Stop wavelength (nm)', 100, 2500)
  if (stopWavelength <= startWavelength) fail('Stop wavelength must be greater than start wavelength')
  const samples = finite(value.samples, 'Wavelength sample count', 3, 401)
  if (!Number.isInteger(samples)) fail('Wavelength sample count must be an integer')
  const n0 = finite(value.n0, 'Incident refractive index n0', 0.1, 10)
  const ns = finite(value.ns, 'Substrate refractive index ns', 0.1, 10)
  const ks = finite(value.ks, 'Substrate extinction coefficient ks', 0, 10)
  const theta = finite(value.theta, 'Angle of incidence (degrees)', 0, 89.9)
  if (value.polarization !== 's' && value.polarization !== 'p' && value.polarization !== 'unpolarized') {
    fail('Polarization must be s, p, or unpolarized')
  }
  if (!Array.isArray(value.layers) || value.layers.length > 16) fail('Coating study must contain at most 16 layers')
  const layers = value.layers.map((raw, index) => {
    const layer = record(raw, `Layer ${index + 1}`)
    exactKeys(layer, ['n', 'k', 'd'], `Layer ${index + 1}`)
    return {
      n: finite(layer.n, `Layer ${index + 1} refractive index n`, 0.1, 10),
      k: finite(layer.k, `Layer ${index + 1} extinction coefficient k`, 0, 10),
      d: finite(layer.d, `Layer ${index + 1} thickness (nm)`, 0, 10000),
    }
  })
  return {
    startWavelength, stopWavelength, samples, n0, ns, ks, theta,
    polarization: value.polarization,
    layers,
  }
}

export function createDefaultCoatingStudyDraft(): CoatingStudyDraft {
  return {
    startWavelength: 400,
    stopWavelength: 700,
    samples: 31,
    n0: 1,
    ns: 1.52,
    ks: 0,
    theta: 0,
    polarization: 'unpolarized',
    layers: [{ n: 2.1, k: 0, d: 100 }],
  }
}

export function createCoatingStudyJob(draft: CoatingStudyDraft): { input: CoatingStudyInput; spec: JobSpecV1 } {
  const valid = validateDraft(draft)
  const wavelengths = Array.from({ length: valid.samples }, (_, index) => {
    if (index === 0) return valid.startWavelength
    if (index === valid.samples - 1) return valid.stopWavelength
    return valid.startWavelength + (valid.stopWavelength - valid.startWavelength) * index / (valid.samples - 1)
  })
  const input: CoatingStudyInput = {
    module: 'sw-optics-thinfilm',
    method: 'method-algo-thinfilm-rt',
    backend: 'host',
    lambda0: (valid.startWavelength + valid.stopWavelength) / 2,
    wavelengths,
    n0: valid.n0,
    ns: valid.ns,
    ks: valid.ks,
    theta: valid.theta,
    polarization: valid.polarization,
    layers: valid.layers,
  }
  return { input, spec: createModuleJobSpec(input as ModuleComputeInput) }
}
