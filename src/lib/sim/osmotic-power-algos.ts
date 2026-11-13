/**
 * Pressure-retarded osmosis (PRO) · pure teaching stubs.
 * van't Hoff π = i c R T; power P = η · Δπ · Q_volume.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · osmotic / PRO power. */
export const METHOD_PRO = 'method-osmotic-power'

/** Algo · PRO power density / power stub. */
export const METHOD_ALGO_PRO_POWER = 'method-algo-pro-power'

/** Parent alias (aligns with familyId). */
export const PRO_PARENT = METHOD_PRO

export const PRO_METHOD_IDS = [METHOD_ALGO_PRO_POWER] as const

/** Gas constant R (J/(mol·K)). */
export const R_GAS = 8.314462618

/** Default van't Hoff factor i (NaCl ≈ 2 teaching). */
export const DEFAULT_I = 2

/** Default concentration c (mol/m³); 0.6 M seawater-class. */
export const DEFAULT_C = 600

/** Default temperature T (K). */
export const DEFAULT_T = 298.15

/** Default PRO efficiency η (dimensionless teaching). */
export const DEFAULT_ETA = 0.4

/** Default volume flow Q (m³/s) for sample. */
export const DEFAULT_VOLUME_FLOW = 1e-3

/**
 * van't Hoff osmotic pressure:
 *   π = i · c · R · T
 *
 * i: van't Hoff factor, c: molar concentration (mol/m³),
 * R: gas constant (J/(mol·K)), T: absolute temperature (K).
 * Requires T>0, c≥0, finite; else NaN.
 */
export function vantHoffPi(
  i: number,
  c: number,
  R: number = R_GAS,
  T: number = DEFAULT_T,
): number {
  if (
    !Number.isFinite(i) ||
    !Number.isFinite(c) ||
    !Number.isFinite(R) ||
    !Number.isFinite(T) ||
    !(T > 0) ||
    !(c >= 0)
  ) {
    return NaN
  }
  return i * c * R * T
}

/**
 * PRO power stub:
 *   P = η · Δπ · Q_volume
 *
 * η: efficiency (0–1 teaching), Δπ: osmotic pressure difference (Pa),
 * Q_volume: volume flow (m³/s). Power in watts (teaching).
 * Non-finite or η out of [0,1] → NaN (allow η=0).
 */
export function proPower(
  eta: number,
  deltaPi: number,
  volumeFlow: number,
): number {
  if (
    !Number.isFinite(eta) ||
    !Number.isFinite(deltaPi) ||
    !Number.isFinite(volumeFlow) ||
    !(eta >= 0) ||
    !(eta <= 1)
  ) {
    return NaN
  }
  return eta * deltaPi * volumeFlow
}

/**
 * PRO sample: seawater-class π; power = η Δπ Q; linear in flow.
 */
export function runProPowerSample(opts?: {
  i?: number
  c?: number
  R?: number
  T?: number
  eta?: number
  volumeFlow?: number
}): {
  i: number
  c: number
  R: number
  T: number
  eta: number
  volumeFlow: number
  pi: number
  power: number
  power_doubleQ: number
  power_badEta: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PRO_POWER
  familyId: typeof METHOD_PRO
} {
  const i = opts?.i ?? DEFAULT_I
  const c = opts?.c ?? DEFAULT_C
  const R = opts?.R ?? R_GAS
  const T = opts?.T ?? DEFAULT_T
  const eta = opts?.eta ?? DEFAULT_ETA
  const volumeFlow = opts?.volumeFlow ?? DEFAULT_VOLUME_FLOW

  const pi = vantHoffPi(i, c, R, T)
  // Teaching: draw power against full π as Δπ
  const power = proPower(eta, pi, volumeFlow)
  const power_doubleQ = proPower(eta, pi, 2 * volumeFlow)
  const power_badEta = proPower(1.5, pi, volumeFlow)

  const finite =
    Number.isFinite(pi) &&
    Number.isFinite(power) &&
    Number.isFinite(power_doubleQ)

  const piOk = Math.abs(pi - i * c * R * T) < 1e-9 * Math.max(1, pi)
  const powerOk =
    Math.abs(power - eta * pi * volumeFlow) <
    1e-12 * Math.max(1, Math.abs(power))
  const linQ =
    Math.abs(power_doubleQ - 2 * power) <
    1e-12 * Math.max(1, Math.abs(power))
  const posOk = pi > 0 && power > 0
  const badOk = !Number.isFinite(power_badEta)

  const ok = finite && piOk && powerOk && linQ && posOk && badOk

  return {
    i,
    c,
    R,
    T,
    eta,
    volumeFlow,
    pi,
    power,
    power_doubleQ,
    power_badEta,
    finite,
    ok,
    methodId: METHOD_ALGO_PRO_POWER,
    familyId: METHOD_PRO,
  }
}
