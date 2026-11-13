/**
 * Smith chart · pure geometry and RF mapping (teaching).
 *
 * Normalized impedance z = Z/Z0 = r + jx maps to reflection coefficient
 *   Γ = (z − 1) / (z + 1)
 * via a Möbius transform that folds Re(z) ≥ 0 into the unit disk.
 * Constant-r and constant-x loci become circles in the Γ plane; a lossless
 * line rotates Γ at fixed |Γ|; series/shunt reactives walk r- or g-circles.
 *
 * Builds on impedance-match-algos (Γ, VSWR, return loss). No DOM.
 */

import {
  type Complex,
  cAbs,
  cAbs2,
  cAdd,
  cDiv,
  cMul,
  cReal,
  cSub,
  powerReflection,
  powerTransmission,
  reflectionGamma,
  returnLossDb,
  vswr,
} from './impedance-match-algos'

export type { Complex }

/** Family · Smith chart visualization (teaching atlas). */
export const METHOD_SMITH = 'method-impedance-match'

/** Algo · Smith chart Γ ↔ z geometry. */
export const METHOD_ALGO_SMITH_CHART = 'method-algo-smith-chart'

export const SMITH_PARENT = METHOD_SMITH
export const SMITH_METHOD_IDS = [METHOD_ALGO_SMITH_CHART] as const

// ─── Complex helpers local to chart geometry ───────────────────────────────

export function cFromPolar(mag: number, phaseRad: number): Complex {
  if (!Number.isFinite(mag) || !Number.isFinite(phaseRad)) return { re: NaN, im: NaN }
  return { re: mag * Math.cos(phaseRad), im: mag * Math.sin(phaseRad) }
}

export function cPhase(z: Complex): number {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return NaN
  return Math.atan2(z.im, z.re)
}

// ─── Möbius: z ↔ Γ ─────────────────────────────────────────────────────────

/**
 * Γ from normalized impedance z = Z/Z0.
 * Short z=0 → Γ=−1; open |z|→∞ → Γ→+1; match z=1 → Γ=0.
 */
export function gammaFromNormalizedZ(z: Complex): Complex {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return { re: NaN, im: NaN }
  return reflectionGamma(z, cReal(1))
}

/**
 * Γ from physical Z and real Z0 > 0.
 */
export function gammaFromZ(Z: Complex, Z0: number): Complex {
  if (!Number.isFinite(Z0) || !(Z0 > 0)) return { re: NaN, im: NaN }
  return reflectionGamma(Z, cReal(Z0))
}

/**
 * Normalized z from Γ: z = (1+Γ)/(1−Γ).
 * Singular at Γ=1 (open); returns NaN components.
 */
export function normalizedZFromGamma(gamma: Complex): Complex {
  if (!Number.isFinite(gamma.re) || !Number.isFinite(gamma.im)) {
    return { re: NaN, im: NaN }
  }
  return cDiv(cAdd(cReal(1), gamma), cSub(cReal(1), gamma))
}

/**
 * Physical Z = z · Z0 from Γ.
 */
export function zFromGamma(gamma: Complex, Z0: number): Complex {
  if (!Number.isFinite(Z0) || !(Z0 > 0)) return { re: NaN, im: NaN }
  const z = normalizedZFromGamma(gamma)
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return z
  return { re: z.re * Z0, im: z.im * Z0 }
}

/** Normalize Z by real Z0. */
export function normalizeZ(Z: Complex, Z0: number): Complex {
  if (!Number.isFinite(Z0) || !(Z0 > 0)) return { re: NaN, im: NaN }
  if (!Number.isFinite(Z.re) || !Number.isFinite(Z.im)) return { re: NaN, im: NaN }
  return { re: Z.re / Z0, im: Z.im / Z0 }
}

// ─── Circle geometry in Γ plane ────────────────────────────────────────────

export type Circle2D = { cx: number; cy: number; r: number }

/**
 * Constant resistance r ≥ 0 circle in Γ plane.
 * Center (r/(r+1), 0), radius 1/(r+1). Passes through Γ=1.
 */
export function resistanceCircle(r: number): Circle2D {
  if (!Number.isFinite(r) || r < 0) return { cx: NaN, cy: NaN, r: NaN }
  const den = r + 1
  return { cx: r / den, cy: 0, r: 1 / den }
}

