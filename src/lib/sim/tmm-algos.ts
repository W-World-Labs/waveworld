/**
 * 传输矩阵法 TMM · 纯算法核（1D 分层介质教学 stub）。
 * 正入射标量波：单层 2×2 特征矩阵 + 多层左乘 + 反射率。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */

/** 父族 · 传输矩阵法 TMM。 */
export const METHOD_TMM = 'method-tmm'

/** 子算法 · 单层 2×2 传输矩阵。 */
export const METHOD_ALGO_TMM_LAYER = 'method-algo-tmm-layer'

/** 子算法 · 多层叠乘与反射率。 */
export const METHOD_ALGO_TMM_STACK = 'method-algo-tmm-stack'

export const TMM_METHOD_IDS = [
  METHOD_ALGO_TMM_LAYER,
  METHOD_ALGO_TMM_STACK,
] as const

/** 复数 a + bi。 */
export type Complex = { re: number; im: number }

/** 2×2 复矩阵（行主：m11 m12 / m21 m22）。 */
export type Complex2x2 = {
  m11: Complex
  m12: Complex
  m21: Complex
  m22: Complex
}

/** 单层：折射率 n、厚度 d（与 1/k0 同量纲）。 */
export type TmmLayer = {
  n: number
  d: number
}

/** 2×2 单位阵。 */
export function identity2x2(): Complex2x2 {
  return {
    m11: { re: 1, im: 0 },
    m12: { re: 0, im: 0 },
    m21: { re: 0, im: 0 },
    m22: { re: 1, im: 0 },
  }
}

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

export function cDiv(a: Complex, b: Complex): Complex {
  const den = b.re * b.re + b.im * b.im
  if (!(den > 0) || !Number.isFinite(den)) {
    return { re: NaN, im: NaN }
  }
  return {
    re: (a.re * b.re + a.im * b.im) / den,
    im: (a.im * b.re - a.re * b.im) / den,
  }
}

export function cAbs2(a: Complex): number {
  return a.re * a.re + a.im * a.im
}

export function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im)
}

export function cScale(a: Complex, s: number): Complex {
  return { re: a.re * s, im: a.im * s }
}

/** 矩阵是否全部有限。 */
export function matrixAllFinite(m: Complex2x2): boolean {
  const entries = [m.m11, m.m12, m.m21, m.m22]
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (!Number.isFinite(e.re) || !Number.isFinite(e.im)) return false
  }
  return true
}

/**
 * 2×2 复矩阵乘法 C = A · B。
 */
export function mul2x2(a: Complex2x2, b: Complex2x2): Complex2x2 {
  return {
    m11: cAdd(cMul(a.m11, b.m11), cMul(a.m12, b.m21)),
    m12: cAdd(cMul(a.m11, b.m12), cMul(a.m12, b.m22)),
    m21: cAdd(cMul(a.m21, b.m11), cMul(a.m22, b.m21)),
    m22: cAdd(cMul(a.m21, b.m12), cMul(a.m22, b.m22)),
  }
}

/**
 * det(M) = m11 m22 − m12 m21（复）。
 * 无损层 det ≈ 1。
 */
export function det2x2(m: Complex2x2): Complex {
  return cSub(cMul(m.m11, m.m22), cMul(m.m12, m.m21))
}

/**
 * 单层正入射特征矩阵（教学标量波 / 电导纳形式）：
 *
 *   M = [[ cos δ ,  i sinδ / Y ],
 *        [ i Y sinδ ,  cos δ     ]]
 *
 * δ = n · k0 · d，Y = n（相对光学导纳；声学可把 Y 换成 Z）。
 * k0 = 2π/λ0（真空波数）。
 *
 * d=0 → 单位阵；半波 δ=π → −I。
 */
export function layerMatrix(
  n: number,
  d: number,
  k0: number,
): Complex2x2 {
  if (!(n > 0) || !Number.isFinite(n) || !Number.isFinite(d) || !Number.isFinite(k0)) {
    return {
      m11: { re: NaN, im: NaN },
      m12: { re: NaN, im: NaN },
      m21: { re: NaN, im: NaN },
      m22: { re: NaN, im: NaN },
    }
  }
  // 零厚度：精确单位阵（避免 sin/cos 浮点残差）
  if (d === 0 || Math.abs(d) < 1e-30) {
    return identity2x2()
  }
  const delta = n * k0 * d
  const Y = n
  const c = Math.cos(delta)
  const s = Math.sin(delta)
  return {
    m11: { re: c, im: 0 },
    m12: { re: 0, im: s / Y },
    m21: { re: 0, im: Y * s },
    m22: { re: c, im: 0 },
  }
}

/**
 * 多层叠乘 M_total = M1 · M2 · … · Mn（入射侧第一层在左）。
 * 空栈 → 单位阵。
 */
export function stackMatrix(
  layers: ReadonlyArray<TmmLayer>,
  k0: number,
): Complex2x2 {
  let M = identity2x2()
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i]!
    M = mul2x2(M, layerMatrix(L.n, L.d, k0))
  }
  return M
}

/**
 * 由总矩阵与入射/出射导纳求振幅反射系数 r。
 *
 * 输入导纳 Yin = (m21 + m22 Ys) / (m11 + m12 Ys)
 * r = (Y0 − Yin) / (Y0 + Yin)
 *
 * 非磁性介质取 Y0=n0、Ys=ns。
 */
