/**
 * Impedance matching · pure teaching toy.
 * Reflection coefficient Γ = (ZL − Z0) / (ZL + Z0); power |Γ|²;
 * max power transfer when ZL = Z0* (real lines: ZL = Z0).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · impedance matching / reflection. */
export const METHOD_ZMATCH = 'method-impedance-match'

/** Algo · voltage reflection coefficient Γ and power reflection. */
export const METHOD_ALGO_REFLECTION_GAMMA = 'method-algo-reflection-gamma'

/** Parent alias (aligns with familyId). */
export const ZMATCH_PARENT = METHOD_ZMATCH

export const ZMATCH_METHOD_IDS = [METHOD_ALGO_REFLECTION_GAMMA] as const

/** Complex number as {re, im}. */
export type Complex = { re: number; im: number }

export function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im }
}

export function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im }
}

export function cMul(a: Complex, b: Complex): Complex {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  }
}

export function cAbs2(z: Complex): number {
  return z.re * z.re + z.im * z.im
}

export function cAbs(z: Complex): number {
  return Math.hypot(z.re, z.im)
}

export function cConj(z: Complex): Complex {
  return { re: z.re, im: -z.im }
}

/** a / b for complex; NaN components if |b|² = 0. */
export function cDiv(a: Complex, b: Complex): Complex {
  const d = cAbs2(b)
  if (!(d > 0) || !Number.isFinite(d)) {
    return { re: NaN, im: NaN }
  }
  return {
    re: (a.re * b.re + a.im * b.im) / d,
    im: (a.im * b.re - a.re * b.im) / d,
  }
}

export function cReal(x: number): Complex {
  return { re: x, im: 0 }
}

/**
 * Voltage reflection coefficient (complex):
 *   Γ = (ZL − Z0) / (ZL + Z0)
 *
 * Z0 typically real line impedance; both may be complex.
 * Returns NaN components if ZL + Z0 = 0 (singular).
 */
export function reflectionGamma(ZL: Complex, Z0: Complex): Complex {
  if (
    !Number.isFinite(ZL.re) ||
    !Number.isFinite(ZL.im) ||
    !Number.isFinite(Z0.re) ||
    !Number.isFinite(Z0.im)
  ) {
    return { re: NaN, im: NaN }
  }
  return cDiv(cSub(ZL, Z0), cAdd(ZL, Z0))
}

/** Real-impedance shortcut: Γ = (ZL − Z0) / (ZL + Z0). */
export function reflectionGammaReal(ZL: number, Z0: number): number {
  if (!Number.isFinite(ZL) || !Number.isFinite(Z0)) return NaN
  const den = ZL + Z0
  if (den === 0) return NaN
  return (ZL - Z0) / den
}

/**
 * Power reflection coefficient (fraction of incident power reflected):
 *   |Γ|²
 */
export function powerReflection(gamma: Complex): number {
  if (!Number.isFinite(gamma.re) || !Number.isFinite(gamma.im)) return NaN
  return cAbs2(gamma)
}

/** Power transmission (fraction delivered, lossless interface teaching): 1 − |Γ|². */
export function powerTransmission(gamma: Complex): number {
  const pr = powerReflection(gamma)
  if (!Number.isFinite(pr)) return NaN
  return 1 - pr
}

/**
 * Return loss in dB: RL = −20 log10(|Γ|).
 * Perfect match (|Γ|=0) → +∞; |Γ|≥1 → ≤ 0.
 */
export function returnLossDb(gamma: Complex): number {
  const mag = cAbs(gamma)
  if (!Number.isFinite(mag)) return NaN
  if (mag === 0) return Infinity
  return -20 * Math.log10(mag)
}

/**
 * VSWR = (1+|Γ|) / (1−|Γ|) for |Γ| < 1.
 * |Γ| ≥ 1 → Infinity; |Γ|=0 → 1.
 */
export function vswr(gamma: Complex): number {
  const mag = cAbs(gamma)
  if (!Number.isFinite(mag)) return NaN
  if (mag >= 1) return Infinity
  return (1 + mag) / (1 - mag)
}

/**
 * Max power transfer (real source RS, real load RL):
 * load power P = (Vth² · RL) / (RS + RL)²  for Thevenin Vth.
 * Peak when RL = RS.
 */
export function loadPowerReal(Vth: number, RS: number, RL: number): number {
  if (
    !Number.isFinite(Vth) ||
    !Number.isFinite(RS) ||
    !Number.isFinite(RL) ||
    !(RS >= 0) ||
    !(RL >= 0)
  ) {
    return NaN
  }
  const den = RS + RL
  if (den === 0) return NaN
  return (Vth * Vth * RL) / (den * den)
}

/**
 * Conjugate-match check for complex: max power when ZL = conj(Z0)
 * for a source impedance Z0 (teaching; Z0 is source / line ref as needed).
 * Returns |ZL − Z0*| (0 when matched).
 */
export function conjugateMatchError(ZL: Complex, Zsrc: Complex): number {
  const target = cConj(Zsrc)
  return cAbs(cSub(ZL, target))
}

/**
 * Sample Γ and power metrics for a real ZL sweep around Z0.
 */
