/**
 * Alternating Direction Implicit (ADI) · 2D heat teaching stubs.
 * Peaceman–Rachford: half-step x-implicit, half-step y-implicit via 1D Thomas.
 * method id constants only; no methods.data / moduleRegistry / edges.
 */
import { solveTridiagThomas } from './heat-l2-algos'

/** Family · ADI. */
export const METHOD_ADI = 'method-adi'

/** Algo · Peaceman–Rachford 2D heat. */
export const METHOD_ALGO_ADI_HEAT = 'method-algo-adi-heat'

/** Algo · directional x/y Thomas sweeps. */
export const METHOD_ALGO_ADI_SWEEP = 'method-algo-adi-sweep'

/** Parent alias (aligns with familyId). */
export const ADI_PARENT = METHOD_ADI

export const ADI_METHOD_IDS = [
  METHOD_ALGO_ADI_HEAT,
  METHOD_ALGO_ADI_SWEEP,
] as const

export { solveTridiagThomas }

/** ‖v‖₂. */
export function norm2(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** max |v_i|. */
export function maxAbs(v: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]!)
    if (a > m) m = a
  }
  return m
}

/** Discrete L2 energy on interior (h-weighted sum of squares). */
export function energyL2(u: ArrayLike<number>, n: number, h: number): number {
  let s = 0
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const v = u[j * n + i]!
      s += v * v
    }
  }
  return s * h * h
}

/** Force Dirichlet boundary to 0 (in place). */
export function applyDirichlet0(u: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    u[i] = 0
    u[(n - 1) * n + i] = 0
    u[i * n] = 0
    u[i * n + (n - 1)] = 0
  }
}

/**
 * Centered Gaussian blob on unit square, Dirichlet 0 on boundary.
 * Row-major n×n; x_i = i h, h = 1/(n−1).
 */
export function gaussianIC2d(n: number, sigma = 0.12): Float64Array {
  if (n < 3) throw new Error('gaussianIC2d: n ≥ 3')
  const h = 1 / (n - 1)
  const u = new Float64Array(n * n)
  const cx = 0.5
  const cy = 0.5
  const inv2s2 = 1 / (2 * sigma * sigma)
  for (let j = 1; j < n - 1; j++) {
    const y = j * h
    for (let i = 1; i < n - 1; i++) {
      const x = i * h
      const dx = x - cx
      const dy = y - cy
      u[j * n + i] = Math.exp(-(dx * dx + dy * dy) * inv2s2)
    }
  }
  return u
}

/**
 * Sine mode sin(p π x) sin(q π y) on unit square (Dirichlet eigenmode).
 * Continuous decay rate for heat u_t = α ∇²u: exp(−α π² (p²+q²) t).
 */
export function sineModeIC2d(n: number, p = 1, q = 1): Float64Array {
  if (n < 3) throw new Error('sineModeIC2d: n ≥ 3')
  const h = 1 / (n - 1)
  const u = new Float64Array(n * n)
  for (let j = 0; j < n; j++) {
    const sy = Math.sin(q * Math.PI * j * h)
    for (let i = 0; i < n; i++) {
      u[j * n + i] = Math.sin(p * Math.PI * i * h) * sy
    }
  }
  return u
}

/**
 * Discrete second-difference eigenvalue of mode k on n points, h=1/(n−1):
 * δ_xx sin(k π i h) = σ sin(...), σ = −4 sin²(k π h / 2).
 */
export function discreteSigma(n: number, k: number): number {
  const h = 1 / (n - 1)
  const s = Math.sin((k * Math.PI * h) / 2)
  return -4 * s * s
}

/**
 * Peaceman–Rachford amplification for eigenmode (p,q) with equal spacing.
 * μ = α Δt / (2 h²) = r/2 with r = α Δt / h².
 * g = [(1 + μ σ_q) / (1 − μ σ_p)] · [(1 + μ σ_p) / (1 − μ σ_q)].
 */
export function prAmplification(
  n: number,
  r: number,
  p = 1,
  q = 1,
): number {
  const mu = 0.5 * r
  const sx = discreteSigma(n, p)
  const sy = discreteSigma(n, q)
  return ((1 + mu * sy) / (1 - mu * sx)) * ((1 + mu * sx) / (1 - mu * sy))
}

