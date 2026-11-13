/**
 * Ziegler–Nichols classic PID tuning · pure teaching stubs.
 * Ku ultimate gain, Pu period → Kp=0.6 Ku, Ti=0.5 Pu, Td=0.125 Pu
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Ziegler–Nichols tuning. */
export const METHOD_ZN = 'method-ziegler-nichols'

/** Algo · classic Z–N PID gains from Ku, Pu. */
export const METHOD_ALGO_ZN_PID = 'method-algo-zn-pid'

/** Parent alias (aligns with familyId). */
export const ZN_PARENT = METHOD_ZN

export const ZN_METHOD_IDS = [METHOD_ALGO_ZN_PID] as const

/** Default ultimate gain Ku. */
export const DEFAULT_KU = 2

/** Default ultimate period Pu (s). */
export const DEFAULT_PU = 1

export type ZnPidGains = {
  Kp: number
  Ti: number
  Td: number
}

/**
 * Classic Ziegler–Nichols PID parameters from ultimate gain/period:
 *   Kp = 0.6 · Ku
 *   Ti = 0.5 · Pu
 *   Td = 0.125 · Pu
 *
 * Requires Ku>0, Pu>0, finite; else all NaN.
 */
export function znPid(Ku: number, Pu: number): ZnPidGains {
  if (
    !Number.isFinite(Ku) ||
    !Number.isFinite(Pu) ||
    !(Ku > 0) ||
    !(Pu > 0)
  ) {
    return { Kp: NaN, Ti: NaN, Td: NaN }
  }
  return {
    Kp: 0.6 * Ku,
    Ti: 0.5 * Pu,
    Td: 0.125 * Pu,
  }
}

/**
 * Z–N sample: classic PID ratios; scales with Ku and Pu.
 */
export function runZnPidSample(opts?: {
  Ku?: number
  Pu?: number
}): {
  Ku: number
  Pu: number
  Kp: number
  Ti: number
  Td: number
  Kp_double: number
  Ti_double: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ZN_PID
  familyId: typeof METHOD_ZN
} {
  const Ku = opts?.Ku ?? DEFAULT_KU
  const Pu = opts?.Pu ?? DEFAULT_PU

  const { Kp, Ti, Td } = znPid(Ku, Pu)
  const double = znPid(2 * Ku, 2 * Pu)
  const Kp_double = double.Kp
  const Ti_double = double.Ti
  const bad = znPid(0, Pu)

  const finite =
    Number.isFinite(Kp) && Number.isFinite(Ti) && Number.isFinite(Td)

  const kpOk = Math.abs(Kp - 0.6 * Ku) < 1e-18 * Math.max(1, Math.abs(Kp))
  const tiOk = Math.abs(Ti - 0.5 * Pu) < 1e-18 * Math.max(1, Math.abs(Ti))
  const tdOk = Math.abs(Td - 0.125 * Pu) < 1e-18 * Math.max(1, Math.abs(Td))
  // Td / Ti = 0.125/0.5 = 0.25
  const ratioOk = Math.abs(Td / Ti - 0.25) < 1e-12
  const scaleOk =
    Math.abs(Kp_double - 2 * Kp) < 1e-12 * Math.max(1, Math.abs(Kp)) &&
    Math.abs(Ti_double - 2 * Ti) < 1e-12 * Math.max(1, Math.abs(Ti))
  const badOk = !Number.isFinite(bad.Kp)

  const ok = finite && kpOk && tiOk && tdOk && ratioOk && scaleOk && badOk

  return {
    Ku,
    Pu,
    Kp,
    Ti,
    Td,
    Kp_double,
    Ti_double,
    finite,
    ok,
    methodId: METHOD_ALGO_ZN_PID,
    familyId: METHOD_ZN,
  }
}
