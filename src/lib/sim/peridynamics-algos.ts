/**
 * 键基近场动力学（bond-based peridynamics）· 1D 教学 stub。
 * 键伸长 s = (|ξ+η|−|ξ|)/|ξ|；视界 δ；力密度 ~ c·s·μ·e；
 * 可选临界伸长损伤 μ=0 if s>s0。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */

/** 父族 · 近场动力学 peridynamics。 */
export const METHOD_PERIDYNAMICS = 'method-peridynamics'

/** 子算法 · 键力（bond force density）。 */
export const METHOD_ALGO_PD_BOND_FORCE = 'method-algo-pd-bond-force'

/**
 * 子算法 · 键伸长 / 局部膨胀（dilatation）与临界伸长损伤。
 * 1D 教学：θ 取视界内键伸长体积加权均值；损伤 μ(s,s0)。
 */
export const METHOD_ALGO_PD_DILATATION = 'method-algo-pd-dilatation'

export const PD_METHOD_IDS = [
  METHOD_ALGO_PD_BOND_FORCE,
  METHOD_ALGO_PD_DILATATION,
] as const

/** 1D 粒子：参考位 x0、现位 x（位移 u = x − x0）。 */
export type PdParticle1d = {
  x0: number
  x: number
}

/**
 * 参考相对位置 ξ = x0_j − x0_i。
 */
export function restXi(xi0: number, xj0: number): number {
  return xj0 - xi0
}

/**
 * 现位相对位置 ξ+η = x_j − x_i。
 */
export function deformedEtaPlusXi(xi: number, xj: number): number {
  return xj - xi
}

/**
 * 键伸长 s = (|ξ+η| − |ξ|) / |ξ|。
 * |ξ|≤eps 或非有限 → 0。
 */
export function bondStretch(
  xi0: number,
  xj0: number,
  xi: number,
  xj: number,
  eps = 1e-30,
): number {
  const xiRest = restXi(xi0, xj0)
  const absXi = Math.abs(xiRest)
  if (!(absXi > eps) || !Number.isFinite(xiRest)) return 0
  const cur = Math.abs(deformedEtaPlusXi(xi, xj))
  if (!Number.isFinite(cur)) return 0
  return (cur - absXi) / absXi
}

/**
 * 视界内？|ξ| ≤ δ（δ>0）。δ≤0 或 |ξ| 非有限 → false。
 */
export function withinHorizon(
  xi0: number,
  xj0: number,
  delta: number,
): boolean {
  if (!(delta > 0)) return false
  const absXi = Math.abs(restXi(xi0, xj0))
  return Number.isFinite(absXi) && absXi <= delta + 1e-15
}

/**
 * 临界伸长损伤历史无关：μ = 1 if s ≤ s0，else 0。
 * s0≤0 时：s>0 即断（或 s0=0 仅允许压缩侧 μ=1）。
 */
export function criticalStretchMu(s: number, s0: number): number {
  if (!Number.isFinite(s) || !Number.isFinite(s0)) return 0
  return s > s0 ? 0 : 1
}

/**
 * 1D 键力密度（作用在 i 上、来自键 j）：
 *   f_i = c · s · μ · e
 * e = sign(x_j − x_i)（变形键单位方向；共点时 0）。
 *
 * 视界外 |ξ|>δ → 0。
 * μ 缺省 1；可传入 criticalStretchMu(s,s0)。
 *
 * 均匀拉伸 s>0：j 在右时 f_i>0（j 拉 i 向右）。
 */
export function bondForceDensity1d(
  xi0: number,
  xj0: number,
  xi: number,
  xj: number,
  c: number,
  delta: number,
  mu = 1,
): {
  fi: number
  s: number
  mu: number
  active: boolean
  absXi: number
} {
  const xiRest = restXi(xi0, xj0)
  const absXi = Math.abs(xiRest)
  if (!(delta > 0) || !(absXi > 1e-30) || absXi > delta + 1e-15) {
    return { fi: 0, s: 0, mu: 0, active: false, absXi }
  }
  const dx = deformedEtaPlusXi(xi, xj)
  const absCur = Math.abs(dx)
  if (!(absCur > 1e-30) || !Number.isFinite(dx)) {
    return { fi: 0, s: -1, mu: 0, active: false, absXi }
  }
  const s = (absCur - absXi) / absXi
  const m = Number.isFinite(mu) ? mu : 0
  const e = dx / absCur
  const fi = c * s * m * e
  return {
    fi: Number.isFinite(fi) ? fi : 0,
    s,
    mu: m,
    active: m !== 0,
    absXi,
  }
}

