/**
 * DEM 二级 · 库仑切向摩擦（Coulomb |F_t| ≤ μ |F_n|）与 stick–slip 玩具。
 * 父族 METHOD_DEM；子算法仅常量，不改 catalog / registry / edges。
 */
import {
  METHOD_DEM,
  linearSpringDashpot1d,
  type DemParticle1d,
} from './dem-algos'

export { METHOD_DEM }

/** 二级 · 库仑切向摩擦。 */
export const METHOD_ALGO_DEM_COULOMB = 'method-algo-dem-coulomb'

export const DEM_L2_METHOD_IDS = [METHOD_ALGO_DEM_COULOMB] as const

export const DEM_L2_PARENT = METHOD_DEM

/**
 * 库仑摩擦投影：|F_t| ≤ μ |F_n|。
 * Fn 取压缩为正（接触载荷）；分离或 Fn≤0 时 Ft=0。
 * |FtTrial| ≤ μ Fn → stick（保留试探力）；否则 slip 截断到 μ Fn。
 */
export function coulombFriction(
  FtTrial: number,
  Fn: number,
  mu: number,
): { Ft: number; stick: boolean; limit: number } {
  const muClamped = Math.max(0, mu)
  const FnPos = Fn > 0 ? Fn : 0
  const limit = muClamped * FnPos
  if (limit <= 0 || !Number.isFinite(FtTrial)) {
    return { Ft: 0, stick: false, limit: 0 }
  }
  const a = Math.abs(FtTrial)
  if (a <= limit) {
    return { Ft: FtTrial, stick: true, limit }
  }
  return { Ft: Math.sign(FtTrial) * limit, stick: false, limit }
}

/**
 * 切向弹簧试探力：F_t^trial = −k_t u_t − γ_t v_t
 * （u_t 切向重叠/滑移累积，v_t 相对切向速度）。
 */
export function tangentialTrialForce(
  ut: number,
  vt: number,
  kt: number,
  gammaT = 0,
): number {
  return -kt * ut - gammaT * vt
}

/**
 * 2D 接触：法向 n、切向 t=⊥n，将相对速度分解。
 * n 从 j→i；t = (−ny, nx)（逆时针 90°）。
 */
export function decomposeContact2d(
  pi: { x: number; y: number },
  pj: { x: number; y: number },
  vi: { x: number; y: number },
  vj: { x: number; y: number },
): {
  dist: number
  nx: number
  ny: number
  tx: number
  ty: number
  vn: number
  vt: number
  active: boolean
} {
  const dx = pi.x - pj.x
  const dy = pi.y - pj.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-30) {
    return {
      dist: 0,
      nx: 1,
      ny: 0,
      tx: 0,
      ty: 1,
      vn: 0,
      vt: 0,
      active: false,
    }
  }
  const nx = dx / dist
  const ny = dy / dist
  const tx = -ny
  const ty = nx
  const dvx = vi.x - vj.x
  const dvy = vi.y - vj.y
  return {
    dist,
    nx,
    ny,
    tx,
    ty,
    vn: dvx * nx + dvy * ny,
    vt: dvx * tx + dvy * ty,
    active: true,
  }
}

/**
 * 法向线性弹簧-阻尼 + 库仑切向（2D 双粒子）。
 * 返回作用在 i 上的力；j 受反力。
 * ut 为累积切向滑移（就地可更新：stick 时 ut 由弹簧，slip 时重置/滑动）。
 */
