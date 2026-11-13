/**
 * Particle Swarm Optimization pure teaching stubs.
 * 2D swarm: velocity update v = w v + c1 r1 (pbest−x) + c2 r2 (gbest−x);
 * position x += v; minimize sphere ‖x‖² or Rosenbrock-lite; gbest f drops.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · particle swarm optimization. */
export const METHOD_PSO = 'method-pso'

/** Algo · single PSO velocity/position update step (full swarm). */
export const METHOD_ALGO_PSO_STEP = 'method-algo-pso-step'

/** Parent alias (aligns with familyId). */
export const PSO_PARENT = METHOD_PSO

export const PSO_METHOD_IDS = [METHOD_ALGO_PSO_STEP] as const

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

/** Scalar objective f: R^d → R (minimize). */
export type PsoObjective = {
  f: (x: Float64Array) => number
  dim: number
}

/** Sphere: f(x) = ‖x‖². Global min at 0, f=0. */
export function sphere(x: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!
    s += xi * xi
  }
  return s
}

export function makeSphereObjective(dim = 2): PsoObjective {
  return {
    dim,
    f(x) {
      return sphere(x)
    },
  }
}

/**
 * Rosenbrock-lite: f(x,y) = (1−x)² + β (y − x²)² with mild β (default 10).
 * Global min (1,1), f=0.
 */
export function rosenbrockLite(x: ArrayLike<number>, beta = 10): number {
  const a = 1 - x[0]!
  const b = x[1]! - x[0]! * x[0]!
  return a * a + beta * b * b
}

export function makeRosenbrockLite(beta = 10): PsoObjective {
  return {
    dim: 2,
    f(x) {
      return rosenbrockLite(x, beta)
    },
  }
}