/**
 * Constant reactance x ≠ 0 circle in Γ plane.
 * Center (1, 1/x), radius |1/x|. Passes through Γ=1.
 * x → 0 is the horizontal axis (degenerate); return infinite-radius sentinel as NaN r.
 */
export function reactanceCircle(x: number): Circle2D {
  if (!Number.isFinite(x) || x === 0) return { cx: NaN, cy: NaN, r: NaN }
  const inv = 1 / x
  return { cx: 1, cy: inv, r: Math.abs(inv) }
}

/**
 * Constant conductance g ≥ 0 circle (admittance Smith dual).
 * Center (−g/(g+1), 0), radius 1/(g+1). Passes through Γ=−1.
 */
export function conductanceCircle(g: number): Circle2D {
  if (!Number.isFinite(g) || g < 0) return { cx: NaN, cy: NaN, r: NaN }
  const den = g + 1
  return { cx: -g / den, cy: 0, r: 1 / den }
}

/**
 * Constant |Γ| (VSWR) circle centered at origin.
 * |Γ| from VSWR: |Γ| = (s−1)/(s+1) for s ≥ 1.
 */
export function vswrCircle(s: number): Circle2D {
  if (!Number.isFinite(s) || s < 1) return { cx: NaN, cy: NaN, r: NaN }
  return { cx: 0, cy: 0, r: (s - 1) / (s + 1) }
}

/** |Γ| from VSWR s ≥ 1. */
export function gammaMagFromVswr(s: number): number {
  if (!Number.isFinite(s) || s < 1) return NaN
  return (s - 1) / (s + 1)
}

// ─── Arc sampling for drawing ──────────────────────────────────────────────

export type Point2 = { x: number; y: number }

/**
 * Sample a circle arc in the unit disk (clip to |Γ| ≤ 1 + eps).
 * Returns polyline points in Γ coordinates.
 */
export function sampleCircleInUnitDisk(
  circ: Circle2D,
  nPoints = 96,
  eps = 1e-9,
): Point2[] {
  if (
    !Number.isFinite(circ.cx) ||
    !Number.isFinite(circ.cy) ||
    !Number.isFinite(circ.r) ||
    !(circ.r > 0)
  ) {
    return []
  }
  const out: Point2[] = []
  const n = Math.max(8, Math.floor(nPoints))
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * 2 * Math.PI
    const x = circ.cx + circ.r * Math.cos(th)
    const y = circ.cy + circ.r * Math.sin(th)
    if (x * x + y * y <= 1 + eps) out.push({ x, y })
  }
  return out
}

/**
 * Sample constant-r circle as polyline clipped to unit disk.
 */
export function sampleResistanceArc(r: number, nPoints = 96): Point2[] {
  return sampleCircleInUnitDisk(resistanceCircle(r), nPoints)
}

/**
 * Sample constant-x circle as polyline clipped to unit disk.
 */
export function sampleReactanceArc(x: number, nPoints = 128): Point2[] {
  return sampleCircleInUnitDisk(reactanceCircle(x), nPoints)
}

/**
 * Sample constant-g circle as polyline clipped to unit disk.
 */
export function sampleConductanceArc(g: number, nPoints = 96): Point2[] {
  return sampleCircleInUnitDisk(conductanceCircle(g), nPoints)
}

/** Default r values drawn on a teaching Smith chart. */
export const DEFAULT_R_GRID = [0, 0.2, 0.5, 1, 2, 5] as const

/** Default |x| values (both +x inductive and −x capacitive drawn). */
export const DEFAULT_X_GRID = [0.2, 0.5, 1, 2, 5] as const

export type SmithGrid = {
  resistance: { r: number; points: Point2[] }[]
  reactance: { x: number; points: Point2[] }[]
  outer: Point2[]
}

/**
 * Build chart grid polylines for canvas rendering.
 */