export function demContactCoulomb2d(
  pi: { x: number; y: number },
  pj: { x: number; y: number },
  vi: { x: number; y: number },
  vj: { x: number; y: number },
  Ri: number,
  Rj: number,
  kn: number,
  gammaN: number,
  kt: number,
  gammaT: number,
  mu: number,
  ut: number,
  dt: number,
): {
  Fi: { x: number; y: number }
  Fn: number
  Ft: number
  delta: number
  utNew: number
  stick: boolean
  active: boolean
} {
  const dec = decomposeContact2d(pi, pj, vi, vj)
  const delta = Ri + Rj - dec.dist
  if (!(delta > 0) || !dec.active) {
    return {
      Fi: { x: 0, y: 0 },
      Fn: 0,
      Ft: 0,
      delta,
      utNew: 0,
      stick: false,
      active: false,
    }
  }
  // 法向：压缩为正 Fn = k δ − γ vn（vn 分离为正 → 阻尼减小压缩）
  const FnRaw = kn * delta - gammaN * dec.vn
  const Fn = Math.max(0, FnRaw) // 库仑用压缩载荷
  // 切向试探：先预测滑移 ut + vt dt
  const utPred = ut + dec.vt * dt
  const FtTrial = tangentialTrialForce(utPred, dec.vt, kt, gammaT)
  const { Ft, stick } = coulombFriction(FtTrial, Fn, mu)
  // stick：接受 utPred；slip：将 ut 拉回 |kt ut| = limit（无阻尼近似）
  let utNew: number
  if (stick) {
    utNew = utPred
  } else if (kt > 1e-30) {
    utNew = -Ft / kt
  } else {
    utNew = 0
  }
  // 力：法向排斥沿 n（FnRaw 可含阻尼，方向 n 从 j→i 时 Fi_n = +FnRaw * n 排斥）
  // 与 dem-algos 一致：Fi = (kδ − γ vn) n
  const FnSigned = kn * delta - gammaN * dec.vn
  return {
    Fi: {
      x: FnSigned * dec.nx + Ft * dec.tx,
      y: FnSigned * dec.ny + Ft * dec.ty,
    },
    Fn,
    Ft,
    delta,
    utNew,
    stick,
    active: true,
  }
}

/**
 * 粒子–墙 stick–slip 玩具（1D 切向）：
 * 墙 y=0，法向固定载荷 Fn（或由重叠给出），粒子沿 x 被驱动弹簧拉。
 * 驱动：F_drive = k_drive (v_drive t − x)
 * 摩擦：|F_t| ≤ μ Fn；静摩擦 stick 时 v=0、x 锁定直至 |F_drive| > μ Fn。
 *
 * 简化动力学（过阻尼/准静）：
 * - stick：x 不动，直到 |k_drive (x_drive − x)| > μ Fn → 进入 slip
 * - slip：F_t = −μ Fn sign(v)，a = (F_drive + F_t)/m
 */
export type StickSlipState = {
  x: number
  v: number
  t: number
  stick: boolean
  /** 最近一次滑移峰值 |F_drive| */
  lastSlipDrive: number
}

export function stickSlipStep(opts: {
  state: StickSlipState
  Fn: number
  mu: number
  kDrive: number
  vDrive: number
  m: number
  dt: number
  /** 动摩擦可 ≤ 静摩擦；默认 = mu */
  muKinetic?: number
}): StickSlipState {
  const { Fn, mu, kDrive, vDrive, m, dt } = opts
  const muK = opts.muKinetic ?? mu
  let { x, v, t, stick, lastSlipDrive } = opts.state
  t += dt
  const xDrive = vDrive * t
  const Fdrive = kDrive * (xDrive - x)
  const Fstatic = mu * Math.max(Fn, 0)
  const Fkinetic = muK * Math.max(Fn, 0)

  if (stick) {
    if (Math.abs(Fdrive) > Fstatic + 1e-15) {
      // 开始滑移：动摩擦阻力与驱动方向相反
      stick = false
      lastSlipDrive = Math.abs(Fdrive)
      const sign = Math.sign(Fdrive) || 1
      const Fnet = Fdrive - sign * Fkinetic
      v = v + (Fnet / m) * dt
      x = x + v * dt
    } else {
      v = 0
    }
  } else {
    // slip
    if (Math.abs(v) < 1e-10 && Math.abs(Fdrive) <= Fstatic) {
      stick = true
      v = 0
    } else {
      const sgn = v === 0 ? Math.sign(Fdrive) || 1 : Math.sign(v)
      const Fnet = Fdrive - sgn * Fkinetic
      v = v + (Fnet / m) * dt
      // 速度反向且驱动不足 → 可能粘住（下一步）
      if (v * (v - (Fnet / m) * dt) < 0 && Math.abs(Fdrive) <= Fstatic) {
        v = 0
        stick = true
      }
      x = x + v * dt
    }
  }

  return { x, v, t, stick, lastSlipDrive }
}

