/**
 * DG L2 · P1 斜率限制（TVB / minmod）纯算法核。
 * 对单元模态系数 (ū, û) 或节点值做 Cockburn–Shu 型限制：
 * 光滑线性模保持，间断/阶跃模斜率压到局部均值差。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */
import { METHOD_DG } from './dg-algos'

export { METHOD_DG }

/** 子算法 · DG P1 TVB/minmod 斜率限制。 */
export const METHOD_ALGO_DG_SLOPE_LIMIT = 'method-algo-dg-slope-limit'

export const DG_L2_METHOD_IDS = [METHOD_ALGO_DG_SLOPE_LIMIT] as const

/** 单元 P1 模态：u(ξ) = ū + û · ξ，ξ∈[−1,1]（Legendre 缩放前线性模）。 */
export type DgModalP1 = {
  /** 单元均值 ū */
  mean: number
  /** 斜率模态 û（半幅：端点 = mean ± slope） */
  slope: number
}

/** 单元 P1 节点：左右端点自由度。 */
export type DgNodalP1 = {
  uL: number
  uR: number
}

/** minmod(a,b)：同号取较小绝对值，异号为 0。 */
export function minmod(a: number, b: number): number {
  if (!(Number.isFinite(a) && Number.isFinite(b))) return 0
  if (a * b <= 0) return 0
  return Math.abs(a) < Math.abs(b) ? a : b
}

/** 三参数 minmod。 */
export function minmod3(a: number, b: number, c: number): number {
  return minmod(a, minmod(b, c))
}

/**
 * TVB 修正 minmod（Cockburn–Shu）：
 *   若 |a| ≤ M h² → 视为光滑，返回 a；
 *   否则 minmod(a,b,c)。
 * M=0 时退化为经典 minmod。
 */
export function minmodTvb(
  a: number,
  b: number,
  c: number,
  M: number,
  h: number,
): number {
  if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c))) return 0
  const Mh2 = Math.max(0, M) * h * h
  if (Math.abs(a) <= Mh2) return a
  return minmod3(a, b, c)
}

/**
 * 节点 ↔ 模态：
 *   ū = (uL + uR)/2
 *   û = (uR − uL)/2
 * 端点：uL = ū − û，uR = ū + û。
 */
export function nodalToModal(n: DgNodalP1): DgModalP1 {
  return {
    mean: 0.5 * (n.uL + n.uR),
    slope: 0.5 * (n.uR - n.uL),
  }
}

export function modalToNodal(m: DgModalP1): DgNodalP1 {
  return {
    uL: m.mean - m.slope,
    uR: m.mean + m.slope,
  }
}

/**
 * 单单元模态斜率限制（邻接均值差）：
 *   û* = minmod_TVB( û, ū − ū_L, ū_R − ū ; M, h )
 * 均值 ū 不变。
 */
export function limitModalSlopeP1(
  cell: DgModalP1,
  meanLeft: number,
  meanRight: number,
  opts?: {
    /** TVB 常数 M；默认 0（纯 minmod）。 */
    M?: number
    /** 单元尺寸 h（TVB 用）；默认 1。 */
    h?: number
  },
): DgModalP1 {
  const M = opts?.M ?? 0
  const h = opts?.h ?? 1
  const b = cell.mean - meanLeft
  const c = meanRight - cell.mean
  const slope = minmodTvb(cell.slope, b, c, M, h)
  return { mean: cell.mean, slope }
}

/**
 * 节点形式限制：先转模态，限制斜率，再转回节点。
 */
export function limitNodalSlopeP1(
  cell: DgNodalP1,
  meanLeft: number,
  meanRight: number,
  opts?: { M?: number; h?: number },
): DgNodalP1 {
  return modalToNodal(limitModalSlopeP1(nodalToModal(cell), meanLeft, meanRight, opts))
}

/**
 * 对一整条 1D 网格的 P1 模态做斜率限制（周期边界）。
 * means[i] 可与 cells[i].mean 一致；若省略则用 cells[].mean。
 */
export function limitModalFieldP1(
  cells: ReadonlyArray<DgModalP1>,
  opts?: {
    M?: number
    h?: number
    /** 非周期时端单元斜率清零 */
    periodic?: boolean
  },
): DgModalP1[] {
  const n = cells.length
  const out: DgModalP1[] = new Array(n)
  const periodic = opts?.periodic ?? true
  for (let i = 0; i < n; i++) {
    const cell = cells[i]!
    if (!periodic && (i === 0 || i === n - 1)) {
      out[i] = { mean: cell.mean, slope: 0 }
      continue
    }
    const iL = (i - 1 + n) % n
    const iR = (i + 1) % n
    out[i] = limitModalSlopeP1(cell, cells[iL]!.mean, cells[iR]!.mean, opts)
  }
  return out
}

/**
 * 节点场限制（周期）：cells 为各单元 (uL,uR)。
 */
export function limitNodalFieldP1(
  cells: ReadonlyArray<DgNodalP1>,
  opts?: { M?: number; h?: number; periodic?: boolean },
): DgNodalP1[] {
  const modal = cells.map(nodalToModal)
  return limitModalFieldP1(modal, opts).map(modalToNodal)
}

