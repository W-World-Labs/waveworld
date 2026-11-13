/**
 * Bode magnitude (dB) + first-order low-pass · pure teaching stubs.
 * mag_dB = 20 log10(|H|); H(f) = 1/√(1+(f/f0)²).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Bode plot. */
export const METHOD_BODE = 'method-bode-plot'

/** Algo · magnitude in dB. */
export const METHOD_ALGO_BODE_MAG = 'method-algo-bode-mag-db'

/** Parent alias. */
export const BODE_PARENT = METHOD_BODE

export const BODE_METHOD_IDS = [METHOD_ALGO_BODE_MAG] as const

/** Default cutoff f0 (Hz). */
export const DEFAULT_F0 = 1000

/** Default evaluation frequency (Hz). */
export const DEFAULT_F = 1000

/**
 * Magnitude in decibels:
 *   mag_dB = 20 · log10(|H|)
 *
 * Requires Hmag > 0 and finite; else NaN.
 */
export function bodeMagDb(Hmag: number): number {
  if (!Number.isFinite(Hmag) || !(Hmag > 0)) return NaN
  return 20 * Math.log10(Hmag)
}

/**
 * First-order low-pass |H(f)| (teaching):
 *   |H| = 1 / √(1 + (f / f0)²)
 *
 * Requires f≥0, f0>0, finite; else NaN.
 */
export function lowPassMag(f: number, f0: number): number {
  if (
    !Number.isFinite(f) ||
    !Number.isFinite(f0) ||
    !(f >= 0) ||
    !(f0 > 0)
  ) {
    return NaN
  }
  const x = f / f0
  return 1 / Math.sqrt(1 + x * x)
}

/**
 * Combined: Bode dB of low-pass |H| at f.
 */
export function lowPassMagDb(f: number, f0: number): number {
  return bodeMagDb(lowPassMag(f, f0))
}

/**
 * Bode / low-pass sample: DC → 0 dB; f=f0 → −3 dB; high-f asymptote.
 */
export function runBodeMagSample(opts?: {
  f?: number
  f0?: number
}): {
  f: number
  f0: number
  Hmag: number
  magDb: number
  magDb_dc: number
  magDb_f0: number
  magDb_10f0: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BODE_MAG
  familyId: typeof METHOD_BODE
} {
  const f = opts?.f ?? DEFAULT_F
  const f0 = opts?.f0 ?? DEFAULT_F0

  const Hmag = lowPassMag(f, f0)
  const magDb = bodeMagDb(Hmag)
  const magDb_dc = lowPassMagDb(0, f0)
  const magDb_f0 = lowPassMagDb(f0, f0)
  const magDb_10f0 = lowPassMagDb(10 * f0, f0)

  const finite =
    Number.isFinite(Hmag) &&
    Number.isFinite(magDb) &&
    Number.isFinite(magDb_dc) &&
    Number.isFinite(magDb_f0) &&
    Number.isFinite(magDb_10f0)

  const formulaH =
    Math.abs(Hmag - 1 / Math.sqrt(1 + (f / f0) ** 2)) <
    1e-12 * Math.max(1e-30, Hmag)
  const formulaDb =
    Math.abs(magDb - 20 * Math.log10(Hmag)) <
    1e-10 * Math.max(1, Math.abs(magDb))
  // DC gain 0 dB
  const dcOk = Math.abs(magDb_dc) < 1e-12
  // corner ≈ −3.0103 dB
  const cornerOk = Math.abs(magDb_f0 - 20 * Math.log10(1 / Math.SQRT2)) < 1e-10
  // decade above: ~−20 dB/decade relative to corner region
  const rollOk = magDb_10f0 < magDb_f0 - 15
  const badOk = !Number.isFinite(bodeMagDb(0)) && !Number.isFinite(bodeMagDb(-1))

  const ok =
    finite && formulaH && formulaDb && dcOk && cornerOk && rollOk && badOk

  return {
    f,
    f0,
    Hmag,
    magDb,
    magDb_dc,
    magDb_f0,
    magDb_10f0,
    finite,
    ok,
    methodId: METHOD_ALGO_BODE_MAG,
    familyId: METHOD_BODE,
  }
}