/**
 * 带临界伸长损伤的键力：μ = criticalStretchMu(s, s0)。
 */
export function bondForceDensityDamaged1d(
  xi0: number,
  xj0: number,
  xi: number,
  xj: number,
  c: number,
  delta: number,
  s0: number,
): {
  fi: number
  s: number
  mu: number
  active: boolean
  absXi: number
  broken: boolean
} {
  // 先算 s（不依赖 μ）
  const probe = bondForceDensity1d(xi0, xj0, xi, xj, c, delta, 1)
  if (!withinHorizon(xi0, xj0, delta) || probe.absXi <= 1e-30) {
    return { fi: 0, s: 0, mu: 0, active: false, absXi: probe.absXi, broken: false }
  }
  const s = probe.s
  const mu = criticalStretchMu(s, s0)
  const r = bondForceDensity1d(xi0, xj0, xi, xj, c, delta, mu)
  return {
    fi: r.fi,
    s: r.s,
    mu: r.mu,
    active: r.active,
    absXi: r.absXi,
    broken: mu === 0 && s > s0,
  }
}

/**
 * 粒子 i 上的净键力密度（对 j≠i 求和，可选体积权 Vj，缺省 1）：
 *   F_i = Σ_j f(i,j) · V_j
 */
export function netBondForce1d(
  x0: ArrayLike<number>,
  x: ArrayLike<number>,
  i: number,
  c: number,
  delta: number,
  opts?: {
    V?: ArrayLike<number>
    /** 临界伸长；缺省无损伤 */
    s0?: number
  },
): { Fi: number; nActive: number; nBroken: number } {
  const n = x0.length
  if (i < 0 || i >= n || x.length !== n) {
    return { Fi: 0, nActive: 0, nBroken: 0 }
  }
  const xi0 = x0[i]!
  const xi = x[i]!
  const s0 = opts?.s0
  const useDamage = s0 !== undefined && Number.isFinite(s0)
  let Fi = 0
  let nActive = 0
  let nBroken = 0
  for (let j = 0; j < n; j++) {
    if (j === i) continue
    if (!withinHorizon(xi0, x0[j]!, delta)) continue
    const Vj = opts?.V?.[j] ?? 1
    if (useDamage) {
      const r = bondForceDensityDamaged1d(
        xi0,
        x0[j]!,
        xi,
        x[j]!,
        c,
        delta,
        s0!,
      )
      if (r.broken) nBroken++
      if (r.mu !== 0) {
        Fi += r.fi * Vj
        nActive++
      }
    } else {
      const r = bondForceDensity1d(xi0, x0[j]!, xi, x[j]!, c, delta, 1)
      Fi += r.fi * Vj
      nActive++
    }
  }
  return { Fi, nActive, nBroken }
}

/**
 * 1D 局部“膨胀”教学量：视界内键伸长的体积加权平均
 *   θ_i = (Σ_{j∈H} s_{ij} V_j) / (Σ_{j∈H} V_j)
 * 均匀应变 ε 时内部 θ ≈ ε（小变形 s≈ε 对共线键）。
 */
export function localDilatation1d(
  x0: ArrayLike<number>,
  x: ArrayLike<number>,
  i: number,
  delta: number,
  V?: ArrayLike<number>,
): { theta: number; nBonds: number } {
  const n = x0.length
  if (i < 0 || i >= n || x.length !== n || !(delta > 0)) {
    return { theta: 0, nBonds: 0 }
  }
  const xi0 = x0[i]!
  const xi = x[i]!
  let sumSV = 0
  let sumV = 0
  let nBonds = 0
  for (let j = 0; j < n; j++) {
    if (j === i) continue
    if (!withinHorizon(xi0, x0[j]!, delta)) continue
    const Vj = V?.[j] ?? 1
    if (!(Vj > 0)) continue
    const s = bondStretch(xi0, x0[j]!, xi, x[j]!)
    sumSV += s * Vj
    sumV += Vj
    nBonds++
  }
  return {
    theta: sumV > 1e-30 ? sumSV / sumV : 0,
    nBonds,
  }
}

/**
 * 均匀应变构型：x_i = x0_i · (1+ε)（原点固定仿射）。
 */
export function applyUniformStrain1d(
  x0: ArrayLike<number>,
  eps: number,
): Float64Array {
  const n = x0.length
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = x0[i]! * (1 + eps)
  }
  return x
}

