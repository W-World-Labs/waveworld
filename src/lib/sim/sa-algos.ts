/**
 * Simulated annealing pure teaching stubs.
 * Minimize 1D multimodal f(x) = x²/10 + sin(3x); geometric T schedule;
 * Metropolis accept worse moves with exp(−Δf/T); track best energy drop.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · simulated annealing. */
export const METHOD_SA = 'method-simulated-annealing'

/** Algo · single SA proposal + Metropolis accept/reject step. */
export const METHOD_ALGO_SA_STEP = 'method-algo-sa-step'

/** Parent alias (aligns with familyId). */
export const SA_PARENT = METHOD_SA

export const SA_METHOD_IDS = [METHOD_ALGO_SA_STEP] as const

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
 * Multimodal 1D objective: f(x) = x²/10 + sin(3x).
 * Global basin near x ≈ −0.5…0 with local wiggles from sin(3x).
 */
export function multimodal1d(x: number): number {
  return (x * x) / 10 + Math.sin(3 * x)
}

/**
 * Geometric cooling: T_{k+1} = α T_k, α ∈ (0,1).
 * Returns T after `step` cools from T0 (step 0 → T0).
 */
export function geometricTemperature(
  T0: number,
  alpha: number,
  step: number,
): number {
  if (!(T0 > 0) || !Number.isFinite(T0)) {
    throw new Error('geometricTemperature: T0 must be finite and > 0')
  }
  if (!(alpha > 0) || !(alpha < 1) || !Number.isFinite(alpha)) {
    throw new Error('geometricTemperature: alpha must be in (0,1)')
  }
  if (!(step >= 0) || !Number.isFinite(step)) {
    throw new Error('geometricTemperature: step must be finite and ≥ 0')
  }
  return T0 * Math.pow(alpha, step)
}

/**
 * Metropolis acceptance probability for minimization:
 * P = 1 if Δf ≤ 0, else exp(−Δf / T).
 */
export function metropolisAcceptProb(df: number, T: number): number {
  if (!(T > 0) || !Number.isFinite(T)) {
    throw new Error('metropolisAcceptProb: T must be finite and > 0')
  }
  if (!Number.isFinite(df)) {
    throw new Error('metropolisAcceptProb: df must be finite')
  }
  if (df <= 0) return 1
  const p = Math.exp(-df / T)
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0
}

/**
 * Draw accept/reject: true iff u < P(accept).
 * u should be uniform in [0,1).
 */
export function metropolisAccept(df: number, T: number, u: number): boolean {
  return u < metropolisAcceptProb(df, T)
}

export type SaStepResult = {
  x: number
  energy: number
  xProp: number
  energyProp: number
  df: number
  T: number
  accepted: boolean
  bestX: number
  bestEnergy: number
}

/**
 * One SA step on 1D multimodal f:
 * propose x' = x + σ·N~U(−1,1) (scaled uniform), Metropolis, update best.
 */
export function saStep1d(
  x: number,
  energy: number,
  bestX: number,
  bestEnergy: number,
  T: number,
  sigma: number,
  rand: () => number,
  f: (x: number) => number = multimodal1d,
): SaStepResult {
  if (!(T > 0) || !(sigma > 0) || !Number.isFinite(x) || !Number.isFinite(energy)) {
    throw new Error('saStep1d: need T>0, sigma>0, finite x and energy')
  }
  // u ∈ [0,1) → δ ∈ (−1,1)
  const delta = 2 * rand() - 1
  const xProp = x + sigma * delta
  const energyProp = f(xProp)
  const df = energyProp - energy
  const accepted = metropolisAccept(df, T, rand())
  const xNext = accepted ? xProp : x
  const eNext = accepted ? energyProp : energy
  let bx = bestX
  let be = bestEnergy
  if (eNext < be) {
    bx = xNext
    be = eNext
  }
  return {
    x: xNext,
    energy: eNext,
    xProp,
    energyProp,
    df,
    T,
    accepted,
    bestX: bx,
    bestEnergy: be,
  }
}

export type SaTrajectory = {
  steps: number
  x: number
  energy: number
  bestX: number
  bestEnergy: number
  energy0: number
  bestEnergy0: number
  /** Best energy after each step (length steps). */
  bestHistory: Float64Array
  /** Temperature after each cool (length steps). */
  THistory: Float64Array
  acceptCount: number
  acceptRate: number
}