/**
 * Half-step: x-implicit, y-explicit (Peaceman–Rachford stage 1).
 * (I − μ δ_xx) u* = (I + μ δ_yy) u, μ = r/2, r = α Δt / h².
 * Row-major n×n; Dirichlet boundary held at current boundary values (0).
 */
export function adiHalfStepX(
  u: ArrayLike<number>,
  n: number,
  r: number,
  out?: Float64Array,
): Float64Array {
  if (u.length !== n * n) throw new Error('adiHalfStepX: length mismatch')
  if (n < 3) throw new Error('adiHalfStepX: n ≥ 3')
  const mu = 0.5 * r
  const dest = out ?? new Float64Array(n * n)
  // keep boundary from u
  for (let i = 0; i < n; i++) {
    dest[i] = u[i]!
    dest[(n - 1) * n + i] = u[(n - 1) * n + i]!
    dest[i * n] = u[i * n]!
    dest[i * n + (n - 1)] = u[i * n + (n - 1)]!
  }

  const m = n - 2
  const a = new Float64Array(m)
  const b = new Float64Array(m)
  const c = new Float64Array(m)
  const d = new Float64Array(m)
  for (let k = 0; k < m; k++) {
    a[k] = -mu
    b[k] = 1 + 2 * mu
    c[k] = -mu
  }
  a[0] = 0
  c[m - 1] = 0

  // for each interior row j
  for (let j = 1; j < n - 1; j++) {
    for (let k = 0; k < m; k++) {
      const i = k + 1
      const idx = j * n + i
      const up = u[(j - 1) * n + i]!
      const mid = u[idx]!
      const dn = u[(j + 1) * n + i]!
      // RHS = u + μ δ_yy u
      d[k] = mid + mu * (up - 2 * mid + dn)
    }
    // Dirichlet left/right of this row
    const left = u[j * n]!
    const right = u[j * n + (n - 1)]!
    d[0]! += mu * left
    d[m - 1]! += mu * right

    const interior = solveTridiagThomas(a, b, c, d)
    for (let k = 0; k < m; k++) dest[j * n + (k + 1)] = interior[k]!
  }
  return dest
}

/**
 * Half-step: y-implicit, x-explicit (Peaceman–Rachford stage 2).
 * (I − μ δ_yy) u^{n+1} = (I + μ δ_xx) u*.
 */
export function adiHalfStepY(
  u: ArrayLike<number>,
  n: number,
  r: number,
  out?: Float64Array,
): Float64Array {
  if (u.length !== n * n) throw new Error('adiHalfStepY: length mismatch')
  if (n < 3) throw new Error('adiHalfStepY: n ≥ 3')
  const mu = 0.5 * r
  const dest = out ?? new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    dest[i] = u[i]!
    dest[(n - 1) * n + i] = u[(n - 1) * n + i]!
    dest[i * n] = u[i * n]!
    dest[i * n + (n - 1)] = u[i * n + (n - 1)]!
  }

  const m = n - 2
  const a = new Float64Array(m)
  const b = new Float64Array(m)
  const c = new Float64Array(m)
  const d = new Float64Array(m)
  for (let k = 0; k < m; k++) {
    a[k] = -mu
    b[k] = 1 + 2 * mu
    c[k] = -mu
  }
  a[0] = 0
  c[m - 1] = 0

  // for each interior column i
  for (let i = 1; i < n - 1; i++) {
    for (let k = 0; k < m; k++) {
      const j = k + 1
      const idx = j * n + i
      const lf = u[j * n + (i - 1)]!
      const mid = u[idx]!
      const rt = u[j * n + (i + 1)]!
      d[k] = mid + mu * (lf - 2 * mid + rt)
    }
    const bottom = u[i]! // j=0
    const top = u[(n - 1) * n + i]!
    d[0]! += mu * bottom
    d[m - 1]! += mu * top

    const interior = solveTridiagThomas(a, b, c, d)
    for (let k = 0; k < m; k++) dest[(k + 1) * n + i] = interior[k]!
  }
  return dest
}

/**
 * One full Peaceman–Rachford step: x-implicit half, then y-implicit half.
 * r = α Δt / h² (may exceed explicit FTCS limit 0.25; ADI is unconditionally stable).
 */
