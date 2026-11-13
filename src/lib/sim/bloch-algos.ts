/**
 * Classical Bloch / MRI toy · magnetization precession about B0.
 * dM/dt = γ M × B − (Mx,My)/T2  (optional transverse decay; Mz free or T1).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · classical Bloch equations. */
export const METHOD_BLOCH = 'method-bloch'

/** Algo · precession of M about static B0 (+ optional T2). */
export const METHOD_ALGO_BLOCH_PRECESS = 'method-algo-bloch-precess'

/** Parent alias (aligns with familyId). */
export const BLOCH_PARENT = METHOD_BLOCH

export const BLOCH_METHOD_IDS = [METHOD_ALGO_BLOCH_PRECESS] as const

/** Proton gyromagnetic ratio magnitude (rad/(s·T)), teaching default. */
export const GAMMA_PROTON = 2.6752218744e8

/** Magnetization vector [Mx, My, Mz]. */
export type BlochM = {
  Mx: number
  My: number
  Mz: number
}

/** Static field / relaxation parameters. */
export type BlochParams = {
  /** |B0| along +z (T). */
  B0: number
  /** Gyromagnetic ratio (rad/(s·T)); sign: positive ⇒ right-hand M×B. */
  gamma: number
  /** Transverse relaxation T2 (s); Infinity ⇒ no decay. */
  T2: number
  /** Longitudinal T1 (s); Infinity ⇒ Mz frozen. */
  T1: number
  /** Equilibrium Mz (usually 1 in normalized units). */
  M0: number
}

export const DEFAULT_BLOCH: Readonly<BlochParams> = {
  B0: 1.5,
  gamma: GAMMA_PROTON,
  T2: Infinity,
  T1: Infinity,
  M0: 1,
}

/** Larmor angular frequency ω0 = γ B0 (rad/s). */
export function larmorOmega(
  B0: number,
  gamma: number = GAMMA_PROTON,
): number {
  return gamma * B0
}

/** |M| Euclidean norm. */
export function magNorm(m: BlochM): number {
  return Math.hypot(m.Mx, m.My, m.Mz)
}

/** Transverse magnitude Mxy = hypot(Mx, My). */
export function mxy(m: BlochM): number {
  return Math.hypot(m.Mx, m.My)
}

/**
 * Analytic free precession about B = (0,0,B0) over time dt:
 * rotate (Mx,My) by φ = ω0·dt, apply exp(−dt/T2) on transverse,
 * optional T1 recovery on Mz.
 */
export function blochPrecessAnalytic(
  m: BlochM,
  dt: number,
  p: BlochParams = DEFAULT_BLOCH,
): BlochM {
  const w = larmorOmega(p.B0, p.gamma)
  const phi = w * dt
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  // M × z-hat precession: dMx/dt = γ My Bz? With dM/dt = γ M×B, B=(0,0,B0):
  // dMx/dt = γ (My B0), dMy/dt = −γ (Mx B0)  ⇒ rotate by −ω t if ω=γB0
  // Convention: rotate transverse by −ω0 t (clockwise looking along +z for γ>0).
  let Mx = m.Mx * c + m.My * s
  let My = -m.Mx * s + m.My * c
  let Mz = m.Mz

  if (Number.isFinite(p.T2) && p.T2 > 0) {
    const e2 = Math.exp(-dt / p.T2)
    Mx *= e2
    My *= e2
  }
  if (Number.isFinite(p.T1) && p.T1 > 0) {
    const e1 = Math.exp(-dt / p.T1)
    Mz = m.Mz * e1 + p.M0 * (1 - e1)
  }
  return { Mx, My, Mz }
}

/**
 * Explicit Euler step of classical Bloch with B = (0,0,B0):
 *   dM/dt = γ M × B − Mx/T2 x̂ − My/T2 ŷ − (Mz−M0)/T1 ẑ
 */
export function blochEulerStep(
  m: BlochM,
  dt: number,
  p: BlochParams = DEFAULT_BLOCH,
): BlochM {
  const gxB = p.gamma * p.B0
  // M × B = (My Bz, −Mx Bz, 0) when B=(0,0,Bz)
  let dMx = gxB * m.My
  let dMy = -gxB * m.Mx
  let dMz = 0
  if (Number.isFinite(p.T2) && p.T2 > 0) {
    dMx -= m.Mx / p.T2
    dMy -= m.My / p.T2
  }
  if (Number.isFinite(p.T1) && p.T1 > 0) {
    dMz -= (m.Mz - p.M0) / p.T1
  }
  return {
    Mx: m.Mx + dt * dMx,
    My: m.My + dt * dMy,
    Mz: m.Mz + dt * dMz,
  }
}

/**
 * Integrate free precession with analytic substeps (exact for constant B0).
 * Records trajectory of length nSteps+1.
 */
