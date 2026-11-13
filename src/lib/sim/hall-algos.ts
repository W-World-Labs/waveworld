/**
 * Hall effect · pure teaching stub.
 * Thin-strip Hall voltage V_H = I B / (n e t).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Hall effect. */
export const METHOD_HALL = 'method-hall-effect'

/** Algo · Hall voltage V_H = I B / (n e t). */
export const METHOD_ALGO_HALL_V = 'method-algo-hall-voltage'

/** Parent alias (aligns with familyId). */
export const HALL_PARENT = METHOD_HALL

export const HALL_METHOD_IDS = [METHOD_ALGO_HALL_V] as const

/** Elementary charge e (C). */
export const DEFAULT_E = 1.602e-19

/** Copper-ish free-electron density (m⁻³). */
export const DEFAULT_N_CU = 8.5e28

/**
 * Classic thin-strip Hall voltage:
 *   V_H = I · B / (n · e · t)
 *
 * I: current (A), B: magnetic field (T), n: carrier density (m⁻³),
 * e: elementary charge (C), t: strip thickness (m).
 * Requires n, e, t all nonzero finite; else NaN.
 */
export function hallVoltage(
  I: number,
  B: number,
  n: number,
  e: number,
  t: number,
): number {
  if (
    !Number.isFinite(I) ||
    !Number.isFinite(B) ||
    !Number.isFinite(n) ||
    !Number.isFinite(e) ||
    !Number.isFinite(t) ||
    n === 0 ||
    e === 0 ||
    t === 0
  ) {
    return NaN
  }
  return (I * B) / (n * e * t)
}

/**
 * Hall voltage sample: copper-ish n~8.5e28; linear in I,B; 1/t,1/n.
 */
export function runHallVoltageSample(opts?: {
  I?: number
  B?: number
  n?: number
  e?: number
  t?: number
}): {
  I: number
  B: number
  n: number
  e: number
  t: number
  VH: number
  VH_doubleI: number
  VH_doubleB: number
  VH_halfT: number
  VH_zeroI: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_HALL_V
  familyId: typeof METHOD_HALL
} {
  const I = opts?.I ?? 10 // A
  const B = opts?.B ?? 1 // T
  const n = opts?.n ?? DEFAULT_N_CU
  const e = opts?.e ?? DEFAULT_E
  const t = opts?.t ?? 1e-3 // 1 mm strip

  const VH = hallVoltage(I, B, n, e, t)
  const VH_doubleI = hallVoltage(2 * I, B, n, e, t)
  const VH_doubleB = hallVoltage(I, 2 * B, n, e, t)
  const VH_halfT = hallVoltage(I, B, n, e, t / 2)
  const VH_zeroI = hallVoltage(0, B, n, e, t)

  const finite =
    Number.isFinite(VH) &&
    Number.isFinite(VH_doubleI) &&
    Number.isFinite(VH_doubleB) &&
    Number.isFinite(VH_halfT) &&
    Number.isFinite(VH_zeroI)

  const formulaOk =
    Math.abs(VH - (I * B) / (n * e * t)) < 1e-12 * Math.max(1e-20, Math.abs(VH))
  const linI = Math.abs(VH_doubleI - 2 * VH) < 1e-12 * Math.max(1e-20, Math.abs(VH))
  const linB = Math.abs(VH_doubleB - 2 * VH) < 1e-12 * Math.max(1e-20, Math.abs(VH))
  const invT = Math.abs(VH_halfT - 2 * VH) < 1e-12 * Math.max(1e-20, Math.abs(VH))
  const zeroOk = Math.abs(VH_zeroI) < 1e-30
  const positive = VH > 0

  const ok = finite && formulaOk && linI && linB && invT && zeroOk && positive

  return {
    I,
    B,
    n,
    e,
    t,
    VH,
    VH_doubleI,
    VH_doubleB,
    VH_halfT,
    VH_zeroI,
    finite,
    ok,
    methodId: METHOD_ALGO_HALL_V,
    familyId: METHOD_HALL,
  }
}