/** ‖v‖₂ */
export function norm2(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

export type Particle = {
  /** current position */
  x: Float64Array
  /** current velocity */
  v: Float64Array
  /** personal best position */
  pbest: Float64Array
  /** personal best objective value */
  pbestF: number
  /** current objective value */
  f: number
}

export type Swarm = {
  particles: Particle[]
  /** global best position (clone) */
  gbest: Float64Array
  /** global best objective */
  gbestF: number
  dim: number
}

export type PsoParams = {
  /** inertia weight */
  w: number
  /** cognitive coefficient */
  c1: number
  /** social coefficient */
  c2: number
  /** clamp |v_i| ≤ vMax if set */
  vMax?: number
}

export const DEFAULT_PSO_PARAMS: PsoParams = {
  w: 0.72,
  c1: 1.49,
  c2: 1.49,
  vMax: 2.0,
}

/**
 * Uniform random vector in [lo, hi]^dim.
 */
export function randomVector(
  dim: number,
  lo: number,
  hi: number,
  rand: () => number,
): Float64Array {
  if (!(dim > 0) || !Number.isInteger(dim)) {
    throw new Error('randomVector: dim must be positive integer')
  }
  const v = new Float64Array(dim)
  const span = hi - lo
  for (let i = 0; i < dim; i++) v[i] = lo + rand() * span
  return v
}

/**
 * Initialize a swarm: positions in [lo,hi]^dim, velocities in [−vSpan,vSpan]^dim.
 * pbest = x, gbest = argmin f among particles.
 */
export function initSwarm(
  nParticles: number,
  obj: PsoObjective,
  opts: {
    lo?: number
    hi?: number
    vSpan?: number
    rand: () => number
  },
): Swarm {
  if (!(nParticles >= 2) || !Number.isInteger(nParticles)) {
    throw new Error('initSwarm: nParticles must be integer ≥ 2')
  }
  const dim = obj.dim
  const lo = opts.lo ?? -5
  const hi = opts.hi ?? 5
  const vSpan = opts.vSpan ?? 1
  const rand = opts.rand

  const particles: Particle[] = []
  let gbest = new Float64Array(dim)
  let gbestF = Infinity

  for (let i = 0; i < nParticles; i++) {
    const x = randomVector(dim, lo, hi, rand)
    const v = randomVector(dim, -vSpan, vSpan, rand)
    const f = obj.f(x)
    const pbest = new Float64Array(x)
    particles.push({ x, v, pbest, pbestF: f, f })
    if (f < gbestF) {
      gbestF = f
      gbest = new Float64Array(x)
    }
  }

  return { particles, gbest, gbestF, dim }
}

/**
 * Classic PSO velocity/position update for one particle (one dimension loop):
 *   v ← w v + c1 r1 (pbest − x) + c2 r2 (gbest − x)
 *   x ← x + v
 * Optional |v_i| clamp. Returns new f at updated x (caller supplies obj).
 */
export function psoUpdateParticle(
  p: Particle,
  gbest: Float64Array,
  params: PsoParams,
  rand: () => number,
  obj: PsoObjective,
): void {
  const { w, c1, c2, vMax } = params
  const dim = p.x.length
  if (gbest.length !== dim || p.v.length !== dim || p.pbest.length !== dim) {
    throw new Error('psoUpdateParticle: dimension mismatch')
  }
  if (!Number.isFinite(w) || !Number.isFinite(c1) || !Number.isFinite(c2)) {
    throw new Error('psoUpdateParticle: params must be finite')
  }

  for (let d = 0; d < dim; d++) {
    const r1 = rand()
    const r2 = rand()
    let vd =
      w * p.v[d]! +
      c1 * r1 * (p.pbest[d]! - p.x[d]!) +
      c2 * r2 * (gbest[d]! - p.x[d]!)
    if (vMax !== undefined && Number.isFinite(vMax) && vMax > 0) {
      if (vd > vMax) vd = vMax
      else if (vd < -vMax) vd = -vMax
    }
    p.v[d] = vd
    p.x[d]! += vd
  }

  const f = obj.f(p.x)
  p.f = f
  if (f < p.pbestF) {
    p.pbestF = f
    for (let d = 0; d < dim; d++) p.pbest[d] = p.x[d]!
  }
}

/**
 * One PSO iteration: update every particle, then refresh gbest.
 */
export function psoStep(
  swarm: Swarm,
  obj: PsoObjective,
  params: PsoParams,
  rand: () => number,
): Swarm {
  const { particles, dim } = swarm
  if (obj.dim !== dim) throw new Error('psoStep: objective dim mismatch')

  for (let i = 0; i < particles.length; i++) {
    psoUpdateParticle(particles[i]!, swarm.gbest, params, rand, obj)
  }

  let gbestF = swarm.gbestF
  let gbestIdx = -1
  for (let i = 0; i < particles.length; i++) {
    if (particles[i]!.pbestF < gbestF) {
      gbestF = particles[i]!.pbestF
      gbestIdx = i
    }
  }
  if (gbestIdx >= 0) {
    swarm.gbestF = gbestF
    const src = particles[gbestIdx]!.pbest
    for (let d = 0; d < dim; d++) swarm.gbest[d] = src[d]!
  }

  return swarm
}

export type PsoTrajectory = {
  steps: number
  gbestF0: number
  gbestF: number
  gbest: Float64Array
  /** gbest f after each step (length steps); nonincreasing */
  gbestHistory: Float64Array
  dim: number
  nParticles: number
}

/**
 * Run PSO for `steps` iterations from a fresh swarm.
 */
export function runPsoTrajectory(
  steps: number,
  opts: {
    nParticles?: number
    dim?: number
    lo?: number
    hi?: number
    vSpan?: number
    seed?: number
    params?: Partial<PsoParams>
    /** 'sphere' | 'rosenbrock' */
    objective?: 'sphere' | 'rosenbrock'
    beta?: number
  } = {},
): PsoTrajectory {
  if (!(steps > 0) || !Number.isFinite(steps)) {
    throw new Error('runPsoTrajectory: steps must be positive finite')
  }
  const n = Math.floor(steps)
  const nParticles = opts.nParticles ?? 20
  const dim = opts.dim ?? 2
  const seed = opts.seed ?? 42
  const objective = opts.objective ?? 'sphere'
  const rand = mulberry32(seed)

  const obj: PsoObjective =
    objective === 'rosenbrock'
      ? makeRosenbrockLite(opts.beta ?? 10)
      : makeSphereObjective(dim)

  if (objective === 'rosenbrock' && obj.dim !== 2) {
    throw new Error('runPsoTrajectory: rosenbrock is 2D only')
  }

  const params: PsoParams = {
    ...DEFAULT_PSO_PARAMS,
    ...opts.params,
  }

  // Sphere: start far from 0 so gbest drop is clear.
  // Rosenbrock: box around a point away from (1,1).
  const lo = opts.lo ?? (objective === 'rosenbrock' ? -1.5 : 2)
  const hi = opts.hi ?? (objective === 'rosenbrock' ? 1.5 : 5)
  const vSpan = opts.vSpan ?? 0.5

  const swarm = initSwarm(nParticles, obj, { lo, hi, vSpan, rand })
  const gbestF0 = swarm.gbestF
  const gbestHistory = new Float64Array(n)

  for (let k = 0; k < n; k++) {
    psoStep(swarm, obj, params, rand)
    gbestHistory[k] = swarm.gbestF
  }

  return {
    steps: n,
    gbestF0,
    gbestF: swarm.gbestF,
    gbest: new Float64Array(swarm.gbest),
    gbestHistory,
    dim: swarm.dim,
    nParticles,
  }
}

/**
 * Representative sample: 2D PSO on sphere (and short Rosenbrock check).
 * Global best f decreases; teaching gate ok.
 */
export function runPsoStepSample(
  opts: {
    steps?: number
    nParticles?: number
    seed?: number
  } = {},
): {
  steps: number
  nParticles: number
  dim: number
  gbestF0: number
  gbestF: number
  energyDrop: number
  bestDropped: boolean
  gbestNorm: number
  rosenGbestF0: number
  rosenGbestF: number
  rosenImproved: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PSO_STEP
  familyId: typeof METHOD_PSO
} {
  const steps = opts.steps ?? 80
  const nParticles = opts.nParticles ?? 24
  const seed = opts.seed ?? 17

  const traj = runPsoTrajectory(steps, {
    nParticles,
    dim: 2,
    lo: 2,
    hi: 5,
    vSpan: 0.8,
    seed,
    objective: 'sphere',
    params: { w: 0.72, c1: 1.49, c2: 1.49, vMax: 2.5 },
  })

  const energyDrop = traj.gbestF0 - traj.gbestF
  const bestDropped = traj.gbestF < traj.gbestF0 - 1e-9
  const gbestNorm = norm2(traj.gbest)

  // Short Rosenbrock-lite run for dual coverage
  const rosen = runPsoTrajectory(100, {
    nParticles: 30,
    dim: 2,
    lo: -1,
    hi: 2,
    vSpan: 0.4,
    seed: seed + 3,
    objective: 'rosenbrock',
    beta: 10,
    params: { w: 0.7, c1: 1.6, c2: 1.6, vMax: 1.5 },
  })
  const rosenImproved = rosen.gbestF < rosen.gbestF0 - 1e-6

  // Structural single-particle update sanity (finite)
  const rand1 = mulberry32(seed + 9)
  const obj = makeSphereObjective(2)
  const p: Particle = {
    x: new Float64Array([3, 4]),
    v: new Float64Array([0.1, -0.2]),
    pbest: new Float64Array([3, 4]),
    pbestF: sphere([3, 4]),
    f: sphere([3, 4]),
  }
  const g = new Float64Array([0, 0])
  psoUpdateParticle(p, g, DEFAULT_PSO_PARAMS, rand1, obj)

  const finite =
    Number.isFinite(traj.gbestF) &&
    Number.isFinite(traj.gbestF0) &&
    Number.isFinite(gbestNorm) &&
    Number.isFinite(rosen.gbestF) &&
    Number.isFinite(p.f) &&
    Number.isFinite(p.v[0]!) &&
    Number.isFinite(p.x[0]!)

  // Sphere from [2,5]²: f0 ≳ 8; after swarming toward 0, clear drop
  const ok =
    finite &&
    bestDropped &&
    energyDrop > 5 &&
    traj.gbestF < traj.gbestF0 &&
    traj.gbestF < 1.0 &&
    gbestNorm < 1.5 &&
    rosenImproved

  return {
    steps: traj.steps,
    nParticles: traj.nParticles,
    dim: traj.dim,
    gbestF0: traj.gbestF0,
    gbestF: traj.gbestF,
    energyDrop,
    bestDropped,
    gbestNorm,
    rosenGbestF0: rosen.gbestF0,
    rosenGbestF: rosen.gbestF,
    rosenImproved,
    finite,
    ok,
    methodId: METHOD_ALGO_PSO_STEP,
    familyId: METHOD_PSO,
  }
}
