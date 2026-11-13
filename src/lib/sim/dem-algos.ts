/**
 * 离散元 DEM · 法向接触力纯算法（线性弹簧-阻尼 + 简化 Hertz）。
 * 双粒子对心碰撞：半隐式 Euler；γ>0 耗散，γ=0 近似弹性（小 dt）。
 * method id 仅常量，不改 methods.data / moduleRegistry / edges / dependencies。
 */

/** 父族 · 离散元 DEM。 */
export const METHOD_DEM = 'method-dem'

/** 子算法 · 简化 Hertz 法向（∝ δ^{3/2}）。 */
export const METHOD_ALGO_DEM_HERTZ = 'method-algo-dem-hertz'

/** 子算法 · 线性弹簧-阻尼法向。 */
export const METHOD_ALGO_DEM_LINEAR_SPRING = 'method-algo-dem-linear-spring'

export const DEM_METHOD_IDS = [
  METHOD_ALGO_DEM_LINEAR_SPRING,
  METHOD_ALGO_DEM_HERTZ,
] as const

export type Vec2 = { x: number; y: number }

/** 1D 对心碰撞粒子（半径 r、质量 m）。 */
export type DemParticle1d = {
  x: number
  v: number
  r: number
  m: number
}

/**
 * 重叠量 δ = R_i + R_j − |x_i − x_j|（>0 接触，≤0 分离）。
 */
export function contactOverlap(
  xi: number,
  xj: number,
  Ri: number,
  Rj: number,
): number {
  return Ri + Rj - Math.abs(xi - xj)
}

/**
 * 2D 重叠：δ = R_i + R_j − |x_i − x_j|。
 */
export function contactOverlap2d(
  pi: Vec2,
  pj: Vec2,
  Ri: number,
  Rj: number,
): number {
  return Ri + Rj - Math.hypot(pi.x - pj.x, pi.y - pj.y)
}

/**
 * 线性弹簧-阻尼法向接触（1D 标量力作用在 i 上，j 受反力）。
 *
 * n 指向：从 j → i（sign(x_i − x_j)）。
 * δ = R_i+R_j − |x_i−x_j|
 * v_n = (v_i − v_j) · n   （分离为正）
 * 若 δ > 0：F_i = (k δ − γ v_n) n，否则 0。
 */
export function linearSpringDashpot1d(
  xi: number,
  xj: number,
  vi: number,
  vj: number,
  Ri: number,
  Rj: number,
  k: number,
  gamma: number,
): { Fi: number; delta: number; vn: number; active: boolean } {
  const dx = xi - xj
  const dist = Math.abs(dx)
  const delta = Ri + Rj - dist
  if (!(delta > 0) || dist < 1e-30) {
    return { Fi: 0, delta, vn: 0, active: false }
  }
  const n = dx / dist
  const vn = (vi - vj) * n
  const Fi = (k * delta - gamma * vn) * n
  return { Fi, delta, vn, active: true }
}

/**
 * 线性弹簧-阻尼法向接触（2D 力向量作用在 i 上）。
 * F_n 沿 n=(x_i−x_j)/|·|：F_i = (k δ − γ v_n) n。
 */
export function linearSpringDashpot2d(
  pi: Vec2,
  pj: Vec2,
  vi: Vec2,
  vj: Vec2,
  Ri: number,
  Rj: number,
  k: number,
  gamma: number,
): { Fi: Vec2; delta: number; vn: number; active: boolean } {
  const dx = pi.x - pj.x
  const dy = pi.y - pj.y
  const dist = Math.hypot(dx, dy)
  const delta = Ri + Rj - dist
  if (!(delta > 0) || dist < 1e-30) {
    return { Fi: { x: 0, y: 0 }, delta, vn: 0, active: false }
  }
  const nx = dx / dist
  const ny = dy / dist
  const vn = (vi.x - vj.x) * nx + (vi.y - vj.y) * ny
  const mag = k * delta - gamma * vn
  return {
    Fi: { x: mag * nx, y: mag * ny },
    delta,
    vn,
    active: true,
  }
}

/**
 * 简化 Hertz 法向（无切向）：δ>0 时 |F| = k_h δ^{1.5}，沿 n 排斥；否则 0。
 * 1D：返回作用在 i 上的标量力。
 */
export function hertzNormal1d(
  xi: number,
  xj: number,
  Ri: number,
  Rj: number,
  kh: number,
): { Fi: number; delta: number; active: boolean } {
  const dx = xi - xj
  const dist = Math.abs(dx)
  const delta = Ri + Rj - dist
  if (!(delta > 0) || dist < 1e-30) {
    return { Fi: 0, delta, active: false }
  }
  const n = dx / dist
  const Fi = kh * Math.pow(delta, 1.5) * n
  return { Fi, delta, active: true }
}