export function buildSmithGrid(opts?: {
  rValues?: readonly number[]
  xValues?: readonly number[]
  nPoints?: number
}): SmithGrid {
  const rValues = opts?.rValues ?? DEFAULT_R_GRID
  const xValues = opts?.xValues ?? DEFAULT_X_GRID
  const nPoints = opts?.nPoints ?? 96

  const resistance = rValues.map((r) => ({
    r,
    points: sampleResistanceArc(r, nPoints),
  }))

  const reactance: { x: number; points: Point2[] }[] = []
  for (const ax of xValues) {
    reactance.push({ x: ax, points: sampleReactanceArc(ax, nPoints) })
    reactance.push({ x: -ax, points: sampleReactanceArc(-ax, nPoints) })
  }

  // Outer |Γ|=1 unit circle
  const outer: Point2[] = []
  const n = Math.max(32, nPoints)
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * 2 * Math.PI
    outer.push({ x: Math.cos(th), y: Math.sin(th) })
  }

  return { resistance, reactance, outer }
}

// ─── Transmission line & matching moves ────────────────────────────────────

/**
 * Lossless line of electrical length θ (radians, one-way βℓ).
 * Toward generator: Γ_in = Γ_L · e^{−j 2θ} (clockwise on chart for +θ).
 */
export function rotateGammaTowardGenerator(gamma: Complex, thetaRad: number): Complex {
  if (!Number.isFinite(thetaRad)) return { re: NaN, im: NaN }
  if (!Number.isFinite(gamma.re) || !Number.isFinite(gamma.im)) return { re: NaN, im: NaN }
  return cMul(gamma, cFromPolar(1, -2 * thetaRad))
}

/**
 * Lossy line: |Γ| shrinks by e^{−2αℓ} while phase advances 2βℓ.
 * alphaLen = αℓ (nepers), theta = βℓ (rad).
 */
export function propagateGamma(
  gamma: Complex,
  thetaRad: number,
  alphaLen = 0,
): Complex {
  if (!Number.isFinite(thetaRad) || !Number.isFinite(alphaLen)) {
    return { re: NaN, im: NaN }
  }
  if (!Number.isFinite(gamma.re) || !Number.isFinite(gamma.im)) {
    return { re: NaN, im: NaN }
  }
  const atten = Math.exp(-2 * Math.max(0, alphaLen))
  return cMul(gamma, cFromPolar(atten, -2 * thetaRad))
}

/**
 * Sample Γ along a line from load toward generator (0 … thetaMax).
 */
export function sampleLinePath(
  gammaLoad: Complex,
  thetaMaxRad: number,
  nPoints = 64,
  alphaLen = 0,
): Point2[] {
  if (!Number.isFinite(thetaMaxRad) || nPoints < 2) return []
  const out: Point2[] = []
  const n = Math.floor(nPoints)
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * thetaMaxRad
    const a = alphaLen * (i / n)
    const g = propagateGamma(gammaLoad, t, a)
    if (Number.isFinite(g.re) && Number.isFinite(g.im)) {
      out.push({ x: g.re, y: g.im })
    }
  }
  return out
}

/**
 * Series normalized reactance Δx added to load: z' = z + j Δx.
 */
export function addSeriesReactance(zNorm: Complex, deltaX: number): Complex {
  if (!Number.isFinite(deltaX)) return { re: NaN, im: NaN }
  if (!Number.isFinite(zNorm.re) || !Number.isFinite(zNorm.im)) {
    return { re: NaN, im: NaN }
  }
  return { re: zNorm.re, im: zNorm.im + deltaX }
}

/**
 * Shunt normalized susceptance Δb: y' = y + j Δb, y = 1/z.
 */
export function addShuntSusceptance(zNorm: Complex, deltaB: number): Complex {
  if (!Number.isFinite(deltaB)) return { re: NaN, im: NaN }
  if (!Number.isFinite(zNorm.re) || !Number.isFinite(zNorm.im)) {
    return { re: NaN, im: NaN }
  }
  const y = cDiv(cReal(1), zNorm)
  if (!Number.isFinite(y.re) || !Number.isFinite(y.im)) return { re: NaN, im: NaN }
  const y2 = { re: y.re, im: y.im + deltaB }
  return cDiv(cReal(1), y2)
}

/**
 * Walk series reactance from z0 by sweeping Δx ∈ [xMin, xMax] (constant-r arc in Γ).
 */
