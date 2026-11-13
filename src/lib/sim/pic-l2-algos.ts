/**
 * 粒子网格 PIC 二级算法 · 1D CIC 沉积 / 泊松求 E / 场聚集 / 粒子推进。
 * method id 仅常量，不改 methods.data。
 */

/** 父族（与 methods.data 中 method-particle-in-cell 对齐）。 */
export const PIC_L2_PARENT = 'method-particle-in-cell'

/** 一级 · CIC 沉积/聚集。 */
export const PIC_L2_CIC_ID = 'method-algo-pic-cic'

/**
 * 二级 · 粒子推进（洛伦兹/静电力推）（仅常量，不写 methods.data）。
 */
export const PIC_L2_PUSH_ID = 'method-algo-pic-push'

export const PIC_L2_METHOD_IDS = [PIC_L2_CIC_ID, PIC_L2_PUSH_ID] as const

/**
 * CIC 沉积：粒子电荷 q 按云-in-cell 权重分配到周期网格。
 * 就地写入 rho（先清零）。
 */
export function cicDeposit(
  pos: ArrayLike<number>,
  charge: ArrayLike<number>,
  rho: Float64Array,
  dx: number,
): void {
  rho.fill(0)
  const Ng = rho.length
  for (let p = 0; p < pos.length; p++) {
    const xi = pos[p]! / dx
    let i = Math.floor(xi)
    const frac = xi - i
    i = ((i % Ng) + Ng) % Ng
    const i1 = (i + 1) % Ng
    rho[i]! += charge[p]! * (1 - frac)
    rho[i1]! += charge[p]! * frac
  }
}

/**
 * 周期 1D 泊松 → 电场 E：
 * dE/dx = ρ − ⟨ρ⟩（可解性/准中性），再去直流使 ⟨E⟩=0。
 * 返回格点 E（与 ρ 同长）。
 */
export function poissonPeriodic1d(rho: Float64Array, dx: number): Float64Array {
  const n = rho.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += rho[i]!
  mean /= n
  const E = new Float64Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += (rho[i]! - mean) * dx
    E[i] = acc
  }
  let eMean = 0
  for (let i = 0; i < n; i++) eMean += E[i]!
  eMean /= n
  for (let i = 0; i < n; i++) E[i]! -= eMean
  return E
}

/**
 * Dirichlet 1D 泊松 −φ″=ρ，φ(0)=φ(L)=0，中心差分 + Thomas。
 * 返回格点 E ≈ −dφ/dx（中心差分，端点前/后向）。
 */
export function poissonDirichlet1d(rho: Float64Array, dx: number): {
  phi: Float64Array
  E: Float64Array
} {
  const n = rho.length
  // 内部节点 1..n-2（若 n<3 退化为零场）
  if (n < 3) {
    return { phi: new Float64Array(n), E: new Float64Array(n) }
  }
  const m = n - 2
  const a = new Float64Array(m)
  const b = new Float64Array(m)
  const c = new Float64Array(m)
  const d = new Float64Array(m)
  const invDx2 = 1 / (dx * dx)
  for (let k = 0; k < m; k++) {
    // (−φ_{i−1} + 2φ_i − φ_{i+1})/dx² = ρ_i
    a[k] = -invDx2
    b[k] = 2 * invDx2
    c[k] = -invDx2
    d[k] = rho[k + 1]!
  }
  a[0] = 0
  c[m - 1] = 0
  // Thomas
  const cp = new Float64Array(m)
  const dp = new Float64Array(m)
  let denom = b[0]!
  cp[0] = c[0]! / denom
  dp[0] = d[0]! / denom
  for (let i = 1; i < m; i++) {
    denom = b[i]! - a[i]! * cp[i - 1]!
    cp[i] = i < m - 1 ? c[i]! / denom : 0
    dp[i] = (d[i]! - a[i]! * dp[i - 1]!) / denom
  }
  const interior = new Float64Array(m)
  interior[m - 1] = dp[m - 1]!
  for (let i = m - 2; i >= 0; i--) interior[i] = dp[i]! - cp[i]! * interior[i + 1]!

  const phi = new Float64Array(n)
  for (let k = 0; k < m; k++) phi[k + 1] = interior[k]!

  const E = new Float64Array(n)
  E[0] = -(phi[1]! - phi[0]!) / dx
  E[n - 1] = -(phi[n - 1]! - phi[n - 2]!) / dx
  for (let i = 1; i < n - 1; i++) {
    E[i] = -(phi[i + 1]! - phi[i - 1]!) / (2 * dx)
  }
  return { phi, E }
}

/** CIC gather：格点 E → 粒子位置（周期）。 */
export function cicGather(pos: ArrayLike<number>, E: Float64Array, dx: number): Float64Array {
  const Ng = E.length
  const out = new Float64Array(pos.length)
  for (let p = 0; p < pos.length; p++) {
    const xi = pos[p]! / dx
    let i = Math.floor(xi)
    const frac = xi - i
    i = ((i % Ng) + Ng) % Ng
    const i1 = (i + 1) % Ng
    out[p] = E[i]! * (1 - frac) + E[i1]! * frac
  }
  return out
}

/**
 * 静电粒子推进（周期盒 [0,L)）：
 * a = (q/m) E，v ← v + a dt，x ← x + v dt。
 * 就地更新 pos/vel。
 */
