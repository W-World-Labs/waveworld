/**
 * Raman scattering · pure teaching stubs.
 * Stokes wavenumber: ν_s = ν_0 − ν_vib (cm⁻¹ domain).
 * Intensity stub: I ∝ n_mol · σ · I_0.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Raman scattering. */
export const METHOD_RAMAN = 'method-raman'

/** Algo · Stokes shift in wavenumber. */
export const METHOD_ALGO_RAMAN_SHIFT = 'method-algo-raman-shift'

/** Parent alias (aligns with familyId). */
export const RAMAN_PARENT = METHOD_RAMAN

export const RAMAN_METHOD_IDS = [METHOD_ALGO_RAMAN_SHIFT] as const

/** Default laser wavenumber ν_0 (cm⁻¹); ~532 nm green ≈ 18797 cm⁻¹. */
export const DEFAULT_NU0 = 18797

/** Default vibrational wavenumber ν_vib (cm⁻¹); C–H stretch-class toy. */
export const DEFAULT_NU_VIB = 2900

/**
 * Stokes Raman scattered wavenumber (cm⁻¹ teaching domain):
 *   ν_s = ν_0 − ν_vib
 *
 * ν_0: incident laser wavenumber, ν_vib: vibrational mode wavenumber.
 * Requires finite inputs; Stokes physical when ν_s > 0 (not enforced → still returns).
 * Non-finite → NaN.
 */
export function ramanStokesNu(nu0: number, nuVib: number): number {
  if (!Number.isFinite(nu0) || !Number.isFinite(nuVib)) return NaN
  return nu0 - nuVib
}

/**
 * Anti-Stokes wavenumber (cm⁻¹ teaching):
 *   ν_as = ν_0 + ν_vib
 */
export function ramanAntiStokesNu(nu0: number, nuVib: number): number {
  if (!Number.isFinite(nu0) || !Number.isFinite(nuVib)) return NaN
  return nu0 + nuVib
}

/**
 * Raman intensity teaching stub:
 *   I ∝ n_mol · σ · I_0
 * Returns proportional intensity (arbitrary units).
 */
export function ramanIntensityStub(
  nMol: number,
  sigma: number,
  I0: number,
): number {
  if (
    !Number.isFinite(nMol) ||
    !Number.isFinite(sigma) ||
    !Number.isFinite(I0)
  ) {
    return NaN
  }
  return nMol * sigma * I0
}

/**
 * Raman Stokes sample: ν_0=18797, ν_vib=2900 → ν_s=15897 cm⁻¹;
 * anti-Stokes higher; intensity linear in n_mol, I_0.
 */
export function runRamanShiftSample(opts?: {
  nu0?: number
  nuVib?: number
  nMol?: number
  sigma?: number
  I0?: number
}): {
  nu0: number
  nuVib: number
  nuS: number
  nuAS: number
  I: number
  I_doubleI0: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RAMAN_SHIFT
  familyId: typeof METHOD_RAMAN
} {
  const nu0 = opts?.nu0 ?? DEFAULT_NU0
  const nuVib = opts?.nuVib ?? DEFAULT_NU_VIB
  const nMol = opts?.nMol ?? 1e24
  const sigma = opts?.sigma ?? 1e-30
  const I0 = opts?.I0 ?? 1e3

  const nuS = ramanStokesNu(nu0, nuVib)
  const nuAS = ramanAntiStokesNu(nu0, nuVib)
  const I = ramanIntensityStub(nMol, sigma, I0)
  const I_doubleI0 = ramanIntensityStub(nMol, sigma, 2 * I0)

  const finite =
    Number.isFinite(nuS) &&
    Number.isFinite(nuAS) &&
    Number.isFinite(I) &&
    Number.isFinite(I_doubleI0)

  const stokesOk = Math.abs(nuS - (nu0 - nuVib)) < 1e-12
  const antiOk = Math.abs(nuAS - (nu0 + nuVib)) < 1e-12
  const gapOk = Math.abs(nuAS - nuS - 2 * nuVib) < 1e-12
  const stokesLower = nuS < nu0 && nuAS > nu0
  const intensityOk =
    Math.abs(I - nMol * sigma * I0) < 1e-18 * Math.max(1, Math.abs(I))
  const linI0 =
    Math.abs(I_doubleI0 - 2 * I) < 1e-18 * Math.max(1, Math.abs(I))

  const ok =
    finite && stokesOk && antiOk && gapOk && stokesLower && intensityOk && linI0

  return {
    nu0,
    nuVib,
    nuS,
    nuAS,
    I,
    I_doubleI0,
    finite,
    ok,
    methodId: METHOD_ALGO_RAMAN_SHIFT,
    familyId: METHOD_RAMAN,
  }
}