/**
 * 简化 Hertz 法向（2D）。
 */
export function hertzNormal2d(
  pi: Vec2,
  pj: Vec2,
  Ri: number,
  Rj: number,
  kh: number,
): { Fi: Vec2; delta: number; active: boolean } {
  const dx = pi.x - pj.x
  const dy = pi.y - pj.y
  const dist = Math.hypot(dx, dy)
  const delta = Ri + Rj - dist
  if (!(delta > 0) || dist < 1e-30) {
    return { Fi: { x: 0, y: 0 }, delta, active: false }
  }
  const mag = kh * Math.pow(delta, 1.5)
  const inv = 1 / dist
  return {
    Fi: { x: mag * dx * inv, y: mag * dy * inv },
    delta,
    active: true,
  }
}

/** 线性弹簧接触势能 ½ k δ²（δ>0）。 */
export function linearSpringPotential(delta: number, k: number): number {
  return delta > 0 ? 0.5 * k * delta * delta : 0
}

/** 简化 Hertz 势能 (2/5) k_h δ^{5/2}（δ>0；F=k_h δ^{3/2}）。 */
export function hertzPotential(delta: number, kh: number): number {
  return delta > 0 ? (2 / 5) * kh * Math.pow(delta, 2.5) : 0
}

/** 1D 动能 ½ m v²。 */
export function kinetic1d(p: DemParticle1d): number {
  return 0.5 * p.m * p.v * p.v
}

/**
 * 双粒子 1D 对心一步：线性弹簧-阻尼 + 半隐式 Euler。
 * v ← v + a dt；x ← x + v dt（用新速度）。
 */
export function demHeadOnStepLinear(
  a: DemParticle1d,
  b: DemParticle1d,
  k: number,
  gamma: number,
  dt: number,
): { a: DemParticle1d; b: DemParticle1d; delta: number; active: boolean } {
  const { Fi, delta, active } = linearSpringDashpot1d(
    a.x,
    b.x,
    a.v,
    b.v,
    a.r,
    b.r,
    k,
    gamma,
  )
  const ai = active ? Fi / a.m : 0
  const bi = active ? -Fi / b.m : 0
  const va = a.v + ai * dt
  const vb = b.v + bi * dt
  return {
    a: { ...a, v: va, x: a.x + va * dt },
    b: { ...b, v: vb, x: b.x + vb * dt },
    delta,
    active,
  }
}

/**
 * 双粒子 1D 对心一步：简化 Hertz + 半隐式 Euler。
 */
export function demHeadOnStepHertz(
  a: DemParticle1d,
  b: DemParticle1d,
  kh: number,
  dt: number,
): { a: DemParticle1d; b: DemParticle1d; delta: number; active: boolean } {
  const { Fi, delta, active } = hertzNormal1d(a.x, b.x, a.r, b.r, kh)
  const ai = active ? Fi / a.m : 0
  const bi = active ? -Fi / b.m : 0
  const va = a.v + ai * dt
  const vb = b.v + bi * dt
  return {
    a: { ...a, v: va, x: a.x + va * dt },
    b: { ...b, v: vb, x: b.x + vb * dt },
    delta,
    active,
  }
}

/**
 * 积分对心碰撞若干步，返回初/末动能与最大重叠。
 */
export function demHeadOnIntegrateLinear(
  a0: DemParticle1d,
  b0: DemParticle1d,
  k: number,
  gamma: number,
  dt: number,
  steps: number,
): {
  a: DemParticle1d
  b: DemParticle1d
  ke0: number
  keF: number
  pe0: number
  peF: number
  e0: number
  eF: number
  maxDelta: number
  finite: boolean
} {
  let a = { ...a0 }
  let b = { ...b0 }
  const d0 = contactOverlap(a.x, b.x, a.r, b.r)
  const ke0 = kinetic1d(a) + kinetic1d(b)
  const pe0 = linearSpringPotential(d0, k)
  const e0 = ke0 + pe0
  let maxDelta = Math.max(0, d0)

  for (let s = 0; s < steps; s++) {
    const r = demHeadOnStepLinear(a, b, k, gamma, dt)
    a = r.a
    b = r.b
    if (r.delta > maxDelta) maxDelta = r.delta
  }

  const dF = contactOverlap(a.x, b.x, a.r, b.r)
  const keF = kinetic1d(a) + kinetic1d(b)
  const peF = linearSpringPotential(dF, k)
  const eF = keF + peF
  const finite =
    Number.isFinite(a.x) &&
    Number.isFinite(a.v) &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.v) &&
    Number.isFinite(eF)

  return { a, b, ke0, keF, pe0, peF, e0, eF, maxDelta, finite }
}

