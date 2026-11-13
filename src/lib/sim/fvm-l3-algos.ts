/**
 * 有限体积三级 · 1D Euler HLLC 近似 Riemann 通量。
 * Harten–Lax–van Leer-Contact：三波 SL/SM/SR + 接触 star 态。
 * method id 仅常量；catalog 子节点 method-algo-fvm-hllc-stub。
 */
import { FVM_PARENT, sumMass } from './fvm-algos'

export { FVM_PARENT, sumMass }

/** 三级 · HLLC 近似 Riemann。 */
export const METHOD_ALGO_FVM_HLLC = 'method-algo-fvm-hllc-stub'

export const FVM_L3_METHOD_IDS = [METHOD_ALGO_FVM_HLLC] as const

export type EulerPrim = { rho: number; u: number; p: number }
export type EulerCons = { rho: number; mom: number; E: number }

const GAMMA = 1.4

/** 原变量 → 守恒量 (ρ, ρu, E)，E = p/(γ−1) + ½ ρ u²。 */
export function primToCons(w: EulerPrim, gamma = GAMMA): EulerCons {
  const eInt = w.p / (gamma - 1)
  return {
    rho: w.rho,
    mom: w.rho * w.u,
    E: eInt + 0.5 * w.rho * w.u * w.u,
  }
}

/** 守恒量 → 原变量。 */
export function consToPrim(U: EulerCons, gamma = GAMMA): EulerPrim {
  const rho = Math.max(U.rho, 1e-14)
  const u = U.mom / rho
  const p = Math.max((gamma - 1) * (U.E - 0.5 * rho * u * u), 1e-14)
  return { rho, u, p }
}

/** 物理通量 F(U)。 */
export function eulerFlux(U: EulerCons, gamma = GAMMA): EulerCons {
  const w = consToPrim(U, gamma)
  return {
    rho: U.mom,
    mom: U.mom * w.u + w.p,
    E: (U.E + w.p) * w.u,
  }
}

/** 声速 a = √(γ p / ρ)。 */
export function soundSpeed(w: EulerPrim, gamma = GAMMA): number {
  return Math.sqrt((gamma * w.p) / Math.max(w.rho, 1e-14))
}

/**
 * Einfeldt / pressure-based 波速估计（简化）：
 * SL = min(uL−aL, uR−aR)，SR = max(uL+aL, uR+aR)。
 */
export function waveSpeeds(
  wL: EulerPrim,
  wR: EulerPrim,
  gamma = GAMMA,
): { SL: number; SR: number } {
  const aL = soundSpeed(wL, gamma)
  const aR = soundSpeed(wR, gamma)
  return {
    SL: Math.min(wL.u - aL, wR.u - aR),
    SR: Math.max(wL.u + aL, wR.u + aR),
  }
}

/**
 * 接触波速 SM（Toro）：
 * SM = (pR−pL + ρL uL(SL−uL) − ρR uR(SR−uR))
 *      / (ρL(SL−uL) − ρR(SR−uR))
 */
export function contactSpeed(
  wL: EulerPrim,
  wR: EulerPrim,
  SL: number,
  SR: number,
): number {
  const num =
    wR.p -
    wL.p +
    wL.rho * wL.u * (SL - wL.u) -
    wR.rho * wR.u * (SR - wR.u)
  const den = wL.rho * (SL - wL.u) - wR.rho * (SR - wR.u)
  if (Math.abs(den) < 1e-14) return 0.5 * (wL.u + wR.u)
  return num / den
}

/** HLLC star 态守恒向量 U*_K。 */
export function hllcStarState(
  U: EulerCons,
  w: EulerPrim,
  SK: number,
  SM: number,
  gamma = GAMMA,
): EulerCons {
  const denom = SK - SM
  if (Math.abs(denom) < 1e-14) return { ...U }
  const rhoStar = w.rho * (SK - w.u) / denom
  const pStar =
    w.p + w.rho * (SK - w.u) * (SM - w.u)
  const eStar =
    U.E / Math.max(w.rho, 1e-14) +
    (SM - w.u) * (SM + w.p / (w.rho * (SK - w.u) + 1e-30))
  // 标准 Toro 形式：
  // E* = ((SK−u)E − p u + p* SM) / (SK − SM)
  const EStar =
    ((SK - w.u) * U.E - w.p * w.u + pStar * SM) / denom
  void eStar
  void gamma
  return {
    rho: rhoStar,
    mom: rhoStar * SM,
    E: EStar,
  }
}

/**
 * HLLC 数值通量（1D Euler）：
 *  F* = F_L                 if 0 ≤ SL
 *     = F_L + SL(U*_L−U_L)  if SL ≤ 0 ≤ SM
 *     = F_R + SR(U*_R−U_R)  if SM ≤ 0 ≤ SR
 *     = F_R                 if 0 ≥ SR
 */