/**
 * 检测线性模是否被保持：|slope* − slope| ≤ tol。
 */
export function slopeUnchanged(
  before: number,
  after: number,
  tol = 1e-12,
): boolean {
  return Math.abs(before - after) <= tol
}

/**
 * 样例：
 * - 光滑线性：ū_i = a·x_i，û = a·(h/2) → 限制后斜率不变；
 * - 阶跃：均值跳变、单元内大斜率 → minmod 将 |û| 压到邻接均值差（通常更小/为零）。
 */
export function runDgSlopeLimitSample(opts?: {
  n?: number
  h?: number
  /** 光滑线性斜率 a（u = a x） */
  a?: number
  /** TVB M；样例默认 0 */
  M?: number
}): {
  n: number
  h: number
  a: number
  M: number
  /** 光滑线性：限制后 max |Δ slope| */
  smoothSlopeErr: number
  /** 光滑线性：均值未改 */
  smoothMeanErr: number
  /** 阶跃：限制后 max |slope|（应 ≤ 邻接均值差） */
  stepMaxAbsSlope: number
  /** 阶跃：至少一个单元斜率被严格减小 */
  stepLimited: boolean
  /** 阶跃：限制后 |slope| ≤ max(|ū−ūL|,|ūR−ū|) + eps */
  stepBoundOk: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DG_SLOPE_LIMIT
  familyId: typeof METHOD_DG
} {
  const n = opts?.n ?? 16
  const h = opts?.h ?? 1
  const a = opts?.a ?? 0.75
  const M = opts?.M ?? 0

  // —— 光滑线性：单元中心 x_c = (i+0.5)h，û = a·(h/2) ——
  const smooth: DgModalP1[] = []
  for (let i = 0; i < n; i++) {
    const xc = (i + 0.5) * h
    smooth.push({ mean: a * xc, slope: a * (h / 2) })
  }
  const smoothLim = limitModalFieldP1(smooth, { M, h, periodic: false })
  // 内部单元应保持斜率；端点在非周期下被清零，检查 1..n-2
  let smoothSlopeErr = 0
  let smoothMeanErr = 0
  let finite = true
  for (let i = 1; i < n - 1; i++) {
    const b = smooth[i]!
    const r = smoothLim[i]!
    if (!Number.isFinite(r.mean) || !Number.isFinite(r.slope)) finite = false
    smoothSlopeErr = Math.max(smoothSlopeErr, Math.abs(r.slope - b.slope))
    smoothMeanErr = Math.max(smoothMeanErr, Math.abs(r.mean - b.mean))
  }

  // —— 阶跃：左半 ū=1 右半 ū=0，单元内人为大斜率 ——
  const step: DgModalP1[] = []
  const mid = n >> 1
  for (let i = 0; i < n; i++) {
    const mean = i < mid ? 1 : 0
    // 间断附近给过大斜率（超过邻接均值差）
    const slope = i === mid - 1 || i === mid ? 2 : 0
    step.push({ mean, slope })
  }
  const stepLim = limitModalFieldP1(step, { M: 0, h, periodic: false })
  let stepMaxAbsSlope = 0
  let stepLimited = false
  let stepBoundOk = true
  for (let i = 1; i < n - 1; i++) {
    const b = step[i]!
    const r = stepLim[i]!
    if (!Number.isFinite(r.slope)) finite = false
    stepMaxAbsSlope = Math.max(stepMaxAbsSlope, Math.abs(r.slope))
    if (Math.abs(r.slope) < Math.abs(b.slope) - 1e-14) stepLimited = true
    const bL = b.mean - step[i - 1]!.mean
    const bR = step[i + 1]!.mean - b.mean
    // 限制后 |slope| 应等于 |minmod(û, ΔL, ΔR)|
    const expected = Math.abs(minmod3(b.slope, bL, bR))
    if (Math.abs(r.slope) > expected + 1e-12) {
      stepBoundOk = false
    }
  }

  // 间断两侧单元必须被限制（原 slope=2，邻接差最多 1）
  const leftJump = stepLim[mid - 1]!
  const rightJump = stepLim[mid]!
  if (Math.abs(leftJump.slope) > 1 + 1e-12 || Math.abs(rightJump.slope) > 1 + 1e-12) {
    stepBoundOk = false
  }
  if (Math.abs(leftJump.slope) < 2 - 1e-12 || Math.abs(rightJump.slope) < 2 - 1e-12) {
    stepLimited = true
  }

  const ok =
    finite &&
    smoothSlopeErr < 1e-12 &&
    smoothMeanErr < 1e-12 &&
    stepLimited &&
    stepBoundOk &&
    stepMaxAbsSlope <= 1 + 1e-12

  return {
    n,
    h,
    a,
    M,
    smoothSlopeErr,
    smoothMeanErr,
    stepMaxAbsSlope,
    stepLimited,
    stepBoundOk,
    finite,
    ok,
    methodId: METHOD_ALGO_DG_SLOPE_LIMIT,
    familyId: METHOD_DG,
  }
}