/**
 * 键力样例：
 * - 均匀应变 → |f| ∝ |s| ∝ |ε|（线性响应）
 * - 视界外对 |ξ|>δ → 力 0
 */
export function runPdBondForceSample(opts?: {
  c?: number
  delta?: number
  eps?: number
}): {
  s: number
  fi: number
  fiDouble: number
  linearRatio: number
  farForce: number
  ok: boolean
  methodId: typeof METHOD_ALGO_PD_BOND_FORCE
  familyId: typeof METHOD_PERIDYNAMICS
} {
  const c = opts?.c ?? 2
  const delta = opts?.delta ?? 1.5
  const eps = opts?.eps ?? 0.02

  // 参考：i=0, j=1，ξ=1 < δ
  const xi0 = 0
  const xj0 = 1
  const xi = 0
  const xj = 1 * (1 + eps)
  const r = bondForceDensity1d(xi0, xj0, xi, xj, c, delta, 1)
  const r2 = bondForceDensity1d(
    xi0,
    xj0,
    xi,
    1 * (1 + 2 * eps),
    c,
    delta,
    1,
  )
  // 视界外：ξ=3 > δ=1.5
  const far = bondForceDensity1d(0, 3, 0, 3 * (1 + eps), c, delta, 1)

  const sExact = eps // |ξ+η|=1+ε, |ξ|=1 → s=ε
  const linearRatio =
    Math.abs(r.fi) > 1e-30 ? Math.abs(r2.fi / r.fi) : Infinity
  // 期望 |f(2ε)/f(ε)| ≈ 2
  const ok =
    Math.abs(r.s - sExact) < 1e-12 &&
    Math.abs(r.fi - c * sExact * 1) < 1e-12 && // e=+1
    Math.abs(linearRatio - 2) < 1e-9 &&
    far.fi === 0 &&
    far.active === false &&
    Number.isFinite(r.fi)

  return {
    s: r.s,
    fi: r.fi,
    fiDouble: r2.fi,
    linearRatio,
    farForce: far.fi,
    ok,
    methodId: METHOD_ALGO_PD_BOND_FORCE,
    familyId: METHOD_PERIDYNAMICS,
  }
}

/**
 * 膨胀 / 损伤样例：
 * - 均匀应变下内部 θ ≈ ε
 * - s>s0 时 μ=0、键力为 0（断键）
 */
export function runPdDilatationSample(opts?: {
  n?: number
  dx?: number
  delta?: number
  eps?: number
  s0?: number
  c?: number
}): {
  thetaInterior: number
  eps: number
  thetaErr: number
  forceBelowS0: number
  forceAboveS0: number
  muAbove: number
  broken: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PD_DILATATION
  familyId: typeof METHOD_PERIDYNAMICS
} {
  const n = opts?.n ?? 21
  const dx = opts?.dx ?? 1
  const delta = opts?.delta ?? 2.5 * dx
  const eps = opts?.eps ?? 0.01
  const s0 = opts?.s0 ?? 0.05
  const c = opts?.c ?? 1

  const x0 = new Float64Array(n)
  for (let i = 0; i < n; i++) x0[i] = i * dx
  const x = applyUniformStrain1d(x0, eps)

  // 中心粒子膨胀
  const mid = (n - 1) >> 1
  const { theta, nBonds } = localDilatation1d(x0, x, mid, delta)
  const thetaErr = Math.abs(theta - eps)

  // 损伤：键 ξ=1，s=ε_small < s0 vs ε_large > s0
  const below = bondForceDensityDamaged1d(
    0,
    1,
    0,
    1 * (1 + 0.5 * s0),
    c,
    2,
    s0,
  )
  const above = bondForceDensityDamaged1d(
    0,
    1,
    0,
    1 * (1 + 2 * s0),
    c,
    2,
    s0,
  )

  const ok =
    nBonds > 0 &&
    thetaErr < 1e-12 &&
    Math.abs(below.fi) > 0 &&
    below.mu === 1 &&
    above.mu === 0 &&
    above.fi === 0 &&
    above.broken === true &&
    Number.isFinite(theta)

  return {
    thetaInterior: theta,
    eps,
    thetaErr,
    forceBelowS0: below.fi,
    forceAboveS0: above.fi,
    muAbove: above.mu,
    broken: above.broken,
    ok,
    methodId: METHOD_ALGO_PD_DILATATION,
    familyId: METHOD_PERIDYNAMICS,
  }
}