export function hllcFlux(
  UL: EulerCons,
  UR: EulerCons,
  gamma = GAMMA,
): EulerCons {
  const wL = consToPrim(UL, gamma)
  const wR = consToPrim(UR, gamma)
  const { SL, SR } = waveSpeeds(wL, wR, gamma)
  const SM = contactSpeed(wL, wR, SL, SR)
  const FL = eulerFlux(UL, gamma)
  const FR = eulerFlux(UR, gamma)

  if (0 <= SL) return FL
  if (0 >= SR) return FR

  if (SL <= 0 && 0 <= SM) {
    const Ustar = hllcStarState(UL, wL, SL, SM, gamma)
    return {
      rho: FL.rho + SL * (Ustar.rho - UL.rho),
      mom: FL.mom + SL * (Ustar.mom - UL.mom),
      E: FL.E + SL * (Ustar.E - UL.E),
    }
  }
  // SM ≤ 0 ≤ SR
  const Ustar = hllcStarState(UR, wR, SR, SM, gamma)
  return {
    rho: FR.rho + SR * (Ustar.rho - UR.rho),
    mom: FR.mom + SR * (Ustar.mom - UR.mom),
    E: FR.E + SR * (Ustar.E - UR.E),
  }
}

/** 标量场 L1 质量（ρ 单元和 × dx）。 */
function massRho(rho: Float64Array, dx: number): number {
  return sumMass(rho) * dx
}

/**
 * 1D Euler HLLC 一步：U_i ← U_i − (dt/dx)(F_{i+1/2}−F_{i−1/2})。
 * boundary 'periodic'（默认）或 'transmissive'（零梯度：端面通量用边界单元
 * 自身状态，等价 OpenFOAM zeroGradient）。
 */
export function hllcStep1d(
  rho: Float64Array,
  mom: Float64Array,
  E: Float64Array,
  dx: number,
  dt: number,
  gamma = GAMMA,
  boundary: 'periodic' | 'transmissive' = 'periodic',
): { rho: Float64Array; mom: Float64Array; E: Float64Array } {
  const n = rho.length
  // n+1 interface fluxes; transmissive ends use the edge cell itself as the
  // ghost state (zero gradient, equivalent to OpenFOAM zeroGradient).
  const Fr = new Float64Array(n + 1)
  const Fm = new Float64Array(n + 1)
  const Fe = new Float64Array(n + 1)
  for (let f = 0; f <= n; f++) {
    const iL = f - 1
    const iR = f
    const L = iL < 0 ? (boundary === 'periodic' ? n - 1 : iR) : iL
    const R = iR >= n ? (boundary === 'periodic' ? 0 : iL) : iR
    const UL: EulerCons = { rho: rho[L]!, mom: mom[L]!, E: E[L]! }
    const UR: EulerCons = { rho: rho[R]!, mom: mom[R]!, E: E[R]! }
    const F = hllcFlux(UL, UR, gamma)
    Fr[f] = F.rho
    Fm[f] = F.mom
    Fe[f] = F.E
  }
  const c = dt / dx
  const nRho = new Float64Array(n)
  const nMom = new Float64Array(n)
  const nE = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    nRho[i] = rho[i]! - c * (Fr[i + 1]! - Fr[i]!)
    nMom[i] = mom[i]! - c * (Fm[i + 1]! - Fm[i]!)
    nE[i] = E[i]! - c * (Fe[i + 1]! - Fe[i]!)
  }
  return { rho: nRho, mom: nMom, E: nE }
}

/**
 * Sod 激波管 + HLLC 若干步：质量守恒、密度跳跃向右传播、有限。
 */