export function peacemanRachfordStep(
  u: ArrayLike<number>,
  n: number,
  r: number,
): Float64Array {
  const mid = adiHalfStepX(u, n, r)
  return adiHalfStepY(mid, n, r)
}

/** Integrate PR for `steps` steps; returns final field. */
export function integrateAdiHeat(
  u0: ArrayLike<number>,
  n: number,
  r: number,
  steps: number,
): Float64Array {
  let u = new Float64Array(u0.length)
  for (let i = 0; i < u0.length; i++) u[i] = u0[i]!
  for (let s = 0; s < steps; s++) u = new Float64Array(peacemanRachfordStep(u, n, r))
  return u
}

function allFinite(u: ArrayLike<number>): boolean {
  for (let i = 0; i < u.length; i++) {
    if (!Number.isFinite(u[i]!)) return false
  }
  return true
}

function boundaryMaxAbs(u: ArrayLike<number>, n: number): number {
  let m = 0
  for (let i = 0; i < n; i++) {
    m = Math.max(
      m,
      Math.abs(u[i]!),
      Math.abs(u[(n - 1) * n + i]!),
      Math.abs(u[i * n]!),
      Math.abs(u[i * n + (n - 1)]!),
    )
  }
  return m
}

/**
 * Sample: 2D heat on small grid (default 16×16), Gaussian IC, Dirichlet 0.
 * Energy and max decrease; large-r remains finite (unconditional stability probe).
 */
export function runAdiHeatSample(opts?: {
  n?: number
  r?: number
  steps?: number
}): {
  n: number
  h: number
  r: number
  steps: number
  max0: number
  maxAfter: number
  energy0: number
  energyAfter: number
  maxDropped: boolean
  energyDropped: boolean
  boundaryOk: boolean
  /** large-r probe (r=2) still finite and max drops */
  largeR: {
    r: number
    finite: boolean
    maxDropped: boolean
    maxAfter: number
  }
  /** sine-mode amplitude ratio vs discrete PR factor (loose) */
  mode: {
    amp0: number
    ampAfter: number
    ratio: number
    theoryRatio: number
    relErr: number
  }
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ADI_HEAT
  familyId: typeof METHOD_ADI
} {
  const n = opts?.n ?? 16
  const r = opts?.r ?? 0.4
  const steps = opts?.steps ?? 20
  if (n < 5) throw new Error('runAdiHeatSample: n ≥ 5')

  const h = 1 / (n - 1)
  const u0 = gaussianIC2d(n)
  const max0 = maxAbs(u0)
  const energy0 = energyL2(u0, n, h)

  const u = integrateAdiHeat(u0, n, r, steps)
  const maxAfter = maxAbs(u)
  const energyAfter = energyL2(u, n, h)
  const boundaryOk = boundaryMaxAbs(u, n) < 1e-12
  const finite = allFinite(u)

  // large r stability
  const rBig = 2.0
  const uBig = integrateAdiHeat(u0, n, rBig, 12)
  const maxBig = maxAbs(uBig)
  const largeFinite = allFinite(uBig)

  // sine mode decay vs discrete theory
  const sm0 = sineModeIC2d(n, 1, 1)
  const smSteps = 8
  const smR = 0.5
  const sm = integrateAdiHeat(sm0, n, smR, smSteps)
  // amplitude at center-ish (max for positive mode)
  const amp0 = maxAbs(sm0)
  const ampAfter = maxAbs(sm)
  const theoryG = prAmplification(n, smR, 1, 1)
  const theoryRatio = Math.pow(theoryG, smSteps)
  const ratio = amp0 > 0 ? ampAfter / amp0 : 0
  const relErr =
    theoryRatio > 0 ? Math.abs(ratio - theoryRatio) / theoryRatio : 1

  const maxDropped = maxAfter < max0
  const energyDropped = energyAfter < energy0
  const ok =
    finite &&
    maxDropped &&
    energyDropped &&
    boundaryOk &&
    largeFinite &&
    maxBig < max0 &&
    relErr < 0.15 &&
    ampAfter < amp0

  return {
    n,
    h,
    r,
    steps,
    max0,
    maxAfter,
    energy0,
    energyAfter,
    maxDropped,
    energyDropped,
    boundaryOk,
    largeR: {
      r: rBig,
      finite: largeFinite,
      maxDropped: maxBig < max0,
      maxAfter: maxBig,
    },
    mode: {
      amp0,
      ampAfter,
      ratio,
      theoryRatio,
      relErr,
    },
    finite,
    ok,
    methodId: METHOD_ALGO_ADI_HEAT,
    familyId: METHOD_ADI,
  }
}

