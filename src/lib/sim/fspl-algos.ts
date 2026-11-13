/**
 * Free-space path loss (FSPL) · pure teaching stubs.
 * FSPL_dB = 20·log10(4π d f / c)  (SI: d in m, f in Hz, c = 3e8 m/s).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · free-space path loss. */
export const METHOD_FSPL = 'method-fspl'

/** Algo · FSPL in dB (SI). */
export const METHOD_ALGO_FSPL_DB = 'method-algo-fspl-db'

/** Parent alias (aligns with familyId). */
export const FSPL_PARENT = METHOD_FSPL

export const FSPL_METHOD_IDS = [METHOD_ALGO_FSPL_DB] as const

/** Speed of light (m/s) — teaching value. */
export const C_LIGHT = 3e8

/** Default range d (m). */
export const DEFAULT_D = 1000

/** Default frequency f (Hz) — 1 GHz. */
export const DEFAULT_F = 1e9

/**
 * Free-space path loss (dB), SI form:
 *   FSPL_dB = 20 · log₁₀(4π · d · f / c)
 *
 * Equivalent classic form:
 *   20·log10(d_km) + 20·log10(f_MHz) + 32.44
 *
 * d: distance (m), f: frequency (Hz), c: speed of light (m/s).
 * Requires d>0, f>0, c>0, finite; else NaN.
 */
export function fsplDb(
  d_m: number,
  f_Hz: number,
  c: number = C_LIGHT,
): number {
  if (
    !Number.isFinite(d_m) ||
    !Number.isFinite(f_Hz) ||
    !Number.isFinite(c) ||
    !(d_m > 0) ||
    !(f_Hz > 0) ||
    !(c > 0)
  ) {
    return NaN
  }
  return 20 * Math.log10((4 * Math.PI * d_m * f_Hz) / c)
}

/**
 * Classic engineering form (d in km, f in MHz):
 *   FSPL_dB = 20·log10(d_km) + 20·log10(f_MHz) + 32.44
 */
export function fsplDbClassic(d_km: number, f_MHz: number): number {
  if (
    !Number.isFinite(d_km) ||
    !Number.isFinite(f_MHz) ||
    !(d_km > 0) ||
    !(f_MHz > 0)
  ) {
    return NaN
  }
  return 20 * Math.log10(d_km) + 20 * Math.log10(f_MHz) + 32.44
}

/**
 * FSPL sample: SI formula; doubles with 2d or 2f (+6 dB); d≤0 illegal.
 */
export function runFsplDbSample(opts?: {
  d_m?: number
  f_Hz?: number
}): {
  d_m: number
  f_Hz: number
  FSPL_dB: number
  FSPL_doubleD: number
  FSPL_doubleF: number
  FSPL_classic: number
  FSPL_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FSPL_DB
  familyId: typeof METHOD_FSPL
} {
  const d_m = opts?.d_m ?? DEFAULT_D
  const f_Hz = opts?.f_Hz ?? DEFAULT_F

  const FSPL_dB = fsplDb(d_m, f_Hz)
  const FSPL_doubleD = fsplDb(2 * d_m, f_Hz)
  const FSPL_doubleF = fsplDb(d_m, 2 * f_Hz)
  const FSPL_classic = fsplDbClassic(d_m / 1000, f_Hz / 1e6)
  const FSPL_bad = fsplDb(0, f_Hz)

  const finite =
    Number.isFinite(FSPL_dB) &&
    Number.isFinite(FSPL_doubleD) &&
    Number.isFinite(FSPL_doubleF) &&
    Number.isFinite(FSPL_classic)

  const expected = 20 * Math.log10((4 * Math.PI * d_m * f_Hz) / C_LIGHT)
  const formulaOk =
    Math.abs(FSPL_dB - expected) < 1e-10 * Math.max(1, Math.abs(FSPL_dB))
  // 2× distance or frequency ⇒ +6.0206… dB
  const doubleDOk = Math.abs(FSPL_doubleD - (FSPL_dB + 20 * Math.log10(2))) < 1e-9
  const doubleFOk = Math.abs(FSPL_doubleF - (FSPL_dB + 20 * Math.log10(2))) < 1e-9
  // classic ≈ SI within ~0.05 dB (c=3e8 vs 2.998e8 + rounded 32.44)
  const classicOk = Math.abs(FSPL_classic - FSPL_dB) < 0.1
  const badOk = !Number.isFinite(FSPL_bad)
  const positiveOk = FSPL_dB > 0

  const ok =
    finite &&
    formulaOk &&
    doubleDOk &&
    doubleFOk &&
    classicOk &&
    badOk &&
    positiveOk

  return {
    d_m,
    f_Hz,
    FSPL_dB,
    FSPL_doubleD,
    FSPL_doubleF,
    FSPL_classic,
    FSPL_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_FSPL_DB,
    familyId: METHOD_FSPL,
  }
}