export function sampleSeriesReactancePath(
  zNorm: Complex,
  xMin: number,
  xMax: number,
  nPoints = 48,
): Point2[] {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || nPoints < 2) return []
  const out: Point2[] = []
  const n = Math.floor(nPoints)
  for (let i = 0; i <= n; i++) {
    const dx = xMin + (i / n) * (xMax - xMin)
    const z = addSeriesReactance(zNorm, dx)
    const g = gammaFromNormalizedZ(z)
    if (Number.isFinite(g.re) && Number.isFinite(g.im) && cAbs(g) <= 1 + 1e-9) {
      out.push({ x: g.re, y: g.im })
    }
  }
  return out
}

// ─── Readout bundle ────────────────────────────────────────────────────────

export type SmithReadout = {
  Z0: number
  Z: Complex
  zNorm: Complex
  gamma: Complex
  gammaMag: number
  gammaPhaseDeg: number
  vswr: number
  returnLossDb: number
  powerRefl: number
  powerTrans: number
  finite: boolean
}

/**
 * Full chart readout for a load Z and reference Z0.
 */
export function smithReadout(Z: Complex, Z0: number): SmithReadout {
  const gamma = gammaFromZ(Z, Z0)
  const zNorm = normalizeZ(Z, Z0)
  const mag = cAbs(gamma)
  const phase = cPhase(gamma)
  const s = vswr(gamma)
  const rl = returnLossDb(gamma)
  const pr = powerReflection(gamma)
  const pt = powerTransmission(gamma)
  const finite =
    Number.isFinite(gamma.re) &&
    Number.isFinite(gamma.im) &&
    Number.isFinite(mag) &&
    Number.isFinite(zNorm.re)

  return {
    Z0,
    Z: { re: Z.re, im: Z.im },
    zNorm,
    gamma,
    gammaMag: mag,
    gammaPhaseDeg: (phase * 180) / Math.PI,
    vswr: s,
    returnLossDb: rl,
    powerRefl: pr,
    powerTrans: pt,
    finite,
  }
}

/**
 * Clamp a Γ point to the closed unit disk (passive loads).
 */
export function clampGammaToUnitDisk(gamma: Complex): Complex {
  if (!Number.isFinite(gamma.re) || !Number.isFinite(gamma.im)) {
    return { re: NaN, im: NaN }
  }
  const m2 = cAbs2(gamma)
  if (m2 <= 1) return gamma
  const m = Math.sqrt(m2)
  if (!(m > 0)) return { re: 0, im: 0 }
  return { re: gamma.re / m, im: gamma.im / m }
}

/**
 * Map canvas pixel (relative to chart center, radius R) to Γ.
 * Canvas y grows down; chart imag grows up → flip y.
 */
export function pixelToGamma(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number,
): Complex {
  if (!(radius > 0)) return { re: NaN, im: NaN }
  return {
    re: (px - cx) / radius,
    im: (cy - py) / radius,
  }
}

/**
 * Map Γ (or a Γ-plane point) to canvas pixel.
 * Accepts Complex `{re,im}` or Point2 `{x,y}` (same plane).
 */
export function gammaToPixel(
  gamma: Complex | Point2,
  cx: number,
  cy: number,
  radius: number,
): Point2 {
  const re = 're' in gamma ? gamma.re : gamma.x
  const im = 'im' in gamma ? gamma.im : gamma.y
  return {
    x: cx + re * radius,
    y: cy - im * radius,
  }
}

// ─── Sample runner (registry / smoke) ──────────────────────────────────────

/**
 * Self-check sample: match/short/open, inverse Möbius, circle geometry,
 * line rotation preserves |Γ|, series walk stays on constant r.
 */
