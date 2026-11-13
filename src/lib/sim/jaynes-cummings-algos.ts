/**
 * Jaynes–Cummings vacuum Rabi splitting · pure teaching stubs.
 * Vacuum Rabi splitting Ω = 2g  (peak-to-peak separation).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Jaynes–Cummings. */
export const METHOD_JC = 'method-jaynes-cummings'

/** Algo · vacuum Rabi splitting 2g. */
export const METHOD_ALGO_JC_SPLIT = 'method-algo-jc-vacuum-rabi'

/** Parent alias (aligns with familyId). */
export const JC_PARENT = METHOD_JC

export const JC_METHOD_IDS = [METHOD_ALGO_JC_SPLIT] as const

/** Default atom–cavity coupling g (rad/s). */
export const DEFAULT_G = 1e7

/**
 * Vacuum Rabi splitting (angular frequency, rad/s):
 *   Ω = 2g
 *
 * Peak-to-peak separation of the polariton doublet at resonance.
 * g: vacuum Rabi frequency / coupling (rad/s). Non-finite → NaN.
 */
export function vacuumRabiSplit(g: number): number {
  if (!Number.isFinite(g)) return NaN
  return 2 * g
}

/**
 * JC vacuum-Rabi sample: Ω=2g; linear in g; g=0 ⇒ 0.
 */
export function runJcVacuumRabiSample(opts?: { g?: number }): {
  g: number
  Omega: number
  Omega_doubleG: number
  Omega_zero: number
  Omega_neg: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_JC_SPLIT
  familyId: typeof METHOD_JC
} {
  const g = opts?.g ?? DEFAULT_G

  const Omega = vacuumRabiSplit(g)
  const Omega_doubleG = vacuumRabiSplit(2 * g)
  const Omega_zero = vacuumRabiSplit(0)
  const Omega_neg = vacuumRabiSplit(-g)

  const finite =
    Number.isFinite(Omega) &&
    Number.isFinite(Omega_doubleG) &&
    Number.isFinite(Omega_zero) &&
    Number.isFinite(Omega_neg)

  const formulaOk = Math.abs(Omega - 2 * g) < 1e-12 * Math.max(1, Math.abs(Omega))
  const linOk =
    Math.abs(Omega_doubleG - 2 * Omega) <
    1e-12 * Math.max(1, Math.abs(Omega))
  const zeroOk = Math.abs(Omega_zero) < 1e-30
  // splitting is signed with g in teaching form
  const negOk = Math.abs(Omega_neg + Omega) < 1e-12 * Math.max(1, Math.abs(Omega))
  const badOk = !Number.isFinite(vacuumRabiSplit(NaN))

  const ok = finite && formulaOk && linOk && zeroOk && negOk && badOk

  return {
    g,
    Omega,
    Omega_doubleG,
    Omega_zero,
    Omega_neg,
    finite,
    ok,
    methodId: METHOD_ALGO_JC_SPLIT,
    familyId: METHOD_JC,
  }
}