export function reflectanceAmplitude(
  M: Complex2x2,
  n0: number,
  ns: number,
): Complex {
  if (!(n0 > 0) || !(ns > 0)) {
    return { re: NaN, im: NaN }
  }
  const Y0 = n0
  const Ys = ns
  // num_in = m21 + m22 Ys
  const numIn = cAdd(M.m21, cScale(M.m22, Ys))
  // den_in = m11 + m12 Ys
  const denIn = cAdd(M.m11, cScale(M.m12, Ys))
  const Yin = cDiv(numIn, denIn)
  // r = (Y0 − Yin) / (Y0 + Yin)
  const num = cSub({ re: Y0, im: 0 }, Yin)
  const den = cAdd({ re: Y0, im: 0 }, Yin)
  return cDiv(num, den)
}

/** 功率反射率 R = |r|²。 */
export function reflectancePower(
  M: Complex2x2,
  n0: number,
  ns: number,
): number {
  return cAbs2(reflectanceAmplitude(M, n0, ns))
}

/**
 * 真空波数 k0 = 2π / λ0。
 */
export function vacuumWaveNumber(lambda0: number): number {
  if (!(lambda0 > 0) || !Number.isFinite(lambda0)) return NaN
  return (2 * Math.PI) / lambda0
}

/**
 * 四分之一波长光学厚度对应的物理厚度：
 * n d = λ0 / 4  ⇒  d = λ0 / (4 n)
 */
export function quarterWaveThickness(n: number, lambda0: number): number {
  if (!(n > 0) || !(lambda0 > 0)) return NaN
  return lambda0 / (4 * n)
}

/**
 * 单层样例：零厚度 → 单位阵；半波 → −I；det≈1；反射有限。
 */
export function runTmmLayerSample(opts?: {
  n?: number
  d?: number
  lambda0?: number
}): {
  n: number
  d: number
  lambda0: number
  k0: number
  delta: number
  /** 零厚度矩阵相对单位阵的最大元误差 */
  zeroThickErr: number
  /** det(M) 相对 1 的误差（|det−1|） */
  detErr: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_TMM_LAYER
  familyId: typeof METHOD_TMM
} {
  const n = opts?.n ?? 1.5
  const lambda0 = opts?.lambda0 ?? 550
  const d = opts?.d ?? quarterWaveThickness(n, lambda0)
  const k0 = vacuumWaveNumber(lambda0)
  const delta = n * k0 * d

  const M0 = layerMatrix(n, 0, k0)
  const I = identity2x2()
  const zeroThickErr = Math.max(
    Math.hypot(M0.m11.re - I.m11.re, M0.m11.im - I.m11.im),
    Math.hypot(M0.m12.re - I.m12.re, M0.m12.im - I.m12.im),
    Math.hypot(M0.m21.re - I.m21.re, M0.m21.im - I.m21.im),
    Math.hypot(M0.m22.re - I.m22.re, M0.m22.im - I.m22.im),
  )

  const M = layerMatrix(n, d, k0)
  const det = det2x2(M)
  const detErr = Math.hypot(det.re - 1, det.im)
  const finite = matrixAllFinite(M) && Number.isFinite(delta) && Number.isFinite(k0)

  const ok =
    finite &&
    zeroThickErr < 1e-14 &&
    detErr < 1e-10 &&
    Number.isFinite(d) &&
    d > 0

  return {
    n,
    d,
    lambda0,
    k0,
    delta,
    zeroThickErr,
    detErr,
    finite,
    ok,
    methodId: METHOD_ALGO_TMM_LAYER,
    familyId: METHOD_TMM,
  }
}

/**
 * 叠层样例：空气中高折射率四分之一波层 → 设计波长处高 R；
 * 空栈 R=0；与菲涅耳单界面极限对照。
 */
export function runTmmStackSample(opts?: {
  nHigh?: number
  lambda0?: number
  n0?: number
  ns?: number
}): {
  nHigh: number
  lambda0: number
  n0: number
  ns: number
  dQw: number
  R_qw: number
  R_empty: number
  /** 设计波长处 R 是否显著（高反射教学阈值） */
  highR: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_TMM_STACK
  familyId: typeof METHOD_TMM
} {
  const nHigh = opts?.nHigh ?? 2.4
  const lambda0 = opts?.lambda0 ?? 550
  const n0 = opts?.n0 ?? 1
  const ns = opts?.ns ?? 1
  const k0 = vacuumWaveNumber(lambda0)
  const dQw = quarterWaveThickness(nHigh, lambda0)

  const Mempty = stackMatrix([], k0)
  const R_empty = reflectancePower(Mempty, n0, ns)

  const Mqw = stackMatrix([{ n: nHigh, d: dQw }], k0)
  const R_qw = reflectancePower(Mqw, n0, ns)

  // 四分之一波高 n 夹在空气间：Yin = n²/ns，R = ((n0 − n²/ns)/(n0 + n²/ns))²
  // n=2.4 → R ≈ ((1−5.76)/(1+5.76))² ≈ 0.50；松阈值 R > 0.35
  const highR = R_qw > 0.35
  const finite =
    Number.isFinite(R_qw) &&
    Number.isFinite(R_empty) &&
    matrixAllFinite(Mqw) &&
    Number.isFinite(dQw)

  const ok =
    finite &&
    highR &&
    R_empty < 1e-12 &&
    R_qw > R_empty &&
    R_qw <= 1 + 1e-9

  return {
    nHigh,
    lambda0,
    n0,
    ns,
    dQw,
    R_qw,
    R_empty,
    highR,
    finite,
    ok,
    methodId: METHOD_ALGO_TMM_STACK,
    familyId: METHOD_TMM,
  }
}
