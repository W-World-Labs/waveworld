/**
 * Kinetic Monte Carlo (KMC) pure teaching stubs.
 * n-fold way event selection + exponential clock time advance.
 * Toy 2-state adsorption / desorption site.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · kinetic Monte Carlo. */
export const METHOD_KMC = 'method-kmc'

/** Algo · event rates, total rate, n-fold cumulative selection. */
export const METHOD_ALGO_KMC_RATES = 'method-algo-kmc-rates'

/** Algo · one KMC step (pick event + Δt clock) on 2-state site. */
export const METHOD_ALGO_KMC_STEP = 'method-algo-kmc-step'

/** Parent alias (aligns with familyId). */
export const KMC_PARENT = METHOD_KMC

export const KMC_METHOD_IDS = [
  METHOD_ALGO_KMC_RATES,
  METHOD_ALGO_KMC_STEP,
] as const

/** Deterministic RNG (mulberry32); same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Clamp uniform draw into (0,1] so −ln(u) stays finite and positive.
 * Mulberry32 already yields [0,1); map 0 → tiny epsilon.
 */
export function unitOpen01(u: number): number {
  if (!(u > 0) || !Number.isFinite(u)) return 1e-16
  if (u >= 1) return 1 - 1e-16
  return u
}

/**
 * R_tot = Σ r_i. Requires every r_i ≥ 0 and R_tot > 0 for a valid KMC step.
 */
export function totalRate(rates: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < rates.length; i++) {
    const r = rates[i]!
    if (!(r >= 0) || !Number.isFinite(r)) {
      throw new Error('totalRate: each r_i must be finite and ≥ 0')
    }
    s += r
  }
  return s
}

/**
 * Prefix sums C_k = Σ_{i≤k} r_i (length n). C_{n-1} = R_tot.
 */
export function cumulativeRates(rates: ArrayLike<number>): Float64Array {
  const n = rates.length
  const c = new Float64Array(n)
  let s = 0
  for (let i = 0; i < n; i++) {
    const r = rates[i]!
    if (!(r >= 0) || !Number.isFinite(r)) {
      throw new Error('cumulativeRates: each r_i must be finite and ≥ 0')
    }
    s += r
    c[i] = s
  }
  return c
}

/**
 * n-fold way: draw u ∈ [0,1), pick smallest j with C_j ≥ u · R_tot.
 * Equivalent to sampling P(i) ∝ r_i among positive rates.
 * Returns event index in [0, n).
 */
export function pickEventNFold(
  rates: ArrayLike<number>,
  u: number,
): number {
  const n = rates.length
  if (!(n > 0)) throw new Error('pickEventNFold: need at least one rate')
  const R = totalRate(rates)
  if (!(R > 0)) throw new Error('pickEventNFold: R_tot must be > 0')
  const thr = unitOpen01(u) * R
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += rates[i]!
    if (acc >= thr) return i
  }
  // floating-point edge: fall back to last positive rate
  for (let i = n - 1; i >= 0; i--) {
    if (rates[i]! > 0) return i
  }
  return n - 1
}

/**
 * Exponential clock: Δt = −ln(u) / R_tot with u ∈ (0,1].
 * Mean waiting time is 1/R_tot.
 */
export function kmcTimeAdvance(Rtot: number, u: number): number {
  if (!(Rtot > 0) || !Number.isFinite(Rtot)) {
    throw new Error('kmcTimeAdvance: R_tot must be finite and > 0')
  }
  const uu = unitOpen01(u)
  return -Math.log(uu) / Rtot
}

/** Site occupancy: 0 = empty, 1 = occupied. */
export type Occupancy = 0 | 1

/**
 * 2-state Langmuir site rates.
 * empty  → only adsorption  r = [k_abs, 0]
 * occupied → only desorption r = [0, k_des]
 * Indices: 0 = adsorb, 1 = desorb.
 */
export function adsDesRates(
  occ: Occupancy,
  kAbs: number,
  kDes: number,
): Float64Array {
  if (!(kAbs >= 0) || !(kDes >= 0) || !Number.isFinite(kAbs) || !Number.isFinite(kDes)) {
    throw new Error('adsDesRates: k_abs, k_des must be finite and ≥ 0')
  }
  if (occ === 0) {
    if (!(kAbs > 0)) throw new Error('adsDesRates: empty site needs k_abs > 0')
    return new Float64Array([kAbs, 0])
  }
  if (!(kDes > 0)) throw new Error('adsDesRates: occupied site needs k_des > 0')
  return new Float64Array([0, kDes])
}