export function runSmithChartSample(opts?: {
  Z0?: number
  ZL?: Complex
}): {
  Z0: number
  match: SmithReadout
  short: SmithReadout
  open: SmithReadout
  load: SmithReadout
  inverseOk: boolean
  circleOk: boolean
  rotateOk: boolean
  seriesRok: boolean
  gridOk: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SMITH_CHART
  familyId: typeof METHOD_SMITH
} {
  const Z0 = opts?.Z0 ?? 50
  const ZL = opts?.ZL ?? { re: 25, im: 40 }

  const match = smithReadout(cReal(Z0), Z0)
  const short = smithReadout(cReal(0), Z0)
  const open = smithReadout({ re: 1e12, im: 0 }, Z0)
  const load = smithReadout(ZL, Z0)

  // Inverse: z → Γ → z
  const zN = normalizeZ(ZL, Z0)
  const g = gammaFromNormalizedZ(zN)
  const zBack = normalizedZFromGamma(g)
  const inverseOk =
    Math.abs(zBack.re - zN.re) < 1e-12 && Math.abs(zBack.im - zN.im) < 1e-12

  // r=1 circle: center 0.5, radius 0.5; passes through 0 and 1
  const rc = resistanceCircle(1)
  const circleOk =
    Math.abs(rc.cx - 0.5) < 1e-14 &&
    Math.abs(rc.r - 0.5) < 1e-14 &&
    Math.abs(resistanceCircle(0).cx) < 1e-14 &&
    Math.abs(resistanceCircle(0).r - 1) < 1e-14

  // Lossless rotation preserves |Γ|
  const g0 = load.gamma
  const g1 = rotateGammaTowardGenerator(g0, Math.PI / 6)
  const rotateOk = Math.abs(cAbs(g1) - cAbs(g0)) < 1e-12

  // Series reactance keeps Re(z) fixed → same resistance circle
  const zSer = addSeriesReactance(zN, 0.3)
  const seriesRok = Math.abs(zSer.re - zN.re) < 1e-14

  const grid = buildSmithGrid({ nPoints: 32 })
  const gridOk =
    grid.outer.length > 20 &&
    grid.resistance.some((a) => a.points.length > 4) &&
    grid.reactance.some((a) => a.points.length > 4)

  const finite =
    match.finite &&
    short.finite &&
    load.finite &&
    Number.isFinite(g.re) &&
    Number.isFinite(g1.re)

  const matchOk =
    Math.abs(match.gamma.re) < 1e-12 &&
    Math.abs(match.gamma.im) < 1e-12 &&
    Math.abs(match.vswr - 1) < 1e-12

  const shortOk =
    Math.abs(short.gamma.re - -1) < 1e-12 && Math.abs(short.gamma.im) < 1e-12

  const openOk = Math.abs(open.gammaMag - 1) < 1e-8

  const ok =
    finite &&
    matchOk &&
    shortOk &&
    openOk &&
    inverseOk &&
    circleOk &&
    rotateOk &&
    seriesRok &&
    gridOk

  return {
    Z0,
    match,
    short,
    open,
    load,
    inverseOk,
    circleOk,
    rotateOk,
    seriesRok,
    gridOk,
    finite,
    ok,
    methodId: METHOD_ALGO_SMITH_CHART,
    familyId: METHOD_SMITH,
  }
}

export type SmithScene = { resistance: number; reactance: number; thetaDeg: number }
/** Lossless 50-ohm line; null means an ideal infinite impedance/metric. */
export function smithResult(scene: SmithScene) {
  const atLoad = smithReadout({ re: scene.resistance, im: scene.reactance }, 50)
  const theta = scene.thetaDeg * Math.PI / 180
  const gIn = rotateGammaTowardGenerator(atLoad.gamma, theta)
  const open = Math.hypot(1 - gIn.re, gIn.im) < 1e-12
  const zIn = open ? null : zFromGamma(gIn, 50)
  // Preserve the reflection metrics directly from Gamma. Inverting the open
  // endpoint and falling back to the load would report the wrong line input.
  return { atLoad: { Z: atLoad.Z, zNorm: atLoad.zNorm, gamma: atLoad.gamma }, gIn, theta,
    zIn, zNormIn: zIn ? normalizeZ(zIn, 50) : null,
    gammaMag: atLoad.gammaMag, gammaPhaseDeg: cPhase(gIn) * 180 / Math.PI,
    vswr: atLoad.gammaMag >= 1 - 1e-12 ? null : atLoad.vswr,
    returnLossDb: Number.isFinite(atLoad.returnLossDb) ? (atLoad.returnLossDb || 0) : null,
    powerRefl: atLoad.powerRefl, powerTrans: atLoad.powerTrans,
    resistancePath: sampleResistanceArc(atLoad.zNorm.re, 160),
    linePath: sampleLinePath(atLoad.gamma, theta, 72) }
}