export function pushParticles(
  pos: Float64Array,
  vel: Float64Array,
  Epart: ArrayLike<number>,
  qOverM: ArrayLike<number>,
  dt: number,
  L: number,
): void {
  for (let p = 0; p < pos.length; p++) {
    const a = qOverM[p]! * Epart[p]!
    vel[p]! += a * dt
    let x = pos[p]! + vel[p]! * dt
    // 周期 wrap
    x = ((x % L) + L) % L
    pos[p] = x
  }
}

/** 总电荷 Σ q_p。 */
export function totalCharge(charge: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < charge.length; i++) s += charge[i]!
  return s
}

/** 网格电荷总和 Σ ρ_i（CIC 后应 = Σ q_p）。 */
export function gridChargeSum(rho: Float64Array): number {
  let s = 0
  for (let i = 0; i < rho.length; i++) s += rho[i]!
  return s
}

/**
 * CIC 沉积/聚集样例：均匀正电荷云，总电荷守恒，场有限。
 * methodId → method-algo-pic-cic。
 */
export function runPicCicSample(Ng = 32, Np = 8): {
  Qparticles: number
  Qgrid: number
  chargeErr: number
  eFieldNorm: number
  methodId: typeof PIC_L2_CIC_ID
} {
  const L = 1
  const dx = L / Ng
  const pos = new Float64Array(Np)
  const q = new Float64Array(Np)
  for (let p = 0; p < Np; p++) {
    pos[p] = ((p + 0.5) / Np) * L
    q[p] = 1 / Np
  }
  const rho = new Float64Array(Ng)
  cicDeposit(pos, q, rho, dx)
  const Qparticles = totalCharge(q)
  const Qgrid = gridChargeSum(rho)
  const E = poissonPeriodic1d(rho, dx)
  const Ep = cicGather(pos, E, dx)
  let eFieldNorm = 0
  for (let p = 0; p < Np; p++) eFieldNorm += Ep[p]! * Ep[p]!
  eFieldNorm = Math.sqrt(eFieldNorm)
  return {
    Qparticles,
    Qgrid,
    chargeErr: Math.abs(Qgrid - Qparticles),
    eFieldNorm,
    methodId: PIC_L2_CIC_ID,
  }
}

/**
 * 粒子推进样例：
 * - attract：固定负电荷背景 + 正试验粒子，粒子应向异号电荷移动；
 * - free：E=0 时匀速自由漂移。
 * methodId → method-algo-pic-push。
 */
export function runPicPushSample(
  mode: 'attract' | 'free' = 'attract',
  steps = 40,
  dt = 0.02,
): {
  mode: 'attract' | 'free'
  x0: number
  xF: number
  /** attract：相对固定负电荷距离减小；free：位移≈v0·steps·dt */
  movedToward: boolean
  freeStreamOk: boolean
  chargeErr: number
  methodId: typeof PIC_L2_PUSH_ID
} {
  const Ng = 64
  const L = 1
  const dx = L / Ng

  if (mode === 'free') {
    const pos = new Float64Array([0.2])
    const vel = new Float64Array([0.5])
    const qom = new Float64Array([1])
    const x0 = pos[0]!
    const v0 = vel[0]!
    for (let s = 0; s < steps; s++) {
      // 零场自由流
      pushParticles(pos, vel, [0], qom, dt, L)
    }
    const expected = ((x0 + v0 * steps * dt) % L + L) % L
    const xF = pos[0]!
    const freeStreamOk = Math.abs(xF - expected) < 1e-9
    return {
      mode,
      x0,
      xF,
      movedToward: freeStreamOk,
      freeStreamOk,
      chargeErr: 0,
      methodId: PIC_L2_PUSH_ID,
    }
  }

  // attract：固定背景负电荷在 x=0.7，正试验粒子在 x=0.3，自洽 CIC+泊松+推进
  const xFixed = 0.7
  const qFixed = -1
  const pos = new Float64Array([0.3])
  const vel = new Float64Array([0])
  const qTest = 1
  const qom = new Float64Array([1]) // q/m
  const x0 = pos[0]!
  const dist0 = Math.min(Math.abs(x0 - xFixed), L - Math.abs(x0 - xFixed))

  let chargeErr = 0
  for (let s = 0; s < steps; s++) {
    const rho = new Float64Array(Ng)
    // 沉积：试验粒子 + 固定异号电荷
    cicDeposit(
      [pos[0]!, xFixed],
      [qTest, qFixed],
      rho,
      dx,
    )
    const Qp = qTest + qFixed
    const Qg = gridChargeSum(rho)
    chargeErr = Math.max(chargeErr, Math.abs(Qg - Qp))
    const E = poissonPeriodic1d(rho, dx)
    const Ep = cicGather(pos, E, dx)
    pushParticles(pos, vel, Ep, qom, dt, L)
  }

  const xF = pos[0]!
  const distF = Math.min(Math.abs(xF - xFixed), L - Math.abs(xF - xFixed))
  // 正粒子应被负电荷吸引，距离减小；或至少越过中点向右移动
  const movedToward = distF < dist0 - 1e-4 || (xF > x0 && xF < xFixed)

  return {
    mode,
    x0,
    xF,
    movedToward,
    freeStreamOk: true,
    chargeErr,
    methodId: PIC_L2_PUSH_ID,
  }
}