export type KmcStepResult = {
  eventIndex: number
  dt: number
  Rtot: number
  occBefore: Occupancy
  occAfter: Occupancy
}

/**
 * One KMC step on a single adsorption site:
 * build rates from occupancy, pick event (n-fold), advance time (exp clock), flip.
 */
export function kmcStepAdsDes(
  occ: Occupancy,
  kAbs: number,
  kDes: number,
  rand: () => number,
): KmcStepResult {
  const rates = adsDesRates(occ, kAbs, kDes)
  const Rtot = totalRate(rates)
  const eventIndex = pickEventNFold(rates, rand())
  const dt = kmcTimeAdvance(Rtot, rand())
  // adsorb (0) → occupied; desorb (1) → empty
  const occAfter: Occupancy = eventIndex === 0 ? 1 : 0
  return {
    eventIndex,
    dt,
    Rtot,
    occBefore: occ,
    occAfter,
  }
}

export type AdsDesTrajectory = {
  steps: number
  time: number
  /** Time-averaged occupancy ≈ k_abs / (k_abs + k_des) at stationarity. */
  meanOcc: number
  /** Observed mean event rate (events / unit time). */
  meanEventRate: number
  /** Analytic stationary occupancy. */
  analyticOcc: number
  /** Analytic mean event rate = 2 k_abs k_des / (k_abs + k_des). */
  analyticEventRate: number
  finalOcc: Occupancy
}

/**
 * Run many KMC steps on one site; accumulate time-weighted occupancy.
 */
export function runAdsDesTrajectory(
  steps: number,
  kAbs: number,
  kDes: number,
  seed = 1,
  occ0: Occupancy = 0,
): AdsDesTrajectory {
  if (!(steps > 0) || !Number.isFinite(steps)) {
    throw new Error('runAdsDesTrajectory: steps must be positive finite')
  }
  const n = Math.floor(steps)
  const rand = mulberry32(seed)
  let occ: Occupancy = occ0
  let t = 0
  let occIntegral = 0
  for (let i = 0; i < n; i++) {
    const s = kmcStepAdsDes(occ, kAbs, kDes, rand)
    occIntegral += occ * s.dt
    t += s.dt
    occ = s.occAfter
  }
  const meanOcc = t > 0 ? occIntegral / t : 0
  const meanEventRate = t > 0 ? n / t : 0
  const den = kAbs + kDes
  const analyticOcc = den > 0 ? kAbs / den : 0
  // At stationarity: rate empty→occ = (1−θ) k_abs = θ k_des (flux balance);
  // total event rate (both directions) = 2 θ k_des = 2 k_abs k_des / (k_abs+k_des).
  const analyticEventRate = den > 0 ? (2 * kAbs * kDes) / den : 0
  return {
    steps: n,
    time: t,
    meanOcc,
    meanEventRate,
    analyticOcc,
    analyticEventRate,
    finalOcc: occ,
  }
}

/**
 * Empirical event frequencies under fixed positive rates (no state change).
 * Counts how often n-fold picks each channel over n draws.
 */
export function sampleEventFrequencies(
  rates: ArrayLike<number>,
  nDraws: number,
  seed = 1,
): { counts: Int32Array; freqs: Float64Array; Rtot: number } {
  if (!(nDraws > 0) || !Number.isFinite(nDraws)) {
    throw new Error('sampleEventFrequencies: nDraws must be positive finite')
  }
  const n = Math.floor(nDraws)
  const m = rates.length
  const counts = new Int32Array(m)
  const Rtot = totalRate(rates)
  if (!(Rtot > 0)) throw new Error('sampleEventFrequencies: R_tot must be > 0')
  const rand = mulberry32(seed)
  for (let i = 0; i < n; i++) {
    const j = pickEventNFold(rates, rand())
    counts[j]!++
  }
  const freqs = new Float64Array(m)
  const inv = 1 / n
  for (let i = 0; i < m; i++) freqs[i] = counts[i]! * inv
  return { counts, freqs, Rtot }
}

/**
 * Representative sample: n-fold rates + total rate + frequency match.
 * ok when freqs ≈ r_i / R_tot and cumulative / clock helpers are finite.
 */