export function integrateBlochPrecess(
  m0: BlochM,
  opts: {
    dt?: number
    nSteps?: number
    p?: BlochParams
  } = {},
): {
  t: Float64Array
  Mx: Float64Array
  My: Float64Array
  Mz: Float64Array
  Mxy: Float64Array
  mFinal: BlochM
  finite: boolean
} {
  const dt = opts.dt ?? 1e-6
  const nSteps = opts.nSteps ?? 200
  const p = opts.p ?? DEFAULT_BLOCH

  const t = new Float64Array(nSteps + 1)
  const Mx = new Float64Array(nSteps + 1)
  const My = new Float64Array(nSteps + 1)
  const Mz = new Float64Array(nSteps + 1)
  const Mxy = new Float64Array(nSteps + 1)

  let m = { ...m0 }
  Mx[0] = m.Mx
  My[0] = m.My
  Mz[0] = m.Mz
  Mxy[0] = mxy(m)
  t[0] = 0
  let finite =
    Number.isFinite(m.Mx) && Number.isFinite(m.My) && Number.isFinite(m.Mz)

  for (let i = 0; i < nSteps; i++) {
    m = blochPrecessAnalytic(m, dt, p)
    Mx[i + 1] = m.Mx
    My[i + 1] = m.My
    Mz[i + 1] = m.Mz
    Mxy[i + 1] = mxy(m)
    t[i + 1] = (i + 1) * dt
    if (
      !Number.isFinite(m.Mx) ||
      !Number.isFinite(m.My) ||
      !Number.isFinite(m.Mz)
    ) {
      finite = false
    }
  }

  return { t, Mx, My, Mz, Mxy, mFinal: m, finite }
}

/**
 * Representative sample: tip M into transverse plane, precess about B0.
 * Without T2, |M| and Mxy conserved; with T2, Mxy decays.
 */
export function runBlochPrecessSample(
  opts: {
    B0?: number
    gamma?: number
    T2?: number
    nSteps?: number
    /** Fractions of Larmor period for dt: dt = period / stepsPerPeriod. */
    stepsPerPeriod?: number
    nPeriods?: number
  } = {},
): {
  omega0: number
  period: number
  m0: BlochM
  mFinal: BlochM
  /** |M| conserved without relaxation */
  normConserved: boolean
  /** Mxy conserved when T2=∞ */
  mxyConserved: boolean
  /** with finite T2, final Mxy < initial */
  t2Decays: boolean
  /** tip stayed transverse: |Mz| small if started transverse */
  stayedTransverse: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BLOCH_PRECESS
  familyId: typeof METHOD_BLOCH
} {
  const B0 = opts.B0 ?? 1.5
  const gamma = opts.gamma ?? GAMMA_PROTON
  const T2 = opts.T2 ?? Infinity
  const stepsPerPeriod = opts.stepsPerPeriod ?? 64
  const nPeriods = opts.nPeriods ?? 2
  const omega0 = larmorOmega(B0, gamma)
  const period = (2 * Math.PI) / omega0
  const dt = period / stepsPerPeriod
  const nSteps = opts.nSteps ?? stepsPerPeriod * nPeriods

  const p: BlochParams = {
    B0,
    gamma,
    T2,
    T1: Infinity,
    M0: 1,
  }
  // Pure transverse tip (90° pulse toy)
  const m0: BlochM = { Mx: 1, My: 0, Mz: 0 }
  const traj = integrateBlochPrecess(m0, { dt, nSteps, p })
  const mFinal = traj.mFinal
  const n0 = magNorm(m0)
  const nF = magNorm(mFinal)
  const mxy0 = mxy(m0)
  const mxyF = mxy(mFinal)

  const noRelax = !Number.isFinite(T2)
  const normConserved = noRelax ? Math.abs(nF - n0) < 1e-8 : true
  const mxyConserved = noRelax ? Math.abs(mxyF - mxy0) < 1e-8 : true
  // Separate finite-T2 check using a short run
  const pT2: BlochParams = { ...p, T2: period } // T2 = one Larmor period
  const trajT2 = integrateBlochPrecess(m0, {
    dt,
    nSteps: stepsPerPeriod * 3,
    p: pT2,
  })
  const t2Decays = mxy(trajT2.mFinal) < mxy0 * 0.2
  const stayedTransverse = Math.abs(mFinal.Mz) < 1e-9
  const finite = traj.finite && trajT2.finite
  const ok =
    finite &&
    normConserved &&
    mxyConserved &&
    t2Decays &&
    stayedTransverse &&
    omega0 > 0

  return {
    omega0,
    period,
    m0,
    mFinal,
    normConserved,
    mxyConserved,
    t2Decays,
    stayedTransverse,
    finite,
    ok,
    methodId: METHOD_ALGO_BLOCH_PRECESS,
    familyId: METHOD_BLOCH,
  }
}
