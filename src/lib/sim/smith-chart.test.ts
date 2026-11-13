import { describe, it, expect } from 'vitest'
import { cAbs, cReal, powerReflection, vswr } from './impedance-match-algos'
import {
  METHOD_SMITH,
  METHOD_ALGO_SMITH_CHART,
  SMITH_PARENT,
  SMITH_METHOD_IDS,
  gammaFromNormalizedZ,
  gammaFromZ,
  normalizedZFromGamma,
  zFromGamma,
  normalizeZ,
  resistanceCircle,
  reactanceCircle,
  conductanceCircle,
  vswrCircle,
  gammaMagFromVswr,
  sampleResistanceArc,
  sampleReactanceArc,
  buildSmithGrid,
  rotateGammaTowardGenerator,
  propagateGamma,
  sampleLinePath,
  addSeriesReactance,
  addShuntSusceptance,
  sampleSeriesReactancePath,
  smithReadout,
  clampGammaToUnitDisk,
  pixelToGamma,
  gammaToPixel,
  cFromPolar,
  cPhase,
  runSmithChartSample,
} from './smith-chart'

describe('Smith chart · Γ ↔ z geometry', () => {
  it('method id constants', () => {
    expect(METHOD_SMITH).toBe('method-impedance-match')
    expect(METHOD_ALGO_SMITH_CHART).toBe('method-algo-smith-chart')
    expect(SMITH_PARENT).toBe(METHOD_SMITH)
    expect(SMITH_METHOD_IDS).toContain(METHOD_ALGO_SMITH_CHART)
  })

  describe('gammaFromNormalizedZ / inverse', () => {
    it('match / short / open', () => {
      const g0 = gammaFromNormalizedZ(cReal(1))
      expect(g0.re).toBeCloseTo(0, 14)
      expect(g0.im).toBeCloseTo(0, 14)

      const gs = gammaFromNormalizedZ(cReal(0))
      expect(gs.re).toBeCloseTo(-1, 14)
      expect(gs.im).toBeCloseTo(0, 14)

      const go = gammaFromNormalizedZ({ re: 1e12, im: 0 })
      expect(cAbs(go)).toBeCloseTo(1, 10)
      expect(go.re).toBeGreaterThan(0.99)
    })

    it('round-trip z → Γ → z for inductive and capacitive loads', () => {
      const loads = [
        { re: 0.5, im: 0.2 },
        { re: 2, im: -1 },
        { re: 1, im: 0 },
        { re: 0.2, im: 5 },
      ]
      for (const z of loads) {
        const g = gammaFromNormalizedZ(z)
        const zb = normalizedZFromGamma(g)
        expect(zb.re).toBeCloseTo(z.re, 12)
        expect(zb.im).toBeCloseTo(z.im, 12)
        expect(cAbs(g)).toBeLessThanOrEqual(1 + 1e-12)
      }
    })

    it('physical Z with Z0=50', () => {
      const g = gammaFromZ({ re: 50, im: 0 }, 50)
      expect(g.re).toBeCloseTo(0, 14)
      const Z = zFromGamma(g, 50)
      expect(Z.re).toBeCloseTo(50, 10)
      expect(Z.im).toBeCloseTo(0, 10)

      const g2 = gammaFromZ({ re: 100, im: 50 }, 50)
      const zN = normalizeZ({ re: 100, im: 50 }, 50)
      expect(zN.re).toBeCloseTo(2, 14)
      expect(zN.im).toBeCloseTo(1, 14)
      expect(g2.re).toBeCloseTo(gammaFromNormalizedZ(zN).re, 14)
    })

    it('invalid Z0 → NaN', () => {
      const g = gammaFromZ({ re: 50, im: 0 }, 0)
      expect(Number.isNaN(g.re)).toBe(true)
    })
  })

  describe('circle geometry', () => {
    it('r=0 is unit circle centered at origin; r=1 center 0.5 r=0.5', () => {
      const r0 = resistanceCircle(0)
      expect(r0.cx).toBeCloseTo(0, 14)
      expect(r0.cy).toBeCloseTo(0, 14)
      expect(r0.r).toBeCloseTo(1, 14)

      const r1 = resistanceCircle(1)
      expect(r1.cx).toBeCloseTo(0.5, 14)
      expect(r1.r).toBeCloseTo(0.5, 14)
    })

    it('resistance circle always passes through Γ=1', () => {
      for (const r of [0, 0.2, 0.5, 1, 2, 5, 10]) {
        const c = resistanceCircle(r)
        const d = Math.hypot(1 - c.cx, 0 - c.cy)
        expect(d).toBeCloseTo(c.r, 12)
      }
    })

    it('reactance circle passes through Γ=1; x>0 center above axis', () => {
      const xp = reactanceCircle(1)
      expect(xp.cx).toBeCloseTo(1, 14)
      expect(xp.cy).toBeCloseTo(1, 14)
      expect(xp.r).toBeCloseTo(1, 14)
      expect(Math.hypot(1 - xp.cx, 0 - xp.cy)).toBeCloseTo(xp.r, 12)

      const xn = reactanceCircle(-2)
      expect(xn.cy).toBeLessThan(0)
      expect(Math.hypot(1 - xn.cx, 0 - xn.cy)).toBeCloseTo(xn.r, 12)
    })

    it('x=0 and negative r invalid', () => {
      expect(Number.isNaN(reactanceCircle(0).r)).toBe(true)
      expect(Number.isNaN(resistanceCircle(-1).r)).toBe(true)
    })

    it('conductance g=1 center −0.5; passes Γ=−1', () => {
      const c = conductanceCircle(1)
      expect(c.cx).toBeCloseTo(-0.5, 14)
      expect(c.r).toBeCloseTo(0.5, 14)
      expect(Math.hypot(-1 - c.cx, 0 - c.cy)).toBeCloseTo(c.r, 12)
    })

    it('VSWR circle |Γ| from s', () => {
      expect(gammaMagFromVswr(1)).toBeCloseTo(0, 14)
      expect(gammaMagFromVswr(3)).toBeCloseTo(0.5, 14)
      const vc = vswrCircle(3)
      expect(vc.cx).toBeCloseTo(0, 14)
      expect(vc.r).toBeCloseTo(0.5, 14)
    })
  })

  describe('grid sampling', () => {
    it('resistance arcs stay inside unit disk', () => {
      for (const r of [0, 0.5, 1, 2]) {
        const pts = sampleResistanceArc(r, 64)
        expect(pts.length).toBeGreaterThan(8)
        for (const p of pts) {
          expect(p.x * p.x + p.y * p.y).toBeLessThanOrEqual(1 + 1e-8)
        }
      }
    })

    it('reactance arcs non-empty for |x|≥0.2', () => {
      expect(sampleReactanceArc(1, 80).length).toBeGreaterThan(10)
      expect(sampleReactanceArc(-1, 80).length).toBeGreaterThan(10)
    })

    it('buildSmithGrid has outer circle and both families', () => {
      const g = buildSmithGrid({ nPoints: 48 })
      expect(g.outer.length).toBeGreaterThan(40)
      expect(g.resistance.length).toBeGreaterThanOrEqual(4)
      expect(g.reactance.length).toBeGreaterThanOrEqual(4)
      // outer points on unit circle
      for (const p of g.outer) {
        expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 10)
      }
    })
  })

  describe('line rotation & loss', () => {
    it('lossless rotate preserves |Γ|; full half-wave is 2π electrical → identity', () => {
      const g0 = gammaFromNormalizedZ({ re: 0.4, im: 0.6 })
      const g1 = rotateGammaTowardGenerator(g0, Math.PI / 4)
      expect(cAbs(g1)).toBeCloseTo(cAbs(g0), 12)
      // θ = π (half-wave line): phase of Γ advances by 2π → same point
      const gHalf = rotateGammaTowardGenerator(g0, Math.PI)
      expect(gHalf.re).toBeCloseTo(g0.re, 12)
      expect(gHalf.im).toBeCloseTo(g0.im, 12)
    })

    it('quarter-wave rotates by −π in Γ phase (180° on chart)', () => {
      // pure real mismatch Γ real positive (open-ish)
      const g0 = gammaFromNormalizedZ(cReal(4)) // positive real Γ
      expect(g0.im).toBeCloseTo(0, 10)
      expect(g0.re).toBeGreaterThan(0)
      const gQ = rotateGammaTowardGenerator(g0, Math.PI / 4) // λ/4
      // e^{−j π/2} = −j → positive real → negative imag
      expect(gQ.re).toBeCloseTo(0, 10)
      expect(gQ.im).toBeCloseTo(-g0.re, 10)
    })

    it('loss shrinks |Γ|', () => {
      const g0 = gammaFromNormalizedZ({ re: 0.2, im: 0 })
      const gl = propagateGamma(g0, 0.1, 0.2)
      expect(cAbs(gl)).toBeLessThan(cAbs(g0))
    })

    it('sampleLinePath length and endpoint', () => {
      const g0 = gammaFromNormalizedZ({ re: 0.5, im: 0.5 })
      const path = sampleLinePath(g0, Math.PI / 2, 32)
      expect(path.length).toBe(33)
      const end = path[path.length - 1]!
      const gEnd = rotateGammaTowardGenerator(g0, Math.PI / 2)
      expect(end.x).toBeCloseTo(gEnd.re, 10)
      expect(end.y).toBeCloseTo(gEnd.im, 10)
    })
  })

  describe('series / shunt moves', () => {
    it('series reactance keeps r fixed', () => {
      const z0 = { re: 0.7, im: -0.3 }
      const z1 = addSeriesReactance(z0, 0.4)
      expect(z1.re).toBeCloseTo(0.7, 14)
      expect(z1.im).toBeCloseTo(0.1, 14)
    })

    it('shunt susceptance changes admittance imag only', () => {
      const z0 = { re: 1, im: 0 }
      const z1 = addShuntSusceptance(z0, 0.5)
      // y0 = 1; y1 = 1 + j0.5; z1 = 1/y1
      const den = 1 + 0.25
      expect(z1.re).toBeCloseTo(1 / den, 12)
      expect(z1.im).toBeCloseTo(-0.5 / den, 12)
    })

    it('series path stays on constant-r circle in Γ', () => {
      const z0 = { re: 0.5, im: 0 }
      const path = sampleSeriesReactancePath(z0, -1, 1, 40)
      expect(path.length).toBeGreaterThan(10)
      const circ = resistanceCircle(0.5)
      for (const p of path) {
        const d = Math.hypot(p.x - circ.cx, p.y - circ.cy)
        expect(d).toBeCloseTo(circ.r, 8)
      }
    })
  })

  describe('readout & pixel map', () => {
    it('smithReadout matches VSWR and power', () => {
      const r = smithReadout({ re: 100, im: 0 }, 50)
      expect(r.finite).toBe(true)
      expect(r.zNorm.re).toBeCloseTo(2, 14)
      expect(r.vswr).toBeCloseTo(vswr(r.gamma), 12)
      expect(r.powerRefl).toBeCloseTo(powerReflection(r.gamma), 14)
      expect(r.powerTrans).toBeCloseTo(1 - r.powerRefl, 14)
    })

    it('clampGammaToUnitDisk', () => {
      const c = clampGammaToUnitDisk({ re: 2, im: 0 })
      expect(cAbs(c)).toBeCloseTo(1, 14)
      expect(c.re).toBeCloseTo(1, 14)
      const inside = clampGammaToUnitDisk({ re: 0.3, im: -0.2 })
      expect(inside.re).toBeCloseTo(0.3, 14)
    })

    it('pixel ↔ gamma round-trip with y flip', () => {
      const cx = 200
      const cy = 200
      const R = 180
      const g = { re: 0.25, im: 0.4 }
      const pix = gammaToPixel(g, cx, cy, R)
      expect(pix.x).toBeCloseTo(cx + 0.25 * R, 10)
      expect(pix.y).toBeCloseTo(cy - 0.4 * R, 10)
      const g2 = pixelToGamma(pix.x, pix.y, cx, cy, R)
      expect(g2.re).toBeCloseTo(g.re, 12)
      expect(g2.im).toBeCloseTo(g.im, 12)
    })

    it('polar helpers', () => {
      const p = cFromPolar(1, Math.PI / 2)
      expect(p.re).toBeCloseTo(0, 12)
      expect(p.im).toBeCloseTo(1, 12)
      expect(cPhase({ re: 0, im: 1 })).toBeCloseTo(Math.PI / 2, 12)
    })
  })

  describe('runSmithChartSample', () => {
    it('ok with methodId/familyId', () => {
      const r = runSmithChartSample()
      expect(r.methodId).toBe(METHOD_ALGO_SMITH_CHART)
      expect(r.familyId).toBe(METHOD_SMITH)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.inverseOk).toBe(true)
      expect(r.circleOk).toBe(true)
      expect(r.rotateOk).toBe(true)
      expect(r.match.vswr).toBeCloseTo(1, 12)
      expect(r.short.gamma.re).toBeCloseTo(-1, 12)
    })

    it('registry-style entry: sample.ok is true (not merely truthy object)', () => {
      const r = runSmithChartSample({ Z0: 50, ZL: { re: 25, im: 40 } })
      expect(r).toBeTruthy()
      expect(typeof r).toBe('object')
      expect(r.ok).toBe(true)
      expect(r.methodId).toBe('method-algo-smith-chart')
    })

    it('custom load', () => {
      const r = runSmithChartSample({ Z0: 75, ZL: { re: 75, im: 10 } })
      expect(r.ok).toBe(true)
      expect(r.load.Z0).toBe(75)
      expect(r.load.gammaMag).toBeLessThan(0.2)
    })
  })
})
