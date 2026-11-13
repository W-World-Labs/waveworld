/**
 * Fuel cell · pure teaching stubs.
 * Nernst open-circuit E; polarization V = E − I·R − activation stub.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · fuel cell electrochemistry. */
export const METHOD_FUELCELL = 'method-fuel-cell'

/** Algo · Nernst reversible voltage (toy). */
export const METHOD_ALGO_NERNST = 'method-algo-nernst-voltage'

/** Algo · polarization curve stub: ohmic + activation. */
export const METHOD_ALGO_FC_POLARIZATION = 'method-algo-fc-polarization-stub'

/** Parent alias (aligns with familyId). */
export const FUELCELL_PARENT = METHOD_FUELCELL

export const FUELCELL_METHOD_IDS = [
  METHOD_ALGO_NERNST,
  METHOD_ALGO_FC_POLARIZATION,
] as const

/** Gas constant (J/(mol·K)). */
export const R_GAS = 8.314462618

/** Faraday constant (C/mol). */
export const F_FARADAY = 96485.3321

/** Standard H2/O2 PEM reversible voltage at 25 °C (V), toy E0. */
export const E0_H2_O2 = 1.229

/**
 * Toy Nernst voltage for H2 + ½O2 → H2O (gas partial pressures in atm):
 *   E = E0 − (R T)/(n F) · ln( pH2O / (pH2 · pO2^{1/2}) )
 *
 * n = 2 electrons per H2. Pressures must be >0; T>0.
 * Equivalent: E = E0 + (RT/nF) · ln(pH2 · √pO2 / pH2O).
 */
export function nernstVoltage(
  E0: number,
  T: number,
  pH2: number,
  pO2: number,
  pH2O: number,
  n = 2,
): number {
  if (
    !Number.isFinite(E0) ||
    !Number.isFinite(T) ||
    !Number.isFinite(pH2) ||
    !Number.isFinite(pO2) ||
    !Number.isFinite(pH2O) ||
    !Number.isFinite(n) ||
    !(T > 0) ||
    !(pH2 > 0) ||
    !(pO2 > 0) ||
    !(pH2O > 0) ||
    !(n > 0)
  ) {
    return NaN
  }
  const Q = pH2O / (pH2 * Math.sqrt(pO2))
  return E0 - ((R_GAS * T) / (n * F_FARADAY)) * Math.log(Q)
}

/**
 * Standard-state Nernst at unit activities (pH2=pO2=pH2O=1): E = E0.
 */
export function nernstStandard(E0: number = E0_H2_O2): number {
  return nernstVoltage(E0, 298.15, 1, 1, 1, 2)
}

/**
 * Activation overpotential stub (Tafel-like, always ≥0 for I≥0):
 *   η_act = b · ln(1 + I / I0)
 *
 * b: Tafel slope (V), I0: exchange current (A), I: load current (A).
 * Negative I uses |I| for the stub (symmetric teaching).
 */
export function activationOverpotential(
  I: number,
  b: number,
  I0: number,
): number {
  if (!Number.isFinite(I) || !Number.isFinite(b) || !Number.isFinite(I0)) {
    return NaN
  }
  if (!(I0 > 0) || !(b >= 0)) return NaN
  const iAbs = Math.abs(I)
  return b * Math.log(1 + iAbs / I0)
}

/**
 * Polarization voltage stub:
 *   V = E − I · R − η_act(I)
 *
 * E: Nernst / OCV (V), I: current (A, discharge ≥0),
 * R: ohmic resistance (Ω), b/I0: activation params.
 * Clamps terminal V at 0 (no negative teaching voltage).
 */
export function polarizationVoltage(
  E: number,
  I: number,
  R: number,
  b: number,
  I0: number,
): number {
  if (
    !Number.isFinite(E) ||
    !Number.isFinite(I) ||
    !Number.isFinite(R) ||
    !(R >= 0)
  ) {
    return NaN
  }
  const eta = activationOverpotential(I, b, I0)
  if (!Number.isFinite(eta)) return NaN
  const V = E - I * R - eta
  if (!Number.isFinite(V)) return NaN
  return V > 0 ? V : 0
}

/**
 * Polarization curve: V(I) on a uniform current grid.
 */
