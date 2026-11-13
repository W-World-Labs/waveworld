/**
 * Mach–Zehnder interferometer · pure teaching stubs.
 * I = I0 · cos²(δ/2) with δ phase difference.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Mach–Zehnder interferometer. */
export const METHOD_MZ = 'method-mach-zehnder'

/** Algo · intensity I = I0 cos²(δ/2). */
export const METHOD_ALGO_MZ_I = 'method-algo-mz-intensity'

/** Parent alias (aligns with familyId). */
export const MZ_PARENT = METHOD_MZ

export const MZ_METHOD_IDS = [METHOD_ALGO_MZ_I] as const

/** Default peak intensity I0. */
export const DEFAULT_I0 = 1

/** Default phase difference δ (rad). */
export const DEFAULT_DELTA = Math.PI / 3

/**
 * Two-beam Mach–Zehnder intensity (equal amplitudes):
 *   I = I0 · cos²(δ / 2)
 *
 * delta: relative phase (rad), I0: peak intensity.
 * Requires I0≥0, finite; else NaN.
 */
export function mzIntensity(delta: number, I0: number = DEFAULT_I0): number {
  if (!Number.isFinite(delta) || !Number.isFinite(I0) || !(I0 >= 0)) {
    return NaN
  }
  const c = Math.cos(delta / 2)
  return I0 * c * c
}

/**
 * MZ sample: I = I0 cos²(δ/2); constructive at δ=0; destructive at δ=π.
 */
export function runMzISample(opts?: {
  delta?: number
  I0?: number
}): {
  delta: number
  I0: number
  I: number
  I_constructive: number
  I_destructive: number
  I_double: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MZ_I
  familyId: typeof METHOD_MZ
} {
  const delta = opts?.delta ?? DEFAULT_DELTA
  const I0 = opts?.I0 ?? DEFAULT_I0

  const I = mzIntensity(delta, I0)
  const I_constructive = mzIntensity(0, I0)
  const I_destructive = mzIntensity(Math.PI, I0)
  const I_double = mzIntensity(delta, 2 * I0)

  const finite =
    Number.isFinite(I) &&
    Number.isFinite(I_constructive) &&
    Number.isFinite(I_destructive) &&
    Number.isFinite(I_double)

  const expected = I0 * Math.cos(delta / 2) ** 2
  const formulaOk =
    Math.abs(I - expected) < 1e-12 * Math.max(1, Math.abs(I))
  const constOk = Math.abs(I_constructive - I0) < 1e-12 * Math.max(1, I0)
  const destOk = Math.abs(I_destructive) < 1e-12
  const linI0Ok =
    Math.abs(I_double - 2 * I) < 1e-12 * Math.max(1, Math.abs(I))

  const ok = finite && formulaOk && constOk && destOk && linI0Ok

  return {
    delta,
    I0,
    I,
    I_constructive,
    I_destructive,
    I_double,
    finite,
    ok,
    methodId: METHOD_ALGO_MZ_I,
    familyId: METHOD_MZ,
  }
}