/**
 * 积分 stick–slip 若干步，统计 stick/slip 切换与力上限。
 */
export function stickSlipIntegrate(opts: {
  Fn?: number
  mu?: number
  kDrive?: number
  vDrive?: number
  m?: number
  dt?: number
  steps?: number
  x0?: number
}): {
  final: StickSlipState
  maxAbsDrive: number
  maxAbsFt: number
  slipEvents: number
  stickFraction: number
  finite: boolean
} {
  const Fn = opts.Fn ?? 1
  const mu = opts.mu ?? 0.4
  const kDrive = opts.kDrive ?? 20
  const vDrive = opts.vDrive ?? 0.05
  const m = opts.m ?? 1
  const dt = opts.dt ?? 1e-3
  const steps = opts.steps ?? 8000
  let st: StickSlipState = {
    x: opts.x0 ?? 0,
    v: 0,
    t: 0,
    stick: true,
    lastSlipDrive: 0,
  }
  let maxAbsDrive = 0
  let maxAbsFt = 0
  let slipEvents = 0
  let stickCount = 0
  let wasStick = true
  const Fstatic = mu * Fn
  const Fkinetic = mu * Fn

  for (let s = 0; s < steps; s++) {
    const xDrive = vDrive * (st.t + dt)
    const Fdrive = kDrive * (xDrive - st.x)
    maxAbsDrive = Math.max(maxAbsDrive, Math.abs(Fdrive))
    const FtEff = st.stick
      ? Math.min(Math.abs(Fdrive), Fstatic)
      : Fkinetic
    maxAbsFt = Math.max(maxAbsFt, FtEff)

    st = stickSlipStep({
      state: st,
      Fn,
      mu,
      kDrive,
      vDrive,
      m,
      dt,
    })
    if (st.stick) stickCount++
    if (wasStick && !st.stick) slipEvents++
    wasStick = st.stick
  }

  const finite =
    Number.isFinite(st.x) &&
    Number.isFinite(st.v) &&
    Number.isFinite(maxAbsDrive)

  return {
    final: st,
    maxAbsDrive,
    maxAbsFt,
    slipEvents,
    stickFraction: stickCount / Math.max(steps, 1),
    finite,
  }
}

/**
 * 双粒子 1D 法向 + 侧向库仑玩具：
 * 对心法向用 linearSpringDashpot1d；「切向」用独立坐标 y 上的弹簧+库仑。
 * 粒子约束在接触中（固定重叠近似）时检验 |Ft|≤μ|Fn|。
 */
export function demPairTangentialStep(
  a: DemParticle1d & { y: number; vy: number },
  b: DemParticle1d & { y: number; vy: number },
  kn: number,
  gammaN: number,
  kt: number,
  mu: number,
  ut: number,
  dt: number,
): {
  a: DemParticle1d & { y: number; vy: number }
  b: DemParticle1d & { y: number; vy: number }
  Fn: number
  Ft: number
  utNew: number
  stick: boolean
  active: boolean
} {
  const n = linearSpringDashpot1d(a.x, b.x, a.v, b.v, a.r, b.r, kn, gammaN)
  const Fn = n.active ? Math.abs(n.Fi) : 0
  const vt = a.vy - b.vy
  const utPred = ut + vt * dt
  const FtTrial = tangentialTrialForce(utPred, vt, kt, 0)
  const { Ft, stick } = coulombFriction(FtTrial, Fn, mu)
  const utNew = stick ? utPred : kt > 1e-30 ? -Ft / kt : 0

  if (!n.active) {
    return {
      a: { ...a },
      b: { ...b },
      Fn: 0,
      Ft: 0,
      utNew: 0,
      stick: false,
      active: false,
    }
  }

  const ax = n.Fi / a.m
  const bx = -n.Fi / b.m
  const ay = Ft / a.m
  const by = -Ft / b.m
  const va = a.v + ax * dt
  const vb = b.v + bx * dt
  const vya = a.vy + ay * dt
  const vyb = b.vy + by * dt
  return {
    a: {
      ...a,
      v: va,
      x: a.x + va * dt,
      vy: vya,
      y: a.y + vya * dt,
    },
    b: {
      ...b,
      v: vb,
      x: b.x + vb * dt,
      vy: vyb,
      y: b.y + vyb * dt,
    },
    Fn,
    Ft,
    utNew,
    stick,
    active: true,
  }
}

