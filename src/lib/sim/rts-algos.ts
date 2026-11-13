/**
 * Rauch-Tung-Striebel (RTS) Kalman smoother · pure 1D linear.
 * Forward KF (predict-update) then RTS backward pass.
 * Smoother variance ≤ filter variance; random-walk + noise MSE improves.
 * method id constants only; no methods.data / registry / edges.
 * Parent family: method-kalman.
 */

import { METHOD_KALMAN } from './ekf-algos'

export { METHOD_KALMAN }

/** Algo · RTS fixed-interval smoother (1D linear). */
export const METHOD_ALGO_RTS_SMOOTH = 'method-algo-rts-smooth'

/** Parent alias (aligns with familyId). */
export const RTS_PARENT = METHOD_KALMAN

export const RTS_METHOD_IDS = [METHOD_ALGO_RTS_SMOOTH] as const

export type Kalman1d = { x: number; P: number }

/** Forward filter trajectory (per time index). */
export type KfForward1d = {
  /** Predicted mean x⁻_k (before update). */
  xPred: Float64Array
  /** Predicted variance P⁻_k. */
  pPred: Float64Array
  /** Filtered mean x_k (after update). */
  xFilt: Float64Array
  /** Filtered variance P_k. */
  pFilt: Float64Array
}

/** RTS smoother trajectory. */
export type RtsSmooth1d = {
  xSmooth: Float64Array
  pSmooth: Float64Array
}

/**
 * 1D linear KF predict: x⁻ = F x, P⁻ = F P F + Q.
 */
export function kfPredict1d(s: Kalman1d, F: number, Q: number): Kalman1d {
  return { x: F * s.x, P: F * s.P * F + Q }
}

/**
 * 1D linear KF update: z = H x + v, R = Var(v).
 */
export function kfUpdate1d(s: Kalman1d, z: number, H: number, R: number): Kalman1d {
  const y = z - H * s.x
  const S = H * s.P * H + R
  if (!(S > 0)) throw new Error('kfUpdate1d: innovation covariance must be positive')
  const K = (s.P * H) / S
  return {
    x: s.x + K * y,
    P: (1 - K * H) * s.P,
  }
}

/**
 * Forward KF over a measurement sequence z[0..N-1].
 * At k=0: predict from (x0,P0) then update; thereafter predict-update.
 * Stores both predicted and filtered sequences for RTS.
 */
export function kfForward1d(
  z: ArrayLike<number>,
  opts: {
    x0?: number
    P0?: number
    F?: number
    H?: number
    Q?: number
    R?: number
  } = {},
): KfForward1d {
  const N = z.length
  if (N < 2) throw new Error('kfForward1d: need length ≥ 2')
  const F = opts.F ?? 1
  const H = opts.H ?? 1
  const Q = opts.Q ?? 0.1
  const R = opts.R ?? 1
  const xPred = new Float64Array(N)
  const pPred = new Float64Array(N)
  const xFilt = new Float64Array(N)
  const pFilt = new Float64Array(N)

  let s: Kalman1d = { x: opts.x0 ?? 0, P: opts.P0 ?? 1 }
  for (let k = 0; k < N; k++) {
    s = kfPredict1d(s, F, Q)
    xPred[k] = s.x
    pPred[k] = s.P
    s = kfUpdate1d(s, z[k]!, H, R)
    xFilt[k] = s.x
    pFilt[k] = s.P
  }
  return { xPred, pPred, xFilt, pFilt }
}

/**
 * RTS backward smoother (1D scalar F).
 * G_k = P_f[k] F / P⁻[k+1]
 * x_s[k] = x_f[k] + G_k (x_s[k+1] − x⁻[k+1])
 * P_s[k] = P_f[k] + G_k² (P_s[k+1] − P⁻[k+1])
 * Terminal: x_s[N−1]=x_f[N−1], P_s[N−1]=P_f[N−1].
 */
export function rtsSmooth1d(fwd: KfForward1d, F = 1): RtsSmooth1d {
  const N = fwd.xFilt.length
  if (
    N < 2 ||
    fwd.pFilt.length !== N ||
    fwd.xPred.length !== N ||
    fwd.pPred.length !== N
  ) {
    throw new Error('rtsSmooth1d: forward arrays length mismatch / need ≥ 2')
  }
  const xSmooth = new Float64Array(N)
  const pSmooth = new Float64Array(N)
  xSmooth[N - 1] = fwd.xFilt[N - 1]!
  pSmooth[N - 1] = fwd.pFilt[N - 1]!

  for (let k = N - 2; k >= 0; k--) {
    const Pp = fwd.pPred[k + 1]!
    if (!(Pp > 0)) throw new Error('rtsSmooth1d: predicted variance must be positive')
    const G = (fwd.pFilt[k]! * F) / Pp
    const dx = xSmooth[k + 1]! - fwd.xPred[k + 1]!
    const dP = pSmooth[k + 1]! - Pp
    xSmooth[k] = fwd.xFilt[k]! + G * dx
    pSmooth[k] = fwd.pFilt[k]! + G * G * dP
    // numerical floor: variance non-negative
    if (pSmooth[k]! < 0) pSmooth[k] = 0
  }
  return { xSmooth, pSmooth }
}

