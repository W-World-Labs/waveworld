import { describe, it, expect } from 'vitest'
import {
  reflect,
  refract,
  malusFactor,
  unitFromRot,
  componentSegment,
  raySegmentHit,
  defaultComponent,
  opticsPreset,
  traceScene,
  createOpticsTrace,
  readOpticsTrace,
  totalScreenPower,
  wavelengthToRgb,
  normalize,
  incidenceAngleDeg,
  serializeScene,
  parseScene,
  SCENE_W,
  SCENE_H,
  OPTICS_PRESETS,
  slitOpenings,
  huygensSources,
  huygensBins,
  decorateHuygens,
  fringeScale,
  opticsWavelengthPx,
  fresnelCoefficients,
  SCREEN_BINS,
  type OpticsEvent,
} from './optics-lab'

function countPeaks(bins: ArrayLike<number>, relative = 0.15): number {
  const arr = Array.from(bins)
  const mid = arr[Math.round(arr.length / 2)] ?? 0
  const floor = relative * mid
  let peaks = 0
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1] && arr[i] > floor) peaks += 1
  }
  return peaks
}

describe('optics-lab math', () => {
  it('unitFromRot 0° is +x', () => {
    const u = unitFromRot(0)
    expect(u.dx).toBeCloseTo(1, 10)
    expect(u.dy).toBeCloseTo(0, 10)
  })

  it('reflect: 45° into vertical mirror', () => {
    const r = reflect(Math.SQRT1_2, Math.SQRT1_2, -1, 0)
    expect(r.dx).toBeCloseTo(-Math.SQRT1_2, 6)
    expect(r.dy).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('refract obeys Snell air→glass 45°', () => {
    const ang = Math.PI / 4
    const r = refract(Math.cos(ang), Math.sin(ang), 1, 0, 1, 1.5)
    expect(r).not.toBeNull()
    if (!r) return
    const theta2 = Math.atan2(r.dy, r.dx)
    expect(Math.abs(1 * Math.sin(ang) - 1.5 * Math.sin(theta2))).toBeLessThan(1e-6)
  })

  it('TIR returns null dense→air steep', () => {
    const ang = (50 * Math.PI) / 180
    expect(refract(Math.cos(ang), Math.sin(ang), 1, 0, 1.5, 1)).toBeNull()
  })

  it('malus: parallel = 1, 90° = 0, unpol = 0.5', () => {
    expect(malusFactor(0, 0)).toBeCloseTo(1, 10)
    expect(malusFactor(0, 90)).toBeCloseTo(0, 10)
    expect(malusFactor(undefined, 30)).toBeCloseTo(0.5, 10)
    expect(malusFactor(0, 45)).toBeCloseTo(0.5, 10)
  })

  it('incidenceAngleDeg normal incidence ≈ 0', () => {
    expect(incidenceAngleDeg(1, 0, -1, 0)).toBeCloseTo(0, 5)
  })

  it('wavelengthToRgb red for 635', () => {
    const [r, g, b] = wavelengthToRgb(635)
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })
})

describe('optics-lab Fresnel physics', () => {
  const appliedRatio = (e: OpticsEvent) => (e.intensityOut ?? 0) / e.intensityIn

  it('fresnelCoefficients: normal incidence, Brewster, swap symmetry', () => {
    const normal = fresnelCoefficients(1, 1.5, 0, 0)
    expect(normal.r).toBeCloseTo(((1.5 - 1) / (1.5 + 1)) ** 2, 12)
    expect(normal.t).toBeCloseTo(0.96, 12)
    const brewster = fresnelCoefficients(1, 1.5, (Math.atan(1.5) * 180) / Math.PI, (Math.asin(Math.sin(Math.atan(1.5)) / 1.5) * 180) / Math.PI)
    expect(brewster.rp).toBeLessThan(1e-10)
    expect(brewster.rs).toBeGreaterThan(0.1)
    // Same R both directions at the same normal cosines.
    expect(fresnelCoefficients(1.5, 1, 28.13, 45).r).toBeCloseTo(fresnelCoefficients(1, 1.5, 45, 28.13).r, 10)
  })

  it('refract events carry angle-resolved Fresnel T, not a fixed factor', () => {
    const laser = { ...defaultComponent('laser', 80, 280), rot: 0 }
    // rot 180 points the normal back at the beam: air → glass crossing.
    const face = { ...defaultComponent('interface', 420, 280), rot: 180, n: 1.5, length: 220 }
    const res = traceScene([laser, face])
    const refracts = res.events.filter((e) => e.type === 'refract')
    expect(refracts.length).toBe(9)
    for (const e of refracts) {
      const expected = fresnelCoefficients(1, 1.5, e.thetaIDeg!, e.thetaTDeg!).t
      expect(appliedRatio(e)).toBeCloseTo(expected, 9)
      expect(appliedRatio(e)).toBeCloseTo(0.96, 2)
    }
    // Steepening the incidence must change T — the old flat 0.97 is gone.
    const tilted = { ...face, rot: 180 + 55 }
    const steep = traceScene([laser, tilted]).events.filter((e) => e.type === 'refract')
    expect(steep.length).toBeGreaterThan(0)
    for (const e of steep) {
      expect(appliedRatio(e)).toBeCloseTo(fresnelCoefficients(1, 1.5, e.thetaIDeg!, e.thetaTDeg!).t, 9)
      expect(Math.abs(appliedRatio(e) - 0.97)).toBeGreaterThan(0.005)
    }
  })

  it('TIR reflects the full incident power (R = 1)', () => {
    const res = traceScene(opticsPreset('tir'))
    const tirs = res.events.filter((e) => e.type === 'tir')
    expect(tirs.length).toBeGreaterThan(0)
    for (const e of tirs) expect(e.intensityOut).toBeCloseTo(e.intensityIn, 12)
    // Above the critical angle there is no transmitted leg.
    expect(res.events.some((e) => e.type === 'refract')).toBe(false)
  })

  it('p-polarized light passes the Brewster surface losslessly', () => {
    const brewsterDeg = (Math.atan(1.5) * 180) / Math.PI
    const scene = (axis: number) => [
      { ...defaultComponent('laser', 60, 280), rot: 0 },
      { ...defaultComponent('polarizer', 200, 280), rot: 0, polAngleDeg: axis, length: 100 },
      { ...defaultComponent('interface', 420, 280), rot: 180 + brewsterDeg, n: 1.5, length: 220 },
    ]
    const p = traceScene(scene(0)).events.filter((e) => e.type === 'refract')
    expect(p.length).toBeGreaterThan(0)
    for (const e of p) {
      expect(e.thetaIDeg!).toBeGreaterThan(50)
      expect(appliedRatio(e)).toBeGreaterThan(0.99)
    }
    // s-polarized light keeps only 1 − R_s at the same angle.
    const s = traceScene(scene(90)).events.filter((e) => e.type === 'refract')
    expect(s.length).toBeGreaterThan(0)
    for (const e of s) {
      const rs = fresnelCoefficients(1, 1.5, e.thetaIDeg!, e.thetaTDeg!).rs
      expect(appliedRatio(e)).toBeCloseTo(1 - rs, 9)
      expect(appliedRatio(e)).toBeLessThan(0.95)
    }
  })

  it('mirror reflects at its protected-silver coating', () => {
    const res = traceScene(opticsPreset('mirror-bounce'))
    const reflects = res.events.filter((e) => e.type === 'reflect')
    expect(reflects.length).toBeGreaterThan(0)
    for (const e of reflects) expect(appliedRatio(e)).toBeCloseTo(0.94, 9)
  })

  it('splitter legs conserve incident power minus coating loss', () => {
    const res = traceScene(opticsPreset('beamsplit'))
    const splits = res.events.filter((e) => e.type === 'split')
    expect(splits.length).toBeGreaterThan(0)
    for (const e of splits) {
      // The two outgoing rays leave segments starting just past the split.
      const legs = res.segments
        .filter((s) => Math.abs(s.x0 - e.x) < 1 && Math.abs(s.y0 - e.y) < 1)
        .reduce((sum, s) => sum + s.intensity, 0)
      expect(legs).toBeCloseTo(e.intensityIn * 0.97, 9)
    }
  })

  it('thin lens applies two-face Fresnel loss (≈0.92 near normal)', () => {
    const res = traceScene(opticsPreset('lens-focus'))
    const lenses = res.events.filter((e) => e.type === 'lens')
    expect(lenses.length).toBeGreaterThan(0)
    for (const e of lenses) {
      expect(appliedRatio(e)).toBeGreaterThan(0.85)
      expect(appliedRatio(e)).toBeLessThan(0.97)
    }
  })
})

describe('optics-lab geometry & presets', () => {
  it('raySegmentHit mid vertical', () => {
    const hit = raySegmentHit(0, 100, 1, 0, { x0: 100, y0: 0, x1: 100, y1: 200, nx: -1, ny: 0 })
    expect(hit!.x).toBeCloseTo(100, 6)
  })

  it('componentSegment centered', () => {
    const c = defaultComponent('mirror', 200, 100)
    c.length = 100
    const s = componentSegment(c)
    expect((s.x0 + s.x1) / 2).toBeCloseTo(200, 5)
  })

  it('mirror-bounce deposits power', () => {
    const res = traceScene(opticsPreset('mirror-bounce'))
    expect(res.segments.length).toBeGreaterThan(0)
    expect(totalScreenPower(res)).toBeGreaterThan(0.05)
    expect(res.events.some((e) => e.type === 'reflect')).toBe(true)
  })

  it('lens-focus traces past lens', () => {
    const comps = opticsPreset('lens-focus')
    const lens = comps.find((c) => c.kind === 'lens')!
    const res = traceScene(comps)
    expect(res.segments.some((s) => s.x1 > lens.x + 10)).toBe(true)
    expect(res.events.some((e) => e.type === 'lens')).toBe(true)
  })

  it('malus: crossed polarizers kill more than parallel', () => {
    const parallel = opticsPreset('malus')
    const p2 = parallel.find((c) => c.label?.includes('检偏'))!
    p2.polAngleDeg = 0 // plate rot stays 0
    const cross = opticsPreset('malus')
    const p2c = cross.find((c) => c.label?.includes('检偏'))!
    p2c.polAngleDeg = 90 // only axis rotates — plate still faces beam
    const Pp = totalScreenPower(traceScene(parallel))
    const Pc = totalScreenPower(traceScene(cross))
    expect(Pp).toBeGreaterThan(0.2)
    expect(Pc).toBeLessThan(0.05)
    expect(Pp).toBeGreaterThan(Pc * 5)
  })

  it('beamsplit deposits on two screens', () => {
    const res = traceScene(opticsPreset('beamsplit'))
    expect(res.events.some((e) => e.type === 'split')).toBe(true)
    const ids = Object.keys(res.screenPower)
    expect(ids.length).toBeGreaterThanOrEqual(1)
    // 透射 + 反射 两侧都应有能流（允许几何损耗一侧略弱）
    const powers = Object.values(res.screenPower)
    expect(powers.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.3)
    if (ids.length >= 2) {
      expect(Math.min(...powers)).toBeGreaterThan(0.05)
    }
  })

  it('screen profile has bins', () => {
    const res = traceScene(opticsPreset('lens-focus'))
    expect(res.profiles.length).toBeGreaterThan(0)
    expect(res.profiles[0].bins.length).toBeGreaterThan(8)
    expect(res.profiles[0].total).toBeGreaterThan(0)
  })

  it('serialize/parse roundtrip', () => {
    const comps = opticsPreset('refraction')
    const json = serializeScene(comps, 'refraction')
    const back = parseScene(json)
    expect(back.length).toBe(comps.length)
    expect(back[0].kind).toBe('laser')
  })

  it('blocker absorbs', () => {
    const laser = defaultComponent('laser', 50, 100)
    const block = defaultComponent('blocker', 200, 100)
    block.rot = 180
    const res = traceScene([laser, block])
    expect(totalScreenPower(res)).toBe(0)
    expect(res.events.some((e) => e.type === 'block')).toBe(true)
  })

  it('normalize unit', () => {
    const n = normalize(3, 4)
    expect(Math.hypot(n.dx, n.dy)).toBeCloseTo(1, 10)
  })

  it('scene constants', () => {
    expect(SCENE_W).toBeGreaterThan(100)
    expect(SCENE_H).toBeGreaterThan(100)
  })

  it('one-click famous layouts trace and keep their signature events', () => {
    for (const preset of OPTICS_PRESETS) {
      const comps = opticsPreset(preset.id)
      expect(comps.length).toBeGreaterThan(0)
      const res = traceScene(comps)
      expect(res.segments.length).toBeGreaterThan(0)
    }
    expect(traceScene(opticsPreset('tir')).events.some((e) => e.type === 'tir')).toBe(true)
    expect(totalScreenPower(traceScene(opticsPreset('crossed-polars')))).toBeLessThan(0.05)
    expect(traceScene(opticsPreset('kepler')).events.filter((e) => e.type === 'lens').length).toBeGreaterThanOrEqual(2)
    expect(traceScene(opticsPreset('galileo')).events.some((e) => e.type === 'lens')).toBe(true)
    const michelson = traceScene(opticsPreset('michelson'))
    expect(michelson.events.some((e) => e.type === 'split')).toBe(true)
    expect(Object.keys(michelson.screenPower).length).toBeGreaterThanOrEqual(1)
    expect(traceScene(opticsPreset('retroreflector')).events.filter((e) => e.type === 'reflect').length).toBeGreaterThanOrEqual(2)
    expect(traceScene(opticsPreset('fiber')).events.some((e) => e.type === 'tir' || e.type === 'refract')).toBe(true)
    expect(totalScreenPower(traceScene(opticsPreset('optical-lever')))).toBeGreaterThan(0.02)
    expect(traceScene(opticsPreset('microscope')).events.some((e) => e.type === 'lens')).toBe(true)
  })

  it('Young double-slit Huygens profile has multiple fringes unlike a geometric shadow', () => {
    const comps = opticsPreset('young-double-slit')
    const openings = slitOpenings(comps)
    expect(openings.length).toBe(2)
    const screen = comps.find((c) => c.kind === 'screen')!
    const bins = huygensBins(huygensSources(comps), componentSegment(screen), SCREEN_BINS)
    expect(countPeaks(bins)).toBeGreaterThanOrEqual(3)
    const geometric = traceScene(comps)
    const wave = decorateHuygens(geometric, comps)
    expect(wave.profiles[0].bins.length).toBe(SCREEN_BINS)
    expect(wave.profiles[0].total).toBeGreaterThan(0)
    const g = Array.from(geometric.profiles[0]?.bins ?? [])
    const w = Array.from(wave.profiles[0].bins)
    expect(w.some((v, i) => Math.abs(v - (g[i] ?? 0)) > 1e-9)).toBe(true)
    expect(slitOpenings(opticsPreset('single-slit')).length).toBe(1)
    expect(slitOpenings(opticsPreset('diffraction-grating')).length).toBe(5)
    const scale = fringeScale(comps)!
    expect(scale.spacingPx).toBeGreaterThan(8)
    expect(scale.dPx).toBeCloseTo(36, 0)
  })

  it('Young family layouts: one-blocked, two-color, triple, grating', () => {
    expect(slitOpenings(opticsPreset('young-one-blocked')).length).toBe(1)
    expect(slitOpenings(opticsPreset('triple-slit')).length).toBe(3)
    const color = huygensSources(opticsPreset('young-two-color'))
    const nms = new Set(color.map((s) => Math.round(s.wavelengthNm)))
    expect(nms.has(450)).toBe(true)
    expect(nms.has(650)).toBe(true)
    const two = decorateHuygens(traceScene(opticsPreset('young-double-slit')), opticsPreset('young-double-slit'))
    const one = decorateHuygens(traceScene(opticsPreset('young-one-blocked')), opticsPreset('young-one-blocked'))
    expect(countPeaks(two.profiles[0].bins)).toBeGreaterThan(countPeaks(one.profiles[0].bins))
  })

  it("Lloyd's mirror is two sources with a π phase and several fringes", () => {
    const comps = opticsPreset('lloyd-mirror')
    const sources = huygensSources(comps)
    expect(sources.length).toBe(2)
    expect(Math.abs(sources[0].phase - sources[1].phase)).toBeCloseTo(Math.PI, 6)
    const screen = comps.find((c) => c.kind === 'screen')!
    expect(countPeaks(huygensBins(sources, componentSegment(screen), SCREEN_BINS), 0.08)).toBeGreaterThanOrEqual(3)
    expect(traceScene(comps).events.some((e) => e.type === 'reflect')).toBe(true)
    expect(fringeScale(comps)?.spacingPx).toBeGreaterThan(5)
  })

  it('knife-edge and obstacle sample an open aperture; biprism is two virtual sources', () => {
    expect(huygensSources(opticsPreset('knife-edge')).length).toBeGreaterThan(10)
    const obstacle = opticsPreset('poisson-spot')
    const sources = huygensSources(obstacle)
    const cy = obstacle.find((c) => c.kind === 'blocker')!.y
    expect(sources.some((s) => s.y < cy - 8)).toBe(true)
    expect(sources.some((s) => s.y > cy + 8)).toBe(true)
    const prism = huygensSources(opticsPreset('fresnel-biprism'))
    expect(prism.length).toBe(2)
    const screen = opticsPreset('fresnel-biprism').find((c) => c.kind === 'screen')!
    expect(countPeaks(huygensBins(prism, componentSegment(screen), SCREEN_BINS), 0.08)).toBeGreaterThanOrEqual(3)
  })

  it('Mach–Zehnder traces the full loop, lights both ports, and keeps two arm sources', () => {
    const comps = opticsPreset('mach-zehnder')
    const res = traceScene(comps)
    expect(res.events.filter((e) => e.type === 'split').length).toBeGreaterThanOrEqual(2)
    expect(res.events.filter((e) => e.type === 'reflect').length).toBeGreaterThanOrEqual(2)
    // Both output ports receive light.
    const powers = Object.values(res.screenPower)
    expect(powers.length).toBe(2)
    expect(Math.min(...powers)).toBeGreaterThan(0.05)
    const sources = huygensSources(comps)
    expect(sources.length).toBe(2)
    const port1 = comps.find((c) => c.label?.includes('输出屏 1'))!
    expect(countPeaks(huygensBins(sources, componentSegment(port1), SCREEN_BINS), 0.08)).toBeGreaterThanOrEqual(3)
    expect(fringeScale(comps)?.spacingPx).toBeGreaterThan(5)
  })

  it('Newton wedge refracts through both plates and forms equal-thickness bands', () => {
    const comps = opticsPreset('newton-rings')
    const res = traceScene(comps)
    expect(res.events.filter((e) => e.type === 'refract').length).toBeGreaterThanOrEqual(2)
    expect(totalScreenPower(res)).toBeGreaterThan(0)
    const sources = huygensSources(comps)
    expect(sources.length).toBeGreaterThan(20)
    // Phase grows with film thickness and starts at π (dark contact edge).
    const phases = sources.map((s) => s.phase)
    expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(4 * Math.PI)
    const screen = comps.find((c) => c.kind === 'screen')!
    expect(countPeaks(huygensBins(sources, componentSegment(screen), SCREEN_BINS), 0.08)).toBeGreaterThanOrEqual(3)
  })

  it('Fabry–Pérot cavity logs a bounce train of split events and a source train', () => {
    const comps = opticsPreset('fabry-perot')
    const res = traceScene(comps)
    expect(res.events.filter((e) => e.type === 'split').length).toBeGreaterThanOrEqual(4)
    expect(totalScreenPower(res)).toBeGreaterThan(0)
    const sources = huygensSources(comps)
    // Virtual sources sit on the beam axis spaced by one round trip (2d = 160 px).
    expect(sources.length).toBeGreaterThanOrEqual(3)
    const sorted = [...sources].sort((a, b) => b.x - a.x)
    expect(sorted[0].x - sorted[1].x).toBeCloseTo(160, 3)
    expect(sorted[0].amplitude).toBeGreaterThan(sorted[1].amplitude)
    const screen = comps.find((c) => c.kind === 'screen')!
    expect(countPeaks(huygensBins(sources, componentSegment(screen), SCREEN_BINS), 0.08)).toBeGreaterThanOrEqual(2)
  })

  it('Michelson wave model keeps the geometric arms and adds two phased arm sources', () => {
    const comps = opticsPreset('michelson-wave')
    const res = traceScene(comps)
    expect(res.events.some((e) => e.type === 'split')).toBe(true)
    expect(res.events.filter((e) => e.type === 'reflect').length).toBeGreaterThanOrEqual(2)
    expect(totalScreenPower(res)).toBeGreaterThan(0)
    const sources = huygensSources(comps)
    expect(sources.length).toBe(2)
    const screen = comps.find((c) => c.kind === 'screen')!
    expect(countPeaks(huygensBins(sources, componentSegment(screen), SCREEN_BINS), 0.08)).toBeGreaterThanOrEqual(3)
    expect(fringeScale(comps)?.spacingPx).toBeGreaterThan(5)
    // Round-trip phase: sliding an end mirror by λ/4 flips every fringe.
    const lamPx = opticsWavelengthPx(532)
    const moved = comps.map((c) => (c.label === '臂 B 端镜' ? { ...c, y: c.y + lamPx / 4 } : c))
    const shifted = huygensSources(moved)
    const rel = (s: typeof sources) => Math.abs(s[0].phase - s[1].phase) % (2 * Math.PI)
    let delta = Math.abs(rel(shifted) - rel(sources)) % (2 * Math.PI)
    if (delta > Math.PI) delta = 2 * Math.PI - delta
    expect(delta).toBeCloseTo(Math.PI, 1)
    // The geometric 'michelson' preset stays ray-only — no wave sources.
    expect(huygensSources(opticsPreset('michelson')).length).toBe(0)
  })

  it('Fresnel zone plate opens even half-wave zones and focuses on axis', () => {
    const comps = opticsPreset('zone-plate')
    const openings = slitOpenings(comps)
    // Central zone plus four mirrored pairs of open even half-wave zones.
    expect(openings.length).toBe(9)
    const res = traceScene(comps)
    expect(res.events.some((e) => e.type === 'block')).toBe(true)
    expect(totalScreenPower(res)).toBeGreaterThan(0)
    const sources = huygensSources(comps)
    expect(sources.length).toBeGreaterThan(20)
    const screen = comps.find((c) => c.kind === 'screen')!
    const focused = Array.from(huygensBins(sources, componentSegment(screen), SCREEN_BINS))
    const peak = focused.indexOf(Math.max(...focused))
    // The focal spot sits on the axis and dominates the screen edges.
    expect(Math.abs(peak - (SCREEN_BINS - 1) / 2)).toBeLessThanOrEqual(3)
    const edge = (focused.slice(0, 6).reduce((a, b) => a + b, 0) + focused.slice(-6).reduce((a, b) => a + b, 0)) / 12
    expect(focused[peak]).toBeGreaterThan(edge * 4)
    // A screen well past the focus sees the spot defocus.
    const past = componentSegment({ ...screen, x: screen.x + 90 })
    const blurred = Array.from(huygensBins(sources, past, SCREEN_BINS))
    expect(Math.max(...blurred)).toBeLessThan(Math.max(...focused))
  })
})


it('reuses editor memory while keeping prior results independent and clearing a new scene', () => {
  const components = opticsPreset('beamsplit'), run = createOpticsTrace(components)
  const memory = run.view.buffer
  run.advance(1)
  expect(run.processed).toBe(1)
  expect(() => readOpticsTrace(run, components)).toThrow()
  while (!run.done) run.advance()
  const first = readOpticsTrace(run, components)
  const bins = Array.from(first.profiles[0].bins)
  run.reset([])
  expect(readOpticsTrace(run, [])).toEqual({ segments: [], hits: [], events: [], profiles: [], screenPower: {} })
  const next = opticsPreset('malus')
  run.reset(next)
  while (!run.done) run.advance()
  expect(readOpticsTrace(run, next)).toEqual(traceScene(next))
  expect(run.view.buffer).toBe(memory)
  expect(Array.from(first.profiles[0].bins)).toEqual(bins)
})

it('keeps displayed power stable when native JSON reorders screen keys', () => {
  const profiles = ['z', 'y', 'x'].map(componentId => ({ componentId, bins: new Float64Array(1), total: 0, peakBin: 0, peakS: 0.5 }))
  const first = { segments: [], hits: [], events: [], profiles, screenPower: { z: 1, y: 1e-16, x: 1e-16 } }
  const saved = { ...first, screenPower: { x: 1e-16, y: 1e-16, z: 1 } }
  expect(totalScreenPower(saved)).toBe(totalScreenPower(first))
})