export function sampleGammaVsLoad(opts?: {
  Z0?: number
  ZLmin?: number
  ZLmax?: number
  nPoints?: number
}): {
  Z0: number
  ZL: Float64Array
  gamma: Float64Array
  powerRefl: Float64Array
  finite: boolean
  matchedIndex: number
} {
  const Z0 = opts?.Z0 ?? 50
  const ZLmin = opts?.ZLmin ?? 10
  const ZLmax = opts?.ZLmax ?? 200
  const nPoints = Math.max(3, Math.floor(opts?.nPoints ?? 39))

  const ZL = new Float64Array(nPoints)
  const gamma = new Float64Array(nPoints)
  const powerRefl = new Float64Array(nPoints)
  let finite = true
  let matchedIndex = 0
  let bestAbs = Infinity

  for (let i = 0; i < nPoints; i++) {
    const t = i / (nPoints - 1)
    const zl = ZLmin + t * (ZLmax - ZLmin)
    const g = reflectionGammaReal(zl, Z0)
    const pr = g * g
    ZL[i] = zl
    gamma[i] = g
    powerRefl[i] = pr
    if (!Number.isFinite(g) || !Number.isFinite(pr)) finite = false
    const ag = Math.abs(g)
    if (ag < bestAbs) {
      bestAbs = ag
      matchedIndex = i
    }
  }

  return { Z0, ZL, gamma, powerRefl, finite, matchedIndex }
}

/**
 * Reflection-gamma sample: match Γ=0; open/short |Γ|=1;
 * power |Γ|²; max power at RL=RS; conjugate match.
 */
export function runReflectionGammaSample(opts?: {
  Z0?: number
  ZL_mismatch?: number
  RS?: number
  Vth?: number
}): {
  Z0: number
  gammaMatch: Complex
  gammaOpen: Complex
  gammaShort: Complex
  gammaMismatch: Complex
  powerMatch: number
  powerOpen: number
  powerMismatch: number
  transmitMismatch: number
  vswrMatch: number
  P_matched: number
  P_half: number
  P_double: number
  conjErr: number
  sweepFinite: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_REFLECTION_GAMMA
  familyId: typeof METHOD_ZMATCH
} {
  const Z0 = opts?.Z0 ?? 50
  const ZL_mismatch = opts?.ZL_mismatch ?? 100
  const RS = opts?.RS ?? 50
  const Vth = opts?.Vth ?? 2

  const Z0c = cReal(Z0)
  const gammaMatch = reflectionGamma(cReal(Z0), Z0c)
  const gammaOpen = reflectionGamma(cReal(1e12), Z0c) // near-open
  const gammaShort = reflectionGamma(cReal(0), Z0c)
  const gammaMismatch = reflectionGamma(cReal(ZL_mismatch), Z0c)

  const powerMatch = powerReflection(gammaMatch)
  const powerOpen = powerReflection(gammaOpen)
  const powerMismatch = powerReflection(gammaMismatch)
  const transmitMismatch = powerTransmission(gammaMismatch)
  const vswrMatch = vswr(gammaMatch)

  // max power transfer (real): peak at RL = RS
  const P_matched = loadPowerReal(Vth, RS, RS)
  const P_half = loadPowerReal(Vth, RS, RS / 2)
  const P_double = loadPowerReal(Vth, RS, RS * 2)

  // conjugate match: ZL = 30 − j20 for Zsrc = 30 + j20
  const Zsrc: Complex = { re: 30, im: 20 }
  const ZLconj: Complex = { re: 30, im: -20 }
  const conjErr = conjugateMatchError(ZLconj, Zsrc)
  // note: max power for complex Zsrc when ZL = conj(Zsrc); line match is ZL = Z0.

  const sweep = sampleGammaVsLoad({ Z0, ZLmin: 25, ZLmax: 100, nPoints: 31 })

  const finite =
    Number.isFinite(gammaMatch.re) &&
    Number.isFinite(gammaShort.re) &&
    Number.isFinite(gammaMismatch.re) &&
    Number.isFinite(powerMatch) &&
    Number.isFinite(powerMismatch) &&
    Number.isFinite(P_matched) &&
    Number.isFinite(conjErr)

  const matchOk =
    Math.abs(gammaMatch.re) < 1e-14 &&
    Math.abs(gammaMatch.im) < 1e-14 &&
    powerMatch < 1e-28 &&
    Math.abs(vswrMatch - 1) < 1e-12

  const shortOk =
    Math.abs(gammaShort.re - -1) < 1e-14 && Math.abs(gammaShort.im) < 1e-14
  const openOk = Math.abs(cAbs(gammaOpen) - 1) < 1e-8
  const powerOk =
    Math.abs(powerMismatch - cAbs2(gammaMismatch)) < 1e-14 &&
    Math.abs(transmitMismatch - (1 - powerMismatch)) < 1e-14 &&
    powerOpen > 0.999

  const formulaOk = (() => {
    const g = reflectionGammaReal(ZL_mismatch, Z0)
    return Math.abs(g - (ZL_mismatch - Z0) / (ZL_mismatch + Z0)) < 1e-14
  })()

  const maxPowerOk =
    P_matched > P_half &&
    P_matched > P_double &&
    Math.abs(P_half - P_double) < 1e-12 * Math.max(1, P_matched)

  const conjOk = conjErr < 1e-14
  const sweepOk =
    sweep.finite &&
    Math.abs(sweep.ZL[sweep.matchedIndex]! - Z0) <= (100 - 25) / (31 - 1) + 1e-9

  const ok =
    finite &&
    matchOk &&
    shortOk &&
    openOk &&
    powerOk &&
    formulaOk &&
    maxPowerOk &&
    conjOk &&
    sweepOk

  return {
    Z0,
    gammaMatch,
    gammaOpen,
    gammaShort,
    gammaMismatch,
    powerMatch,
    powerOpen,
    powerMismatch,
    transmitMismatch,
    vswrMatch,
    P_matched,
    P_half,
    P_double,
    conjErr,
    sweepFinite: sweep.finite,
    finite,
    ok,
    methodId: METHOD_ALGO_REFLECTION_GAMMA,
    familyId: METHOD_ZMATCH,
  }
}