export function runFvmHllcSample(opts?: {
  n?: number
  cfl?: number
  steps?: number
  gamma?: number
}): {
  n: number
  mass0: number
  massF: number
  massErr: number
  rhoL0: number
  rhoR0: number
  rhoMidF: number
  /** 接触/激波使中段密度介于左右初值之间 */
  intermediateOk: boolean
  finite: boolean
  methodId: typeof METHOD_ALGO_FVM_HLLC
  familyId: typeof FVM_PARENT
} {
  const n = opts?.n ?? 128
  const cfl = opts?.cfl ?? 0.4
  const steps = opts?.steps ?? 40
  const gamma = opts?.gamma ?? GAMMA
  const dx = 1 / n

  const rho = new Float64Array(n)
  const mom = new Float64Array(n)
  const E = new Float64Array(n)
  // Sod：左 (1,0,1)，右 (0.125,0,0.1)
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx
    const left = x < 0.5
    const w: EulerPrim = left
      ? { rho: 1, u: 0, p: 1 }
      : { rho: 0.125, u: 0, p: 0.1 }
    const U = primToCons(w, gamma)
    rho[i] = U.rho
    mom[i] = U.mom
    E[i] = U.E
  }
  const mass0 = massRho(rho, dx)
  const rhoL0 = rho[0]!
  const rhoR0 = rho[n - 1]!

  // 最大波速 ~ |u|+a ≤ ~√(γ) on left
  const aMax = Math.sqrt(gamma * 1 / 1) + 1
  const dt = (cfl * dx) / aMax

  let cur: { rho: Float64Array; mom: Float64Array; E: Float64Array } = {
    rho: new Float64Array(rho),
    mom: new Float64Array(mom),
    E: new Float64Array(E),
  }
  for (let s = 0; s < steps; s++) {
    const next = hllcStep1d(cur.rho, cur.mom, cur.E, dx, dt, gamma)
    cur = {
      rho: new Float64Array(next.rho),
      mom: new Float64Array(next.mom),
      E: new Float64Array(next.E),
    }
  }

  const massF = massRho(cur.rho, dx)
  const mid = (n / 2) | 0
  const rhoMidF = cur.rho[mid]!
  let finite = true
  for (let i = 0; i < n; i++) {
    if (
      !Number.isFinite(cur.rho[i]!) ||
      !Number.isFinite(cur.mom[i]!) ||
      !Number.isFinite(cur.E[i]!) ||
      cur.rho[i]! <= 0
    ) {
      finite = false
      break
    }
  }
  return {
    n,
    mass0,
    massF,
    massErr: Math.abs(massF - mass0),
    rhoL0,
    rhoR0,
    rhoMidF,
    intermediateOk: rhoMidF < rhoL0 && rhoMidF > rhoR0 * 0.5,
    finite,
    methodId: METHOD_ALGO_FVM_HLLC,
    familyId: FVM_PARENT,
  }
}

/** 精确 Riemann 星态：Newton–Raphson 解 f(p*) = fL+fR+uR−uL = 0。 */
export function exactRiemannStar(
  wL: EulerPrim,
  wR: EulerPrim,
  gamma = GAMMA,
): { pStar: number; uStar: number } {
  const aL = soundSpeed(wL, gamma)
  const aR = soundSpeed(wR, gamma)
  const prefun = (
    p: number,
    w: EulerPrim,
    a: number,
  ): { f: number; fd: number } => {
    if (p > w.p) {
      // shock: f = (p−pK) sqrt(A/(p+B)), A = 2/((γ+1)ρ), B = (γ−1)/(γ+1) pK
      const A = 2 / ((gamma + 1) * w.rho)
      const B = ((gamma - 1) / (gamma + 1)) * w.p
      const q = Math.sqrt(A / (p + B))
      return { f: (p - w.p) * q, fd: q * (1 - (p - w.p) / (2 * (p + B))) }
    }
    // rarefaction: f = 2a/(γ−1) ((p/pK)^((γ−1)/2γ) − 1)
    const pr = p / w.p
    const e = (gamma - 1) / (2 * gamma)
    return { f: ((2 * a) / (gamma - 1)) * (pr ** e - 1), fd: (1 / (w.rho * a)) * pr ** (-(gamma + 1) / (2 * gamma)) }
  }
  // two-rarefaction initial guess (Toro PVRS fallback to TRRS-free form)
  const pPV = Math.max(
    1e-12,
    0.5 * (wL.p + wR.p) -
      0.125 * (wR.u - wL.u) * (wL.rho + wR.rho) * (aL + aR),
  )
  let p = pPV
  for (let it = 0; it < 60; it++) {
    const { f: fL, fd: fdL } = prefun(p, wL, aL)
    const { f: fR, fd: fdR } = prefun(p, wR, aR)
    const dp = (fL + fR + wR.u - wL.u) / (fdL + fdR)
    const pNew = p - dp
    if (2 * Math.abs(pNew - p) / (pNew + p) < 1e-10) {
      p = pNew
      break
    }
    p = Math.max(pNew, 1e-12)
  }
  const { f: fL } = prefun(p, wL, aL)
  const { f: fR } = prefun(p, wR, aR)
  const uStar = 0.5 * (wL.u + wR.u + fR - fL)
  return { pStar: p, uStar }
}

/**
 * 精确 Riemann 解采样（1D Euler，隔膜 x0，时刻 t）。
 * 对每个 x 返回 (ρ, u, p)。Toro §4 标准扇形展开。
 */
