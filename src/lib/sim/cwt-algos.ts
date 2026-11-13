/**
 * Continuous wavelet transform (CWT) · Mexican-hat (Ricker) pure 1D.
 * Scales × time coefficients; scaleogram peak near sine period (loose).
 * method id constants only; no methods.data / registry / edges.
 * Parent family: method-cwt (standalone; not method-wavelet).
 */

/** Family · continuous wavelet transform. */
export const METHOD_CWT = 'method-cwt'

/** Algo · Mexican-hat (Ricker) CWT. */
export const METHOD_ALGO_CWT_MEXHAT = 'method-algo-cwt-mexhat'

/** Parent alias (aligns with familyId). */
export const CWT_PARENT = METHOD_CWT

export const CWT_METHOD_IDS = [METHOD_ALGO_CWT_MEXHAT] as const

/**
 * Mexican-hat (Ricker) mother wavelet at dimensionless τ:
 * ψ(τ) = (1 − τ²) exp(−τ² / 2).
 * (Unnormalized; CWT uses 1/√a dilation. Fourier peak at ω=√2.)
 */
export function mexicanHat(tau: number): number {
  const t2 = tau * tau
  return (1 - t2) * Math.exp(-0.5 * t2)
}

/**
 * Theoretical scale for a pure sine of period T (samples, dt=1):
 * Mexican-hat FT peaks at ω=√2, so a* = T / (π √2)  (T = 2π a / √2).
 */
export function mexhatPeriodToScale(period: number): number {
  if (!(period > 0)) throw new Error('mexhatPeriodToScale: period > 0')
  return period / (Math.PI * Math.SQRT2)
}

/**
 * Inverse: period corresponding to scale a (samples).
 */
export function mexhatScaleToPeriod(scale: number): number {
  if (!(scale > 0)) throw new Error('mexhatScaleToPeriod: scale > 0')
  return scale * Math.PI * Math.SQRT2
}

/**
 * CWT coefficient matrix: coeffs[sIdx * N + t] = W(a_s, t).
 * W(a,b) = a^{−1/2} Σ_n x[n] ψ((n − b) / a)  (dt=1, real).
 * Support truncated at |τ| ≤ supportHalf (default 5).
 */
export function cwtMexhat(
  x: ArrayLike<number>,
  scales: ArrayLike<number>,
  supportHalf = 5,
): {
  coeffs: Float64Array
  nTime: number
  nScales: number
} {
  const N = x.length
  const S = scales.length
  if (N < 4) throw new Error('cwtMexhat: signal length ≥ 4')
  if (S < 1) throw new Error('cwtMexhat: need ≥ 1 scale')
  for (let s = 0; s < S; s++) {
    if (!(scales[s]! > 0)) throw new Error('cwtMexhat: scales must be > 0')
  }
  const coeffs = new Float64Array(S * N)
  for (let si = 0; si < S; si++) {
    const a = scales[si]!
    const invSqrtA = 1 / Math.sqrt(a)
    const half = Math.ceil(supportHalf * a)
    for (let b = 0; b < N; b++) {
      let w = 0
      const n0 = Math.max(0, b - half)
      const n1 = Math.min(N - 1, b + half)
      for (let n = n0; n <= n1; n++) {
        const tau = (n - b) / a
        w += x[n]! * mexicanHat(tau)
      }
      coeffs[si * N + b] = invSqrtA * w
    }
  }
  return { coeffs, nTime: N, nScales: S }
}

/**
 * Scaleogram energy per scale: E[s] = Σ_t |W(s,t)|².
 */
export function scaleogramEnergy(
  coeffs: ArrayLike<number>,
  nScales: number,
  nTime: number,
): Float64Array {
  if (coeffs.length !== nScales * nTime) {
    throw new Error('scaleogramEnergy: coeffs length mismatch')
  }
  const E = new Float64Array(nScales)
  for (let s = 0; s < nScales; s++) {
    let e = 0
    const base = s * nTime
    for (let t = 0; t < nTime; t++) {
      const c = coeffs[base + t]!
      e += c * c
    }
    E[s] = e
  }
  return E
}

/** Index of maximum in array. */
export function argmax(v: ArrayLike<number>): number {
  if (v.length === 0) throw new Error('argmax: empty')
  let best = 0
  let bestV = v[0]!
  for (let i = 1; i < v.length; i++) {
    if (v[i]! > bestV) {
      bestV = v[i]!
      best = i
    }
  }
  return best
}

/**
 * Linear scale grid from aMin to aMax inclusive, count points.
 */
export function linspaceScales(aMin: number, aMax: number, count: number): Float64Array {
  if (!(count >= 2) || !(aMin > 0) || !(aMax > aMin)) {
    throw new Error('linspaceScales: need count≥2, 0 < aMin < aMax')
  }
  const out = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    out[i] = aMin + ((aMax - aMin) * i) / (count - 1)
  }
  return out
}

/**
 * Representative sample: pure sine of known period; CWT Mexhat scaleogram
 * peak scale near theoretical a* = T/(π√2) (loose tolerance).
 */
export function runCwtMexhatSample(opts?: {
  N?: number
  period?: number
  nScales?: number
}): {
  N: number
  period: number
  peakScale: number
  expectedScale: number
  scaleRelErr: number
  peakNearPeriod: boolean
  energyMax: number
  nScales: number
  ok: boolean
  methodId: typeof METHOD_ALGO_CWT_MEXHAT
  familyId: typeof METHOD_CWT
} {
  const N = Math.max(64, opts?.N ?? 128)
  const period = opts?.period ?? 16
  const nScales = Math.max(8, opts?.nScales ?? 24)

  const x = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    x[n] = Math.sin((2 * Math.PI * n) / period)
  }

  const expectedScale = mexhatPeriodToScale(period)
  // scan a band around theoretical peak (factor 0.4…2.5)
  const aMin = expectedScale * 0.4
  const aMax = expectedScale * 2.5
  const scales = linspaceScales(aMin, aMax, nScales)
  const { coeffs } = cwtMexhat(x, scales)
  const E = scaleogramEnergy(coeffs, nScales, N)
  const iPeak = argmax(E)
  const peakScale = scales[iPeak]!
  const scaleRelErr =
    expectedScale > 0 ? Math.abs(peakScale - expectedScale) / expectedScale : 1
  // loose: within 50% relative (discretization + edge effects)
  const peakNearPeriod = scaleRelErr < 0.5
  const energyMax = E[iPeak]!
  const ok =
    peakNearPeriod &&
    energyMax > 0 &&
    Number.isFinite(peakScale) &&
    Number.isFinite(energyMax)

  return {
    N,
    period,
    peakScale,
    expectedScale,
    scaleRelErr,
    peakNearPeriod,
    energyMax,
    nScales,
    ok,
    methodId: METHOD_ALGO_CWT_MEXHAT,
    familyId: METHOD_CWT,
  }
}
