import type { JobSpecV1 } from '@w-sim/contracts'
import { createLensRayBundle, type LensRayBundleOptions } from './lens-ray-bundle'
import { createModuleJobSpec } from './module-compute'
import type { NativeAlgorithmInput } from './native-algorithm'

export type LensSurfaceDraft = {
  type: 'plane' | 'spherical'
  radius: number
  aperture: number
  thickness: number
  nAfter: number
}

export type LensStudyDraft = {
  ambientIndex: number
  surfaces: LensSurfaceDraft[]
  bundle: LensRayBundleOptions
  imageDistance: number
}

/** Exact native lens-design operation input. */
export type LensTraceInput = Extract<NativeAlgorithmInput, { module: 'lens-design' }> & {
  surfaces: Array<{
    type: 'plane' | 'spherical'
    R?: number
    n1: number
    n2: number
    aperture: number
    thickness: number
  }>
  rays: Array<{ origin: [number, number, number]; direction: [number, number, number] }>
  imageDistance: number
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

function finite(value: unknown, name: string, min: number, max: number, exclusiveMin = false): number {
  if (typeof value !== 'number') fail(`${name} must be a finite number`)
  if (!Number.isFinite(value) || (exclusiveMin ? value <= min : value < min) || value > max) {
    fail(`${name} must be a finite number ${exclusiveMin ? '>' : '>='} ${min} and <= ${max}`)
  }
  return value
}

function validateDraft(draft: unknown): LensStudyDraft {
  const value = record(draft, 'Lens study draft')
  exactKeys(value, ['ambientIndex', 'surfaces', 'bundle', 'imageDistance'], 'Lens study draft')
  const ambientIndex = finite(value.ambientIndex, 'Ambient refractive index', 1, 3)
  const imageDistance = finite(value.imageDistance, 'Image distance (mm)', 0, 10000)
  const rawSurfaces = value.surfaces
  if (!Array.isArray(rawSurfaces) || rawSurfaces.length < 1 || rawSurfaces.length > 8) fail('Lens study must contain 1 to 8 surfaces')
  rawSurfaces.forEach((raw, index) => {
    const surface = record(raw, `Surface ${index + 1}`)
    exactKeys(surface, ['type', 'radius', 'aperture', 'thickness', 'nAfter'], `Surface ${index + 1}`)
    if (surface.type !== 'plane' && surface.type !== 'spherical') fail(`Surface ${index + 1} type must be plane or spherical`)
    const radius = finite(surface.radius, `Surface ${index + 1} radius (mm)`, -1e6, 1e6)
    const aperture = finite(surface.aperture, `Surface ${index + 1} aperture (mm)`, 0, 1000, true)
    if (surface.type === 'spherical' && (radius === 0 || aperture >= Math.abs(radius))) {
      fail(`Surface ${index + 1} spherical radius must be nonzero and larger than its aperture`)
    }
    const thickness = finite(surface.thickness, `Surface ${index + 1} thickness (mm)`, index === rawSurfaces.length - 1 ? 0 : 0.001, 10000, index !== rawSurfaces.length - 1)
    if (index === rawSurfaces.length - 1 && thickness !== 0) fail('Final surface thickness must be 0 mm')
    finite(surface.nAfter, `Surface ${index + 1} refractive index after`, 1, 3)
  })
  // The ray-bundle builder owns the exact option bounds and checks every field.
  createLensRayBundle(value.bundle as LensRayBundleOptions)
  return { ambientIndex, surfaces: draftSurfaces(rawSurfaces), bundle: value.bundle as LensRayBundleOptions, imageDistance }
}

function draftSurfaces(values: unknown[]): LensSurfaceDraft[] {
  return values.map((raw, index) => {
    const surface = record(raw, `Surface ${index + 1}`)
    return {
      type: surface.type as LensSurfaceDraft['type'],
      radius: surface.radius as number,
      aperture: surface.aperture as number,
      thickness: surface.thickness as number,
      nAfter: surface.nAfter as number,
    }
  })
}

export function createDefaultLensStudy(): LensStudyDraft {
  return {
    ambientIndex: 1,
    surfaces: [
      { type: 'plane', radius: 0, aperture: 5, thickness: 5, nAfter: 1.5 },
      { type: 'plane', radius: 0, aperture: 5, thickness: 0, nAfter: 1 },
    ],
    bundle: { launchDistance: 10, launchRadius: 1, rings: 1, spokes: 4, fieldXDeg: 0, fieldYDeg: 0 },
    imageDistance: 20,
  }
}

export function createLensStudyJob(draft: LensStudyDraft): { input: LensTraceInput; spec: JobSpecV1 } {
  const validated = validateDraft(draft)
  let n1 = validated.ambientIndex
  const surfaces = validated.surfaces.map(surface => {
    const nativeSurface = {
      type: surface.type,
      ...(surface.type === 'spherical' ? { R: surface.radius } : {}),
      n1,
      n2: surface.nAfter,
      aperture: surface.aperture,
      thickness: surface.thickness,
    }
    n1 = surface.nAfter
    return nativeSurface
  })
  const input = validateLensTraceInput({
    module: 'lens-design',
    method: 'geometric-ray-trace',
    backend: 'host',
    surfaces,
    rays: createLensRayBundle(validated.bundle),
    imageDistance: validated.imageDistance,
  })
  return { input, spec: createModuleJobSpec(input as NativeAlgorithmInput) }
}

/** Strictly validate native inputs so saved submissions and result readers share one boundary. */
export function validateLensTraceInput(input: unknown): LensTraceInput {
  const value = record(input, 'Lens trace input')
  exactKeys(value, ['module', 'method', 'backend', 'surfaces', 'rays', 'imageDistance'], 'Lens trace input')
  if (value.module !== 'lens-design' || value.method !== 'geometric-ray-trace' || value.backend !== 'host') {
    fail('Lens trace input must select lens-design geometric-ray-trace on host')
  }
  finite(value.imageDistance, 'Image distance (mm)', 0, 10000)
  const nativeSurfaces = value.surfaces
  if (!Array.isArray(nativeSurfaces) || nativeSurfaces.length < 1 || nativeSurfaces.length > 8) fail('Lens trace input must contain 1 to 8 surfaces')
  let previousN2: number | undefined
  nativeSurfaces.forEach((raw, index) => {
    const surface = record(raw, `Native surface ${index + 1}`)
    if (surface.type !== 'plane' && surface.type !== 'spherical') fail(`Native surface ${index + 1} type must be plane or spherical`)
    exactKeys(surface, surface.type === 'plane' ? ['type', 'n1', 'n2', 'aperture', 'thickness'] : ['type', 'R', 'n1', 'n2', 'aperture', 'thickness'], `Native surface ${index + 1}`)
    const n1 = finite(surface.n1, `Native surface ${index + 1} n1`, 1, 3)
    const n2 = finite(surface.n2, `Native surface ${index + 1} n2`, 1, 3)
    const aperture = finite(surface.aperture, `Native surface ${index + 1} aperture (mm)`, 0, 1000, true)
    const thickness = finite(surface.thickness, `Native surface ${index + 1} thickness (mm)`, index === nativeSurfaces.length - 1 ? 0 : 0.001, 10000, index !== nativeSurfaces.length - 1)
    if (index === nativeSurfaces.length - 1 && thickness !== 0) fail('Final native surface thickness must be 0 mm')
    if (surface.type === 'spherical') {
      const radius = finite(surface.R, `Native surface ${index + 1} radius (mm)`, -1e6, 1e6)
      if (radius === 0 || aperture >= Math.abs(radius)) fail(`Native surface ${index + 1} radius must be nonzero and larger than its aperture`)
    }
    if (previousN2 !== undefined && n1 !== previousN2) fail(`Native surface ${index + 1} n1 must equal the previous surface n2`)
    previousN2 = n2
  })
  const nativeRays = value.rays
  if (!Array.isArray(nativeRays) || nativeRays.length < 1 || nativeRays.length > 65) fail('Lens trace input must contain 1 to 65 rays')
  nativeRays.forEach((raw, index) => {
    const ray = record(raw, `Ray ${index + 1}`)
    exactKeys(ray, ['origin', 'direction'], `Ray ${index + 1}`)
    for (const field of ['origin', 'direction'] as const) {
      const vector = ray[field]
      if (!Array.isArray(vector) || vector.length !== 3) fail(`Ray ${index + 1} ${field} must contain three numbers`)
      vector.forEach((component: unknown, componentIndex: number) => finite(component, `Ray ${index + 1} ${field}[${componentIndex}]`, -1e6, 1e6))
    }
    const direction = ray.direction as unknown[]
    const directionComponents = direction.map((component, componentIndex) => finite(component, `Ray ${index + 1} direction[${componentIndex}]`, -1e6, 1e6))
    if (Math.hypot(...directionComponents) === 0) fail(`Ray ${index + 1} direction must be nonzero`)
    if (directionComponents[2] <= 0) fail(`Ray ${index + 1} direction must point forward with direction z > 0`)
  })
  return input as LensTraceInput
}
