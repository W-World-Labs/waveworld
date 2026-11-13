/** A ray launched toward +z from the lens study's sampling plane. */
export interface LensRay {
  origin: [number, number, number]
  direction: [number, number, number]
}

/** Bounds and field angles for a deterministic center-plus-rings ray bundle. */
export interface LensRayBundleOptions {
  launchDistance: number
  launchRadius: number
  rings: number
  spokes: number
  fieldXDeg: number
  fieldYDeg: number
}

const OPTION_KEYS = [
  'launchDistance',
  'launchRadius',
  'rings',
  'spokes',
  'fieldXDeg',
  'fieldYDeg',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`)
  }
  return value
}

/**
 * Make a bounded, deterministic bundle sampled on a plane before the lens.
 * This is equal-weight center/ring sampling; it does not perform ray aiming.
 */
export function createLensRayBundle(options: LensRayBundleOptions): LensRay[] {
  if (!isRecord(options)) throw new TypeError('options must be an object')
  const keys = Object.keys(options)
  if (keys.length !== OPTION_KEYS.length || OPTION_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(options, key))) {
    throw new TypeError(`options must contain exactly: ${OPTION_KEYS.join(', ')}`)
  }

  const launchDistance = finiteNumber(options.launchDistance, 'launchDistance')
  const launchRadius = finiteNumber(options.launchRadius, 'launchRadius')
  const rings = finiteNumber(options.rings, 'rings')
  const spokes = finiteNumber(options.spokes, 'spokes')
  const fieldXDeg = finiteNumber(options.fieldXDeg, 'fieldXDeg')
  const fieldYDeg = finiteNumber(options.fieldYDeg, 'fieldYDeg')

  if (launchDistance < 0.001 || launchDistance > 10_000) {
    throw new RangeError('launchDistance must be between 0.001 and 10000 mm')
  }
  if (launchRadius <= 0 || launchRadius > 1_000) {
    throw new RangeError('launchRadius must be greater than 0 and at most 1000 mm')
  }
  if (!Number.isInteger(rings) || rings < 1 || rings > 4) {
    throw new RangeError('rings must be an integer from 1 to 4')
  }
  if (!Number.isInteger(spokes) || spokes < 4 || spokes > 16) {
    throw new RangeError('spokes must be an integer from 4 to 16')
  }
  if (fieldXDeg < -30 || fieldXDeg > 30) {
    throw new RangeError('fieldXDeg must be between -30 and 30 degrees')
  }
  if (fieldYDeg < -30 || fieldYDeg > 30) {
    throw new RangeError('fieldYDeg must be between -30 and 30 degrees')
  }

  const direction: [number, number, number] = [
    Math.tan((fieldXDeg * Math.PI) / 180),
    Math.tan((fieldYDeg * Math.PI) / 180),
    1,
  ]
  const z = -launchDistance
  const rays: LensRay[] = [{ origin: [0, 0, z], direction: [...direction] }]

  for (let ring = 1; ring <= rings; ring += 1) {
    const radius = (launchRadius * ring) / rings
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const angle = (2 * Math.PI * spoke) / spokes
      const snapCardinal = (value: number) => Math.abs(value) < radius * 1e-14 ? 0 : value
      rays.push({
        origin: [snapCardinal(radius * Math.cos(angle)), snapCardinal(radius * Math.sin(angle)), z],
        direction: [...direction],
      })
    }
  }

  return rays
}