/**
 * 库仑摩擦样例：
 * 1) 投影律：|Ft|≤μ|Fn|，stick/slip 分支
 * 2) stick–slip 驱动：出现滑移事件且 max|Ft| 不超过 μ Fn（松）
 * 3) 双粒子切向：接触中 |Ft|≤μ|Fn|
 */
export function runDemCoulombSample(opts?: {
  mu?: number
  Fn?: number
  steps?: number
}): {
  mu: number
  Fn: number
  limit: number
  stickFt: number
  slipFt: number
  stickOk: boolean
  slipOk: boolean
  slipEvents: number
  maxAbsFt: number
  pairMaxRatio: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DEM_COULOMB
  familyId: typeof METHOD_DEM
} {
  const mu = opts?.mu ?? 0.35
  const Fn = opts?.Fn ?? 2
  const steps = opts?.steps ?? 6000
  const limit = mu * Fn

  // 投影单元测试内嵌
  const stickCase = coulombFriction(0.5 * limit, Fn, mu)
  const slipCase = coulombFriction(3 * limit, Fn, mu)
  const stickOk = stickCase.stick && Math.abs(stickCase.Ft - 0.5 * limit) < 1e-12
  const slipOk =
    !slipCase.stick && Math.abs(Math.abs(slipCase.Ft) - limit) < 1e-12

  const ss = stickSlipIntegrate({
    Fn,
    mu,
    kDrive: 25,
    vDrive: 0.04,
    m: 1,
    dt: 8e-4,
    steps,
  })

  // 双粒子：重叠接触 + 相对切向速度
  let a = { x: 0, v: 0, r: 0.5, m: 1, y: 0, vy: 0.3 }
  let b = { x: 0.9, v: 0, r: 0.5, m: 1, y: 0, vy: -0.1 }
  let ut = 0
  let pairMaxRatio = 0
  let pairFinite = true
  for (let s = 0; s < 400; s++) {
    const r = demPairTangentialStep(a, b, 200, 0.5, 50, mu, ut, 5e-4)
    a = r.a
    b = r.b
    ut = r.utNew
    if (r.active && r.Fn > 1e-12) {
      pairMaxRatio = Math.max(pairMaxRatio, Math.abs(r.Ft) / r.Fn)
    }
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) pairFinite = false
  }

  const finite = ss.finite && pairFinite && stickOk
  // 松：滑移曾发生；摩擦不超过 μFn * 1.05；双粒子比 ≤ μ+eps
  const ok =
    finite &&
    stickOk &&
    slipOk &&
    ss.slipEvents >= 1 &&
    ss.maxAbsFt <= limit * 1.05 + 1e-9 &&
    pairMaxRatio <= mu + 0.05

  return {
    mu,
    Fn,
    limit,
    stickFt: stickCase.Ft,
    slipFt: slipCase.Ft,
    stickOk,
    slipOk,
    slipEvents: ss.slipEvents,
    maxAbsFt: ss.maxAbsFt,
    pairMaxRatio,
    finite,
    ok,
    methodId: METHOD_ALGO_DEM_COULOMB,
    familyId: METHOD_DEM,
  }
}