export function polarizationSweep(
  E: number,
  R: number,
  b: number,
  I0: number,
  IMax: number,
  n = 21,
): { I: Float64Array; V: Float64Array } {
  const nPts = Math.max(2, Math.floor(n))
  const I = new Float64Array(nPts)
  const V = new Float64Array(nPts)
  for (let i = 0; i < nPts; i++) {
    const Ii = (i / (nPts - 1)) * IMax
    I[i] = Ii
    V[i] = polarizationVoltage(E, Ii, R, b, I0)
  }
  return { I, V }
}

/**
 * Nernst sample: unit activities → E0; rich H2/O2 raises E; lean drops E.
 */
export function runNernstSample(opts?: {
  E0?: number
  T?: number
  pH2?: number
  pO2?: number
  pH2O?: number
}): {
  E0: number
  T: number
  E_std: number
  E_rich: number
  E_lean: number
  E_custom: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_NERNST
  familyId: typeof METHOD_FUELCELL
} {
  const E0 = opts?.E0 ?? E0_H2_O2
  const T = opts?.T ?? 353.15 // ~80 °C PEM

  const E_std = nernstVoltage(E0, T, 1, 1, 1, 2)
  const E_rich = nernstVoltage(E0, T, 2, 1, 0.5, 2)
  const E_lean = nernstVoltage(E0, T, 0.5, 0.21, 1, 2)
  const E_custom = nernstVoltage(
    E0,
    T,
    opts?.pH2 ?? 1,
    opts?.pO2 ?? 0.21,
    opts?.pH2O ?? 1,
    2,
  )

  const finite =
    Number.isFinite(E_std) &&
    Number.isFinite(E_rich) &&
    Number.isFinite(E_lean) &&
    Number.isFinite(E_custom)

  const stdOk = Math.abs(E_std - E0) < 1e-12
  const richLift = E_rich > E_std
  const leanDrop = E_lean < E_std
  const positive = E_std > 0 && E_custom > 0
  const badOk = !Number.isFinite(nernstVoltage(E0, T, 0, 1, 1, 2))

  const ok = finite && stdOk && richLift && leanDrop && positive && badOk

  return {
    E0,
    T,
    E_std,
    E_rich,
    E_lean,
    E_custom,
    finite,
    ok,
    methodId: METHOD_ALGO_NERNST,
    familyId: METHOD_FUELCELL,
  }
}

/**
 * Polarization sample: V = E − IR − η_act; drops with I; OCV at I=0.
 */
export function runFcPolarizationSample(opts?: {
  E?: number
  R?: number
  b?: number
  I0?: number
  I?: number
}): {
  E: number
  R: number
  b: number
  I0: number
  I: number
  V0: number
  V: number
  eta_act: number
  irDrop: number
  V_highI: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FC_POLARIZATION
  familyId: typeof METHOD_FUELCELL
} {
  const E = opts?.E ?? 1.0
  const R = opts?.R ?? 0.05
  const b = opts?.b ?? 0.05
  const I0 = opts?.I0 ?? 0.01
  const I = opts?.I ?? 1

  const V0 = polarizationVoltage(E, 0, R, b, I0)
  const eta_act = activationOverpotential(I, b, I0)
  const irDrop = I * R
  const V = polarizationVoltage(E, I, R, b, I0)
  const V_highI = polarizationVoltage(E, 5 * I, R, b, I0)

  const finite =
    Number.isFinite(V0) &&
    Number.isFinite(V) &&
    Number.isFinite(eta_act) &&
    Number.isFinite(V_highI)

  const ocvOk = Math.abs(V0 - E) < 1e-12
  const formulaOk = Math.abs(V - Math.max(0, E - irDrop - eta_act)) < 1e-12
  const dropOk = V < V0 && V_highI < V
  const etaPos = eta_act > 0 && irDrop > 0
  const ohmicPart = Math.abs(activationOverpotential(0, b, I0)) < 1e-15

  const ok = finite && ocvOk && formulaOk && dropOk && etaPos && ohmicPart

  return {
    E,
    R,
    b,
    I0,
    I,
    V0,
    V,
    eta_act,
    irDrop,
    V_highI,
    finite,
    ok,
    methodId: METHOD_ALGO_FC_POLARIZATION,
    familyId: METHOD_FUELCELL,
  }
}
