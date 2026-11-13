/**
 * Battery ECM teaching stubs · OCV(SOC) + Rint discharge.
 * Linear / piecewise-linear OCV vs SOC; terminal V = OCV − I·R.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · battery equivalent-circuit model (ECM). */
export const METHOD_BATTERY = 'method-battery-ecm'

/** Algo · open-circuit voltage vs state of charge (linear / toy). */
export const METHOD_ALGO_BATTERY_OCV = 'method-algo-battery-ocv'

/** Algo · Rint discharge: V_term = OCV(SOC) − I · R. */
export const METHOD_ALGO_BATTERY_RINT = 'method-algo-battery-rint'

/** Parent alias (aligns with familyId). */
export const BATTERY_PARENT = METHOD_BATTERY

export const BATTERY_METHOD_IDS = [
  METHOD_ALGO_BATTERY_OCV,
  METHOD_ALGO_BATTERY_RINT,
] as const

/** Linear OCV(SOC) parameters: OCV = Vmin + (Vmax−Vmin)·SOC, SOC∈[0,1]. */
export type LinearOcvParams = {
  Vmin: number
  Vmax: number
}

/** Default Li-ion-ish toy window ~3.0–4.2 V. */
export const DEFAULT_LINEAR_OCV: Readonly<LinearOcvParams> = {
  Vmin: 3.0,
  Vmax: 4.2,
}

/** Clamp SOC to [0, 1]. */
export function clampSoc(soc: number): number {
  if (!Number.isFinite(soc)) return 0
  if (soc < 0) return 0
  if (soc > 1) return 1
  return soc
}

/**
 * Linear open-circuit voltage:
 *   OCV(s) = Vmin + (Vmax − Vmin) · clamp(s)
 */
export function ocvLinear(
  soc: number,
  p: LinearOcvParams = DEFAULT_LINEAR_OCV,
): number {
  const s = clampSoc(soc)
  return p.Vmin + (p.Vmax - p.Vmin) * s
}

/**
 * Piecewise-linear OCV through knots (soc ascending in [0,1]).
 * Linear interpolate between knots; clamp outside.
 */
export function ocvPiecewise(
  soc: number,
  knots: ReadonlyArray<{ soc: number; V: number }>,
): number {
  if (knots.length === 0) return 0
  const s = clampSoc(soc)
  if (s <= knots[0]!.soc) return knots[0]!.V
  const last = knots[knots.length - 1]!
  if (s >= last.soc) return last.V
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i]!
    const b = knots[i + 1]!
    if (s >= a.soc && s <= b.soc) {
      const den = b.soc - a.soc
      if (!(den > 0)) return b.V
      const t = (s - a.soc) / den
      return a.V + t * (b.V - a.V)
    }
  }
  return last.V
}

/** Default mild-nonlinear Li-ion-ish knots (toy). */
export const DEFAULT_OCV_KNOTS: ReadonlyArray<{ soc: number; V: number }> = [
  { soc: 0, V: 3.0 },
  { soc: 0.1, V: 3.4 },
  { soc: 0.5, V: 3.7 },
  { soc: 0.9, V: 4.05 },
  { soc: 1, V: 4.2 },
]

/**
 * Rint terminal voltage under discharge current I ≥ 0 (A):
 *   V = OCV − I · R
 * (charge uses negative I by convention here: V = OCV − I·R still).
 */
export function rintVoltage(ocv: number, I: number, R: number): number {
  if (!Number.isFinite(ocv) || !Number.isFinite(I) || !Number.isFinite(R)) {
    return NaN
  }
  if (R < 0) throw new Error('rintVoltage: R must be ≥ 0')
  return ocv - I * R
}

/**
 * Coulomb-count SOC update (explicit Euler):
 *   SOC ← clamp(SOC − I·dt / Q)
 * Q = capacity (A·s = C). Discharge I>0 lowers SOC.
 */
export function socStep(
  soc: number,
  I: number,
  dt: number,
  Q_As: number,
): number {
  if (!(Q_As > 0) || !Number.isFinite(Q_As)) {
    throw new Error('socStep: Q_As must be finite and > 0')
  }
  if (!(dt >= 0) || !Number.isFinite(dt)) {
    throw new Error('socStep: dt must be finite and ≥ 0')
  }
  return clampSoc(soc - (I * dt) / Q_As)
}

/**
 * Rint discharge trajectory: constant current, linear OCV, update SOC.
 * Returns time series of SOC, OCV, V_term.
 */