/**
 * Run SA for `steps` Metropolis moves with geometric cooling every step.
 * T_k = T0 · α^k before step k; proposal width = sigma.
 */
export function runSaTrajectory(
  steps: number,
  opts: {
    x0?: number
    T0?: number
    alpha?: number
    sigma?: number
    seed?: number
    f?: (x: number) => number
  } = {},
): SaTrajectory {
  if (!(steps > 0) || !Number.isFinite(steps)) {
    throw new Error('runSaTrajectory: steps must be positive finite')
  }
  const n = Math.floor(steps)
  const x0 = opts.x0 ?? 3.5
  const T0 = opts.T0 ?? 2.0
  const alpha = opts.alpha ?? 0.995
  const sigma = opts.sigma ?? 0.6
  const seed = opts.seed ?? 42
  const f = opts.f ?? multimodal1d

  const rand = mulberry32(seed)
  let x = x0
  let energy = f(x)
  let bestX = x
  let bestEnergy = energy
  const energy0 = energy
  const bestEnergy0 = bestEnergy
  const bestHistory = new Float64Array(n)
  const THistory = new Float64Array(n)
  let acceptCount = 0

  for (let k = 0; k < n; k++) {
    const T = geometricTemperature(T0, alpha, k)
    const s = saStep1d(x, energy, bestX, bestEnergy, T, sigma, rand, f)
    x = s.x
    energy = s.energy
    bestX = s.bestX
    bestEnergy = s.bestEnergy
    if (s.accepted) acceptCount++
    bestHistory[k] = bestEnergy
    THistory[k] = T
  }

  return {
    steps: n,
    x,
    energy,
    bestX,
    bestEnergy,
    energy0,
    bestEnergy0,
    bestHistory,
    THistory,
    acceptCount,
    acceptRate: acceptCount / n,
  }
}

/**
 * Representative sample: SA on multimodal 1D.
 * Best energy drops vs start; finite; teaching gate ok.
 */
export function runSaStepSample(
  opts: {
    steps?: number
    x0?: number
    T0?: number
    alpha?: number
    sigma?: number
    seed?: number
  } = {},
): {
  steps: number
  energy0: number
  bestEnergy0: number
  bestEnergy: number
  bestX: number
  energyDrop: number
  bestDropped: boolean
  acceptRate: number
  T0: number
  TFinal: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SA_STEP
  familyId: typeof METHOD_SA
} {
  // Start far out on the quadratic bowl so best-energy drop is unambiguous.
  const steps = opts.steps ?? 1500
  const x0 = opts.x0 ?? 5.5
  const T0 = opts.T0 ?? 4.0
  const alpha = opts.alpha ?? 0.995
  const sigma = opts.sigma ?? 1.0
  const seed = opts.seed ?? 17

  const traj = runSaTrajectory(steps, { x0, T0, alpha, sigma, seed })
  const energyDrop = traj.bestEnergy0 - traj.bestEnergy
  const bestDropped = traj.bestEnergy < traj.bestEnergy0 - 1e-9
  const TFinal = traj.THistory[traj.THistory.length - 1]!

  // single isolated step for structure (always finite Metropolis)
  const rand1 = mulberry32(seed + 3)
  const one = saStep1d(x0, multimodal1d(x0), x0, multimodal1d(x0), T0, sigma, rand1)

  const finite =
    Number.isFinite(traj.bestEnergy) &&
    Number.isFinite(traj.bestX) &&
    Number.isFinite(traj.energy) &&
    Number.isFinite(TFinal) &&
    Number.isFinite(one.energy) &&
    Number.isFinite(one.xProp)

  // f(5.5)≈3+sin; any visit near |x|≲2 with sin low drops energy by ≫1
  const ok =
    finite &&
    bestDropped &&
    energyDrop > 1.0 &&
    traj.bestEnergy < traj.energy0 &&
    TFinal < T0 &&
    traj.acceptRate > 0 &&
    traj.acceptRate < 1

  return {
    steps: traj.steps,
    energy0: traj.energy0,
    bestEnergy0: traj.bestEnergy0,
    bestEnergy: traj.bestEnergy,
    bestX: traj.bestX,
    energyDrop,
    bestDropped,
    acceptRate: traj.acceptRate,
    T0,
    TFinal,
    finite,
    ok,
    methodId: METHOD_ALGO_SA_STEP,
    familyId: METHOD_SA,
  }
}
