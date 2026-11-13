/**
 * Shockley diode equation · pure teaching toy.
 * Ideal diode: I = Is (exp(qV / (n kT)) − 1).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · diode equation / IV characteristic. */
export const METHOD_DIODE = 'method-diode-equation'

/** Algo · Shockley ideal diode current vs voltage. */
export const METHOD_ALGO_SHOCKLEY_DIODE = 'method-algo-shockley-diode'

/** Parent alias (aligns with familyId). */
export const DIODE_PARENT = METHOD_DIODE

export const DIODE_METHOD_IDS = [METHOD_ALGO_SHOCKLEY_DIODE] as const

/** SI elementary charge (C). */
export const QE = 1.602176634e-19

/** Boltzmann constant (J/K). */
export const KB = 1.380649e-23

/** Default thermal voltage scale: kT/q at 300 K ≈ 25.85 mV. */
export const T_DEFAULT = 300

/** Thermal voltage VT = kT/q (V). */
export function thermalVoltage(T: number = T_DEFAULT): number {
  if (!Number.isFinite(T) || !(T > 0)) return NaN
  return (KB * T) / QE
}

/**
 * Shockley diode current (A):
 *   I = Is · (exp(q V / (n k T)) − 1)
 *
 * Is: reverse saturation current (A)
 * V:  bias voltage (V)
 * n:  ideality factor (dimensionless, typically 1–2)
 * T:  absolute temperature (K)
 *
 * Uses expm1 for numerical stability at small V.
 * Large positive argument is clamped to avoid overflow (returns +∞).
 */
export function shockleyCurrent(
  V: number,
  Is: number,
  n: number = 1,
  T: number = T_DEFAULT,
): number {
  if (
    !Number.isFinite(V) ||
    !Number.isFinite(Is) ||
    !Number.isFinite(n) ||
    !Number.isFinite(T)
  ) {
    return NaN
  }
  if (!(Is >= 0) || !(n > 0) || !(T > 0)) return NaN
  if (Is === 0) return 0

  const VT = thermalVoltage(T)
  if (!Number.isFinite(VT) || !(VT > 0)) return NaN

  const x = V / (n * VT)
  // exp(x) overflow guard (~709 is ln(Number.MAX_VALUE))
  if (x > 700) return Infinity
  if (x < -700) return -Is // exp→0 ⇒ I → −Is
  return Is * Math.expm1(x)
}

/** One IV sample point. */
export type IvPoint = { V: number; I: number }

/**
 * Sample Shockley IV curve on a uniform voltage grid.
 * Returns V[], I[] of length n (default 41 over [Vmin, Vmax]).
 */
export function sampleShockleyIv(opts?: {
  Is?: number
  n?: number
  T?: number
  Vmin?: number
  Vmax?: number
  nPoints?: number
}): {
  V: Float64Array
  I: Float64Array
  Is: number
  n: number
  T: number
  points: IvPoint[]
  finite: boolean
} {
  const Is = opts?.Is ?? 1e-12
  const n = opts?.n ?? 1
  const T = opts?.T ?? T_DEFAULT
  const Vmin = opts?.Vmin ?? -0.2
  const Vmax = opts?.Vmax ?? 0.8
  const nPoints = opts?.nPoints ?? 41

  const count = Math.max(2, Math.floor(nPoints))
  const V = new Float64Array(count)
  const I = new Float64Array(count)
  const points: IvPoint[] = []
  let finite = true

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const v = Vmin + t * (Vmax - Vmin)
    const cur = shockleyCurrent(v, Is, n, T)
    V[i] = v
    I[i] = cur
    points.push({ V: v, I: cur })
    if (!Number.isFinite(cur)) {
      // allow only extreme ends to be ±∞ on wide ranges
      if (i > 0 && i < count - 1) finite = false
      else if (cur !== Infinity && cur !== -Infinity) finite = false
    }
  }

  return { V, I, Is, n, T, points, finite }
}

/**
 * Shockley diode sample: zero bias → I=0; reverse → near −Is;
 * forward grows with V; IV sample finite; formula check at one point.
 */
export function runShockleyDiodeSample(opts?: {
  Is?: number
  n?: number
  T?: number
  Vfwd?: number
}): {
  Is: number
  n: number
  T: number
  VT: number
  I_zero: number
  I_rev: number
  I_fwd: number
  I_fwd_higher: number
  Vfwd: number
  formulaI: number
  curveLen: number
  curveFinite: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SHOCKLEY_DIODE
  familyId: typeof METHOD_DIODE
} {
  const Is = opts?.Is ?? 1e-12
  const n = opts?.n ?? 1
  const T = opts?.T ?? T_DEFAULT
  const Vfwd = opts?.Vfwd ?? 0.6

  const VT = thermalVoltage(T)
  const I_zero = shockleyCurrent(0, Is, n, T)
  const I_rev = shockleyCurrent(-1, Is, n, T)
  const I_fwd = shockleyCurrent(Vfwd, Is, n, T)
  const I_fwd_higher = shockleyCurrent(Vfwd + 0.05, Is, n, T)

  // direct formula cross-check (expm1 path)
  const x = Vfwd / (n * VT)
  const formulaI = Is * Math.expm1(x)

  const curve = sampleShockleyIv({
    Is,
    n,
    T,
    Vmin: -0.3,
    Vmax: 0.7,
    nPoints: 51,
  })

  const finite =
    Number.isFinite(I_zero) &&
    Number.isFinite(I_rev) &&
    Number.isFinite(I_fwd) &&
    Number.isFinite(I_fwd_higher) &&
    Number.isFinite(VT) &&
    Number.isFinite(formulaI)

  const zeroOk = Math.abs(I_zero) < 1e-30 * Math.max(1, Is)
  const revOk = I_rev < 0 && I_rev > -Is * 1.001 && I_rev < -Is * 0.5
  const fwdOk = I_fwd > 0 && I_fwd_higher > I_fwd
  const formulaOk = Math.abs(I_fwd - formulaI) <= 1e-12 * Math.max(1, Math.abs(I_fwd))
  const curveOk = curve.points.length >= 2 && curve.finite

  const ok = finite && zeroOk && revOk && fwdOk && formulaOk && curveOk

  return {
    Is,
    n,
    T,
    VT,
    I_zero,
    I_rev,
    I_fwd,
    I_fwd_higher,
    Vfwd,
    formulaI,
    curveLen: curve.points.length,
    curveFinite: curve.finite,
    finite,
    ok,
    methodId: METHOD_ALGO_SHOCKLEY_DIODE,
    familyId: METHOD_DIODE,
  }
}