export function simulateRintDischarge(
  opts: {
    soc0?: number
    I?: number
    R?: number
    Q_As?: number
    dt?: number
    nSteps?: number
    ocv?: LinearOcvParams
  } = {},
): {
  t: Float64Array
  soc: Float64Array
  ocv: Float64Array
  V: Float64Array
  socFinal: number
  VFinal: number
  ocvFinal: number
  finite: boolean
} {
  const soc0 = opts.soc0 ?? 1
  const I = opts.I ?? 2
  const R = opts.R ?? 0.05
  const Q_As = opts.Q_As ?? 3600 // 1 Ah
  const dt = opts.dt ?? 60
  const nSteps = opts.nSteps ?? 30
  const ocvP = opts.ocv ?? DEFAULT_LINEAR_OCV

  const t = new Float64Array(nSteps + 1)
  const socArr = new Float64Array(nSteps + 1)
  const ocvArr = new Float64Array(nSteps + 1)
  const VArr = new Float64Array(nSteps + 1)

  let s = clampSoc(soc0)
  socArr[0] = s
  ocvArr[0] = ocvLinear(s, ocvP)
  VArr[0] = rintVoltage(ocvArr[0]!, I, R)
  t[0] = 0
  let finite =
    Number.isFinite(s) &&
    Number.isFinite(ocvArr[0]!) &&
    Number.isFinite(VArr[0]!)

  for (let i = 0; i < nSteps; i++) {
    s = socStep(s, I, dt, Q_As)
    const o = ocvLinear(s, ocvP)
    const v = rintVoltage(o, I, R)
    socArr[i + 1] = s
    ocvArr[i + 1] = o
    VArr[i + 1] = v
    t[i + 1] = (i + 1) * dt
    if (!Number.isFinite(s) || !Number.isFinite(o) || !Number.isFinite(v)) {
      finite = false
    }
  }

  return {
    t,
    soc: socArr,
    ocv: ocvArr,
    V: VArr,
    socFinal: socArr[nSteps]!,
    VFinal: VArr[nSteps]!,
    ocvFinal: ocvArr[nSteps]!,
    finite,
  }
}

/**
 * OCV sample: linear slope, endpoints, piecewise vs linear at mid SOC.
 */
export function runBatteryOcvSample(
  p: LinearOcvParams = DEFAULT_LINEAR_OCV,
): {
  V0: number
  V1: number
  Vmid: number
  slope: number
  /** OCV(0)=Vmin, OCV(1)=Vmax */
  endpoints: boolean
  /** strictly increasing in SOC for Vmax>Vmin */
  monotone: boolean
  /** piecewise mid near linear mid */
  piecewiseClose: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BATTERY_OCV
  familyId: typeof METHOD_BATTERY
} {
  const V0 = ocvLinear(0, p)
  const V1 = ocvLinear(1, p)
  const Vmid = ocvLinear(0.5, p)
  const slope = p.Vmax - p.Vmin
  const endpoints = V0 === p.Vmin && V1 === p.Vmax
  const monotone = V1 > V0 && Vmid > V0 && Vmid < V1
  const Vp = ocvPiecewise(0.5, DEFAULT_OCV_KNOTS)
  const piecewiseClose = Math.abs(Vp - Vmid) < 0.3
  const finite =
    Number.isFinite(V0) && Number.isFinite(V1) && Number.isFinite(Vmid)
  const ok = finite && endpoints && monotone && piecewiseClose

  return {
    V0,
    V1,
    Vmid,
    slope,
    endpoints,
    monotone,
    piecewiseClose,
    finite,
    ok,
    methodId: METHOD_ALGO_BATTERY_OCV,
    familyId: METHOD_BATTERY,
  }
}

/**
 * Rint discharge sample: V = OCV − I R; SOC drops under discharge;
 * IR drop positive for I,R > 0.
 */
export function runBatteryRintSample(
  opts: {
    soc0?: number
    I?: number
    R?: number
    Q_As?: number
    dt?: number
    nSteps?: number
  } = {},
): {
  I: number
  R: number
  irDrop: number
  V0: number
  ocv0: number
  soc0: number
  socFinal: number
  VFinal: number
  /** V = OCV − I R at t=0 */
  ohmicOk: boolean
  /** discharge lowers SOC */
  socDrops: boolean
  /** V stays below OCV under load */
  VBelowOcv: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BATTERY_RINT
  familyId: typeof METHOD_BATTERY
} {
  const I = opts.I ?? 2
  const R = opts.R ?? 0.05
  const soc0 = opts.soc0 ?? 1
  const sim = simulateRintDischarge({
    soc0,
    I,
    R,
    Q_As: opts.Q_As ?? 3600,
    dt: opts.dt ?? 60,
    nSteps: opts.nSteps ?? 30,
  })
  const ocv0 = sim.ocv[0]!
  const V0 = sim.V[0]!
  const irDrop = I * R
  const ohmicOk = Math.abs(V0 - (ocv0 - irDrop)) < 1e-12
  const socDrops = sim.socFinal < soc0 - 1e-9
  let VBelowOcv = true
  for (let i = 0; i < sim.V.length; i++) {
    if (sim.V[i]! > sim.ocv[i]! + 1e-12) VBelowOcv = false
  }
  const finite = sim.finite
  const ok = finite && ohmicOk && socDrops && VBelowOcv && irDrop > 0

  return {
    I,
    R,
    irDrop,
    V0,
    ocv0,
    soc0,
    socFinal: sim.socFinal,
    VFinal: sim.VFinal,
    ohmicOk,
    socDrops,
    VBelowOcv,
    finite,
    ok,
    methodId: METHOD_ALGO_BATTERY_RINT,
    familyId: METHOD_BATTERY,
  }
}