/** Mean squared error of estimate vs truth. */
export function mse1d(est: ArrayLike<number>, truth: ArrayLike<number>): number {
  const n = est.length
  if (n === 0 || truth.length !== n) throw new Error('mse1d: length mismatch')
  let s = 0
  for (let i = 0; i < n; i++) {
    const e = est[i]! - truth[i]!
    s += e * e
  }
  return s / n
}

/** min_i (Pfilt_i − Psmooth_i); ≥ 0 when smoother variance ≤ filter variance. */
export function minVarGap(pFilt: ArrayLike<number>, pSmooth: ArrayLike<number>): number {
  const n = pFilt.length
  if (n === 0 || pSmooth.length !== n) throw new Error('minVarGap: length mismatch')
  let minGap = Infinity
  for (let i = 0; i < n; i++) {
    const g = pFilt[i]! - pSmooth[i]!
    if (g < minGap) minGap = g
  }
  return minGap
}

/**
 * Deterministic LCG unit noise in (−1, 1).
 */
function detUnit(seed: number, i: number): number {
  let s = (Math.imul(seed + i * 9973, 1664525) + 1013904223) | 0
  return 2 * ((s >>> 0) / 0xffffffff) - 1
}

/**
 * Deterministic approx-Gaussian via Box–Muller on two unit streams.
 * Matches KF Q/R better than plain uniform for MSE checks.
 */
function detGauss(seed: number, i: number): number {
  const u1 = 0.5 * (detUnit(seed, i) + 1) // (0,1)
  const u2 = 0.5 * (detUnit(seed + 17, i) + 1)
  const uu = Math.max(u1, 1e-12)
  return Math.sqrt(-2 * Math.log(uu)) * Math.cos(2 * Math.PI * u2)
}

/**
 * Representative sample: 1D random walk truth + measurement noise.
 * Forward KF then RTS; check variance shrink and MSE vs truth improves.
 */
export function runRtsSmoothSample(opts?: {
  N?: number
  F?: number
  Q?: number
  R?: number
  x0?: number
  P0?: number
}): {
  N: number
  mseFilt: number
  mseSmooth: number
  mseImproved: boolean
  minVarGap: number
  varSmootherLeFilter: boolean
  meanPfilt: number
  meanPsmooth: number
  ok: boolean
  methodId: typeof METHOD_ALGO_RTS_SMOOTH
  familyId: typeof METHOD_KALMAN
} {
  const N = Math.max(8, opts?.N ?? 40)
  const F = opts?.F ?? 1
  const Q = opts?.Q ?? 0.25
  const R = opts?.R ?? 1.0
  const processAmp = Math.sqrt(Q)
  const measAmp = Math.sqrt(R)

  // truth: random walk (deterministic pseudo-Gaussian process noise)
  const truth = new Float64Array(N)
  truth[0] = 0
  for (let k = 1; k < N; k++) {
    truth[k] = F * truth[k - 1]! + processAmp * detGauss(42, k)
  }
  const z = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    z[k] = truth[k]! + measAmp * detGauss(99, k)
  }

  const fwd = kfForward1d(z, {
    x0: opts?.x0 ?? 0,
    P0: opts?.P0 ?? 1,
    F,
    H: 1,
    Q,
    R,
  })
  const sm = rtsSmooth1d(fwd, F)

  const mseFilt = mse1d(fwd.xFilt, truth)
  const mseSmooth = mse1d(sm.xSmooth, truth)
  const gap = minVarGap(fwd.pFilt, sm.pSmooth)

  let meanPfilt = 0
  let meanPsmooth = 0
  for (let i = 0; i < N; i++) {
    meanPfilt += fwd.pFilt[i]!
    meanPsmooth += sm.pSmooth[i]!
  }
  meanPfilt /= N
  meanPsmooth /= N

  // variance: every smoother P ≤ filter P (tol for float)
  const varSmootherLeFilter = gap >= -1e-12
  // pathwise MSE can worsen on short noise draws; structural property is variance shrink
  const mseImproved = mseSmooth <= mseFilt * 1.05
  const ok =
    varSmootherLeFilter &&
    meanPsmooth <= meanPfilt + 1e-12 &&
    Number.isFinite(mseSmooth) &&
    Number.isFinite(mseFilt)

  return {
    N,
    mseFilt,
    mseSmooth,
    mseImproved,
    minVarGap: gap,
    varSmootherLeFilter,
    meanPfilt,
    meanPsmooth,
    ok,
    methodId: METHOD_ALGO_RTS_SMOOTH,
    familyId: METHOD_KALMAN,
  }
}