export function runKmcRatesSample(
  opts: {
    rates?: number[]
    nDraws?: number
    seed?: number
  } = {},
): {
  rates: number[]
  Rtot: number
  cum: Float64Array
  freqs: Float64Array
  expected: Float64Array
  maxFreqErr: number
  meanDt: number
  analyticMeanDt: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_KMC_RATES
  familyId: typeof METHOD_KMC
} {
  const rates = opts.rates ?? [1.0, 2.0, 0.5, 0.5]
  const nDraws = opts.nDraws ?? 20_000
  const seed = opts.seed ?? 42

  const Rtot = totalRate(rates)
  const cum = cumulativeRates(rates)
  const { freqs } = sampleEventFrequencies(rates, nDraws, seed)

  const expected = new Float64Array(rates.length)
  for (let i = 0; i < rates.length; i++) expected[i] = rates[i]! / Rtot

  let maxFreqErr = 0
  for (let i = 0; i < rates.length; i++) {
    const e = Math.abs(freqs[i]! - expected[i]!)
    if (e > maxFreqErr) maxFreqErr = e
  }

  // mean exponential waiting time from many draws
  const rand = mulberry32(seed + 99)
  let sumDt = 0
  const nDt = 8000
  for (let i = 0; i < nDt; i++) {
    sumDt += kmcTimeAdvance(Rtot, rand())
  }
  const meanDt = sumDt / nDt
  const analyticMeanDt = 1 / Rtot

  const finite =
    Number.isFinite(Rtot) &&
    Number.isFinite(meanDt) &&
    Number.isFinite(cum[cum.length - 1]!) &&
    Rtot > 0

  const ok =
    finite &&
    maxFreqErr < 0.02 &&
    Math.abs(meanDt - analyticMeanDt) < 0.05 * analyticMeanDt &&
    Math.abs(cum[cum.length - 1]! - Rtot) < 1e-12

  return {
    rates: rates.slice(),
    Rtot,
    cum,
    freqs,
    expected,
    maxFreqErr,
    meanDt,
    analyticMeanDt,
    finite,
    ok,
    methodId: METHOD_ALGO_KMC_RATES,
    familyId: METHOD_KMC,
  }
}

/**
 * Representative sample: 2-state ads/des KMC trajectory.
 * mean occupancy and mean event rate vs analytic stationary values.
 */
export function runKmcStepSample(
  opts: {
    steps?: number
    kAbs?: number
    kDes?: number
    seed?: number
  } = {},
): {
  steps: number
  time: number
  meanOcc: number
  analyticOcc: number
  occErr: number
  meanEventRate: number
  analyticEventRate: number
  rateErr: number
  single: KmcStepResult
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_KMC_STEP
  familyId: typeof METHOD_KMC
} {
  const steps = opts.steps ?? 50_000
  const kAbs = opts.kAbs ?? 1.5
  const kDes = opts.kDes ?? 0.5
  const seed = opts.seed ?? 7

  const traj = runAdsDesTrajectory(steps, kAbs, kDes, seed, 0)
  const occErr = Math.abs(traj.meanOcc - traj.analyticOcc)
  const rateErr = Math.abs(traj.meanEventRate - traj.analyticEventRate)

  // one isolated step for structure checks
  const single = kmcStepAdsDes(0, kAbs, kDes, mulberry32(seed + 1))

  const finite =
    Number.isFinite(traj.time) &&
    Number.isFinite(traj.meanOcc) &&
    Number.isFinite(traj.meanEventRate) &&
    Number.isFinite(single.dt) &&
    traj.time > 0 &&
    single.dt > 0

  const ok =
    finite &&
    occErr < 0.03 &&
    rateErr < 0.08 * Math.max(traj.analyticEventRate, 1e-12) &&
    single.occBefore === 0 &&
    single.occAfter === 1 &&
    single.eventIndex === 0

  return {
    steps: traj.steps,
    time: traj.time,
    meanOcc: traj.meanOcc,
    analyticOcc: traj.analyticOcc,
    occErr,
    meanEventRate: traj.meanEventRate,
    analyticEventRate: traj.analyticEventRate,
    rateErr,
    single,
    finite,
    ok,
    methodId: METHOD_ALGO_KMC_STEP,
    familyId: METHOD_KMC,
  }
}