/**
 * Sample: directional Thomas sweeps — x-row then y-column half-steps.
 * Verifies each half-step is finite, boundary fixed, and full PR = X then Y.
 * Also checks multi-sweep energy decrease on sine mode.
 */
export function runAdiSweepSample(opts?: {
  n?: number
  r?: number
  sweeps?: number
}): {
  n: number
  r: number
  sweeps: number
  /** after x-half only */
  afterX: { max: number; energy: number; finite: boolean; boundaryOk: boolean }
  /** after full PR (X then Y) */
  afterXY: { max: number; energy: number; finite: boolean; boundaryOk: boolean }
  /** multi full PR sweeps: energy decreases monotonically (sampled) */
  energySequence: number[]
  energyMonotone: boolean
  /** composition: peacemanRachfordStep equals halfY(halfX) */
  compositionMatch: boolean
  compositionErr: number
  /** mode decay loosely tracks discrete PR factor */
  modeRelErr: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ADI_SWEEP
  familyId: typeof METHOD_ADI
} {
  const n = opts?.n ?? 16
  const r = opts?.r ?? 0.6
  const sweeps = opts?.sweeps ?? 10
  if (n < 5) throw new Error('runAdiSweepSample: n ≥ 5')

  const h = 1 / (n - 1)
  const u0 = gaussianIC2d(n, 0.1)

  const ux = adiHalfStepX(u0, n, r)
  const afterX = {
    max: maxAbs(ux),
    energy: energyL2(ux, n, h),
    finite: allFinite(ux),
    boundaryOk: boundaryMaxAbs(ux, n) < 1e-12,
  }

  const uxy = adiHalfStepY(ux, n, r)
  const pr = peacemanRachfordStep(u0, n, r)
  let compositionErr = 0
  for (let i = 0; i < pr.length; i++) {
    const e = Math.abs(pr[i]! - uxy[i]!)
    if (e > compositionErr) compositionErr = e
  }

  const afterXY = {
    max: maxAbs(uxy),
    energy: energyL2(uxy, n, h),
    finite: allFinite(uxy),
    boundaryOk: boundaryMaxAbs(uxy, n) < 1e-12,
  }

  // multi-sweep energy on sine mode
  let u = sineModeIC2d(n, 1, 1)
  const energySequence: number[] = [energyL2(u, n, h)]
  for (let s = 0; s < sweeps; s++) {
    u = peacemanRachfordStep(u, n, r)
    energySequence.push(energyL2(u, n, h))
  }
  let energyMonotone = true
  for (let s = 1; s < energySequence.length; s++) {
    if (!(energySequence[s]! <= energySequence[s - 1]! * (1 + 1e-12))) {
      energyMonotone = false
      break
    }
  }

  const amp0 = maxAbs(sineModeIC2d(n, 1, 1))
  const ampEnd = maxAbs(u)
  const theoryRatio = Math.pow(prAmplification(n, r, 1, 1), sweeps)
  const ratio = amp0 > 0 ? ampEnd / amp0 : 0
  const modeRelErr =
    theoryRatio > 0 ? Math.abs(ratio - theoryRatio) / theoryRatio : 1

  const compositionMatch = compositionErr < 1e-14
  const finite = afterX.finite && afterXY.finite && allFinite(u)
  const ok =
    finite &&
    afterX.boundaryOk &&
    afterXY.boundaryOk &&
    compositionMatch &&
    energyMonotone &&
    afterXY.max < maxAbs(u0) + 1e-12 &&
    modeRelErr < 0.15 &&
    ampEnd < amp0

  return {
    n,
    r,
    sweeps,
    afterX,
    afterXY,
    energySequence,
    energyMonotone,
    compositionMatch,
    compositionErr,
    modeRelErr,
    finite,
    ok,
    methodId: METHOD_ALGO_ADI_SWEEP,
    familyId: METHOD_ADI,
  }
}
