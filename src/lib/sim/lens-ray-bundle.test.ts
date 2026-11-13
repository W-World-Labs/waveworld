import { describe, expect, it } from 'vitest'
import { createLensRayBundle, type LensRayBundleOptions } from './lens-ray-bundle'

const DEFAULT_OPTIONS: LensRayBundleOptions = {
  launchDistance: 10,
  launchRadius: 1,
  rings: 1,
  spokes: 4,
  fieldXDeg: 0,
  fieldYDeg: 0,
}

describe('createLensRayBundle', () => {
  it('creates the deterministic five-ray default in the launch plane', () => {
    const rays = createLensRayBundle(DEFAULT_OPTIONS)

    expect(rays).toHaveLength(5)
    expect(rays.map(({ origin }) => origin)).toEqual([
      [0, 0, -10],
      [1, 0, -10],
      [0, 1, -10],
      [-1, 0, -10],
      [0, -1, -10],
    ])
    expect(rays.map(({ direction }) => direction)).toEqual(Array.from({ length: 5 }, () => [0, 0, 1]))
  })

  it('uses field angles for one common forward direction and tolerates cardinal trig error', () => {
    const rays = createLensRayBundle({ ...DEFAULT_OPTIONS, fieldXDeg: 30, fieldYDeg: -30 })
    const expected = [Math.tan(Math.PI / 6), -Math.tan(Math.PI / 6), 1]

    for (const ray of rays) {
      expect(ray.direction[0]).toBeCloseTo(expected[0], 14)
      expect(ray.direction[1]).toBeCloseTo(expected[1], 14)
      expect(ray.direction[2]).toBe(1)
      expect(ray.origin[2]).toBe(-10)
    }
    const x = [1, 0, -1, 0]
    const y = [0, 1, 0, -1]
    rays.slice(1).forEach(({ origin }, index) => {
      expect(origin[0]).toBeCloseTo(x[index], 14)
      expect(origin[1]).toBeCloseTo(y[index], 14)
    })
  })

  it('orders rings from inner to outer and spokes counterclockwise from +x', () => {
    const rays = createLensRayBundle({ ...DEFAULT_OPTIONS, launchRadius: 4, rings: 2, spokes: 4 })

    expect(rays).toHaveLength(9)
    expect(rays.slice(1, 5).map(({ origin }) => origin.slice(0, 2))).toEqual([
      [2, 0], [0, 2], [-2, 0], [0, -2],
    ])
    expect(rays.slice(5).map(({ origin }) => origin.slice(0, 2))).toEqual([
      [4, 0], [0, 4], [-4, 0], [0, -4],
    ])
  })

  it('keeps every supported ring and spoke combination within the 65-ray UI bound', () => {
    for (let rings = 1; rings <= 4; rings += 1) {
      for (let spokes = 4; spokes <= 16; spokes += 1) {
        const rays = createLensRayBundle({ ...DEFAULT_OPTIONS, rings, spokes })
        expect(rays).toHaveLength(1 + rings * spokes)
        expect(rays.length).toBeLessThanOrEqual(65)
      }
    }
    expect(createLensRayBundle({ ...DEFAULT_OPTIONS, rings: 4, spokes: 16 })).toHaveLength(65)
  })

  it('rejects out-of-bound and non-integer sampling options', () => {
    const invalidOptions: LensRayBundleOptions[] = [
      { ...DEFAULT_OPTIONS, launchDistance: 0 },
      { ...DEFAULT_OPTIONS, launchDistance: 10_001 },
      { ...DEFAULT_OPTIONS, launchRadius: 0 },
      { ...DEFAULT_OPTIONS, launchRadius: 1_001 },
      { ...DEFAULT_OPTIONS, rings: 0 },
      { ...DEFAULT_OPTIONS, rings: 1.5 },
      { ...DEFAULT_OPTIONS, rings: 5 },
      { ...DEFAULT_OPTIONS, spokes: 3 },
      { ...DEFAULT_OPTIONS, spokes: 4.5 },
      { ...DEFAULT_OPTIONS, spokes: 17 },
      { ...DEFAULT_OPTIONS, fieldXDeg: -31 },
      { ...DEFAULT_OPTIONS, fieldYDeg: 31 },
    ]

    for (const options of invalidOptions) expect(() => createLensRayBundle(options)).toThrow(RangeError)
  })

  it('rejects missing or unknown fields and non-finite values', () => {
    expect(() => createLensRayBundle({ ...DEFAULT_OPTIONS, extra: true } as LensRayBundleOptions)).toThrow(TypeError)
    const missingSpokes = {
      launchDistance: DEFAULT_OPTIONS.launchDistance,
      launchRadius: DEFAULT_OPTIONS.launchRadius,
      rings: DEFAULT_OPTIONS.rings,
      fieldXDeg: DEFAULT_OPTIONS.fieldXDeg,
      fieldYDeg: DEFAULT_OPTIONS.fieldYDeg,
    }
    expect(() => createLensRayBundle(missingSpokes as LensRayBundleOptions)).toThrow(TypeError)
    expect(() => createLensRayBundle({ ...DEFAULT_OPTIONS, spokes: undefined } as unknown as LensRayBundleOptions)).toThrow(RangeError)

    for (const field of ['launchDistance', 'launchRadius', 'rings', 'spokes', 'fieldXDeg', 'fieldYDeg'] as const) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(() => createLensRayBundle({ ...DEFAULT_OPTIONS, [field]: value })).toThrow(RangeError)
      }
    }
    expect(() => createLensRayBundle(null as unknown as LensRayBundleOptions)).toThrow(TypeError)
  })

  it('returns independent ray vectors and does not retain or mutate the options object', () => {
    const options = { ...DEFAULT_OPTIONS }
    const rays = createLensRayBundle(options)

    rays[0].origin[0] = 123
    rays[0].direction[0] = 456
    expect(rays[1].origin[0]).toBe(1)
    expect(rays[1].direction[0]).toBe(0)
    expect(options).toEqual(DEFAULT_OPTIONS)

    const later = createLensRayBundle(options)
    expect(later[0]).toEqual({ origin: [0, 0, -10], direction: [0, 0, 1] })
  })
})