export function exactRiemannEuler1d(opts: {
  wL: EulerPrim
  wR: EulerPrim
  gamma?: number
  /** 隔膜位置（默认 0）。 */
  x0?: number
  t: number
  x: ArrayLike<number>
}): { rho: Float64Array; u: Float64Array; p: Float64Array } {
  const { wL, wR } = opts
  const gamma = opts.gamma ?? GAMMA
  const x0 = opts.x0 ?? 0
  const t = opts.t
  const n = opts.x.length
  const rho = new Float64Array(n)
  const u = new Float64Array(n)
  const p = new Float64Array(n)
  if (!(t > 0)) {
    for (let i = 0; i < n; i++) {
      const w = opts.x[i]! < x0 ? wL : wR
      rho[i] = w.rho; u[i] = w.u; p[i] = w.p
    }
    return { rho, u, p }
  }
  const { pStar, uStar } = exactRiemannStar(wL, wR, gamma)
  const aL = soundSpeed(wL, gamma)
  const aR = soundSpeed(wR, gamma)

  // star densities
  const rhoStarL =
    pStar > wL.p
      ? wL.rho * ((pStar / wL.p + (gamma - 1) / (gamma + 1)) / (((gamma - 1) / (gamma + 1)) * (pStar / wL.p) + 1))
      : wL.rho * (pStar / wL.p) ** (1 / gamma)
  const rhoStarR =
    pStar > wR.p
      ? wR.rho * ((pStar / wR.p + (gamma - 1) / (gamma + 1)) / (((gamma - 1) / (gamma + 1)) * (pStar / wR.p) + 1))
      : wR.rho * (pStar / wR.p) ** (1 / gamma)

  // wave speeds (head/tail for rarefaction, S for shock)
  const sL =
    pStar > wL.p
      ? wL.u - aL * Math.sqrt(((gamma + 1) / (2 * gamma)) * (pStar / wL.p) + (gamma - 1) / (2 * gamma))
      : NaN
  const sHL = pStar <= wL.p ? wL.u - aL : NaN
  const sTL = pStar <= wL.p ? uStar - soundSpeed({ rho: rhoStarL, u: uStar, p: pStar }, gamma) : NaN
  const sR =
    pStar > wR.p
      ? wR.u + aR * Math.sqrt(((gamma + 1) / (2 * gamma)) * (pStar / wR.p) + (gamma - 1) / (2 * gamma))
      : NaN
  const sHR = pStar <= wR.p ? wR.u + aR : NaN
  const sTR = pStar <= wR.p ? uStar + soundSpeed({ rho: rhoStarR, u: uStar, p: pStar }, gamma) : NaN

  for (let i = 0; i < n; i++) {
    const s = (opts.x[i]! - x0) / t
    if (s <= uStar) {
      // left of contact
      if (pStar > wL.p) {
        // left shock
        if (s <= sL) { rho[i] = wL.rho; u[i] = wL.u; p[i] = wL.p }
        else { rho[i] = rhoStarL; u[i] = uStar; p[i] = pStar }
      } else {
        // left rarefaction fan
        if (s <= sHL) { rho[i] = wL.rho; u[i] = wL.u; p[i] = wL.p }
        else if (s >= sTL) { rho[i] = rhoStarL; u[i] = uStar; p[i] = pStar }
        else {
          const uFan = (2 / (gamma + 1)) * (aL + ((gamma - 1) / 2) * wL.u + s)
          const aFan = (2 / (gamma + 1)) * (aL + ((gamma - 1) / 2) * (wL.u - s))
          rho[i] = wL.rho * (aFan / aL) ** (2 / (gamma - 1))
          u[i] = uFan
          p[i] = wL.p * (aFan / aL) ** ((2 * gamma) / (gamma - 1))
        }
      }
    } else {
      // right of contact
      if (pStar > wR.p) {
        if (s >= sR) { rho[i] = wR.rho; u[i] = wR.u; p[i] = wR.p }
        else { rho[i] = rhoStarR; u[i] = uStar; p[i] = pStar }
      } else {
        if (s >= sHR) { rho[i] = wR.rho; u[i] = wR.u; p[i] = wR.p }
        else if (s <= sTR) { rho[i] = rhoStarR; u[i] = uStar; p[i] = pStar }
        else {
          const uFan = (2 / (gamma + 1)) * (-aR + ((gamma - 1) / 2) * wR.u + s)
          const aFan = (2 / (gamma + 1)) * (aR - ((gamma - 1) / 2) * (wR.u - s))
          rho[i] = wR.rho * (aFan / aR) ** (2 / (gamma - 1))
          u[i] = uFan
          p[i] = wR.p * (aFan / aR) ** ((2 * gamma) / (gamma - 1))
        }
      }
    }
  }
  return { rho, u, p }
}