/**
 * 线性弹簧-阻尼样例：对心碰撞。
 * - γ=0：总机械能近似守恒（小 dt）
 * - γ>0：机械能下降
 * ok：有限 + 发生过接触 + 弹性/耗散行为符合预期
 */
export function runDemLinearSpringSample(opts?: {
  k?: number
  gamma?: number
  dt?: number
  steps?: number
  /** 若给出则跑阻尼对照并要求 eF_damped < eF_elastic */
  gammaDamp?: number
}): {
  ke0: number
  keF: number
  e0: number
  eF: number
  eRelErr: number
  maxDelta: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DEM_LINEAR_SPRING
  familyId: typeof METHOD_DEM
} {
  const k = opts?.k ?? 200
  const gamma = opts?.gamma ?? 0
  const dt = opts?.dt ?? 2e-4
  const steps = opts?.steps ?? 10_000
  const gammaDamp = opts?.gammaDamp ?? 2

  // 等质量对心：初始分开、相向运动
  const a0: DemParticle1d = { x: 0, v: 0.5, r: 0.5, m: 1 }
  const b0: DemParticle1d = { x: 1.2, v: -0.5, r: 0.5, m: 1 }

  const elastic = demHeadOnIntegrateLinear(a0, b0, k, gamma, dt, steps)
  const eRelErr =
    Math.abs(elastic.eF - elastic.e0) / Math.max(Math.abs(elastic.e0), 1e-30)

  const damped = demHeadOnIntegrateLinear(a0, b0, k, gammaDamp, dt, steps)
  const dissipates = damped.eF < elastic.eF - 1e-6 && damped.eF < damped.e0

  const ok =
    elastic.finite &&
    damped.finite &&
    elastic.maxDelta > 0 &&
    eRelErr < 0.05 &&
    dissipates

  return {
    ke0: elastic.ke0,
    keF: elastic.keF,
    e0: elastic.e0,
    eF: elastic.eF,
    eRelErr,
    maxDelta: elastic.maxDelta,
    finite: elastic.finite,
    ok,
    methodId: METHOD_ALGO_DEM_LINEAR_SPRING,
    familyId: METHOD_DEM,
  }
}

/**
 * 简化 Hertz 样例：对心碰撞（无阻尼，近似弹性）+ 力随重叠增长。
 */
export function runDemHertzSample(opts?: {
  kh?: number
  dt?: number
  steps?: number
}): {
  ke0: number
  keF: number
  e0: number
  eF: number
  eRelErr: number
  maxDelta: number
  forceSmall: number
  forceLarge: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DEM_HERTZ
  familyId: typeof METHOD_DEM
} {
  const kh = opts?.kh ?? 300
  const dt = opts?.dt ?? 2e-4
  const steps = opts?.steps ?? 10_000

  const a0: DemParticle1d = { x: 0, v: 0.4, r: 0.5, m: 1 }
  const b0: DemParticle1d = { x: 1.15, v: -0.4, r: 0.5, m: 1 }

  let a = { ...a0 }
  let b = { ...b0 }
  const d0 = contactOverlap(a.x, b.x, a.r, b.r)
  const ke0 = kinetic1d(a) + kinetic1d(b)
  const pe0 = hertzPotential(d0, kh)
  const e0 = ke0 + pe0
  let maxDelta = Math.max(0, d0)

  for (let s = 0; s < steps; s++) {
    const r = demHeadOnStepHertz(a, b, kh, dt)
    a = r.a
    b = r.b
    if (r.delta > maxDelta) maxDelta = r.delta
  }

  const dF = contactOverlap(a.x, b.x, a.r, b.r)
  const keF = kinetic1d(a) + kinetic1d(b)
  const peF = hertzPotential(dF, kh)
  const eF = keF + peF
  const eRelErr = Math.abs(eF - e0) / Math.max(Math.abs(e0), 1e-30)
  const finite =
    Number.isFinite(a.x) &&
    Number.isFinite(a.v) &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.v) &&
    Number.isFinite(eF)

  // 力随重叠单调增：δ=0.05 vs 0.1
  const fSmall = hertzNormal1d(0, 0.95, 0.5, 0.5, kh)
  const fLarge = hertzNormal1d(0, 0.9, 0.5, 0.5, kh)
  const forceSmall = Math.abs(fSmall.Fi)
  const forceLarge = Math.abs(fLarge.Fi)

  const ok =
    finite &&
    maxDelta > 0 &&
    eRelErr < 0.08 &&
    forceLarge > forceSmall &&
    forceSmall > 0

  return {
    ke0,
    keF,
    e0,
    eF,
    eRelErr,
    maxDelta,
    forceSmall,
    forceLarge,
    finite,
    ok,
    methodId: METHOD_ALGO_DEM_HERTZ,
    familyId: METHOD_DEM,
  }
}
