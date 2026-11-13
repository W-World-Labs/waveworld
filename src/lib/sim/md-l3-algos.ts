/**
 * MD 三级算法模块 · Nose–Hoover 1D 玩具 + 1D 元胞链表邻居。
 * method id 仅常量，不改 methods.data / moduleRegistry。
 */

/** 父族（与 methods.data 中 method-md-lj 对齐）。 */
export const MD_L3_PARENT = 'method-md-lj'

/** 三级 · Nose–Hoover 摩擦 ξ 恒温（1D 谐振子玩具）。 */
export const METHOD_ALGO_NOSE_HOOVER = 'method-algo-nose-hoover'

/** 三级 · 元胞链表邻居枚举（1D 周期盒）。 */
export const METHOD_ALGO_CELL_LIST = 'method-algo-cell-list'

export const MD_L3_METHOD_IDS = [
  METHOD_ALGO_NOSE_HOOVER,
  METHOD_ALGO_CELL_LIST,
] as const

/** 1 粒子 1D Nose–Hoover 谐振子状态（kB = m = 1）。 */
export type NoseHooverState = {
  x: number
  v: number
  /** 热浴摩擦变量 ξ */
  xi: number
}

/**
 * 1D Nose–Hoover 谐振子单步（算子分裂 / velocity-Verlet 风格）：
 *   dx/dt = v
 *   dv/dt = −ω² x − ξ v
 *   dξ/dt = (v² − T_target) / Q
 *
 * 顺序：½ ξ → ½ 摩擦(e^{−ξ dt/2}) → ½ 力 → 漂移 → ½ 力 → ½ 摩擦 → ½ ξ。
 * 恒温目标：⟨v²⟩ → T_target（1 自由度，m = kB = 1）。
 */
export function noseHooverStep(
  state: NoseHooverState,
  dt: number,
  omega: number,
  Ttarget: number,
  Q: number,
): NoseHooverState {
  const w2 = omega * omega
  const invQ = 1 / Q
  let { x, v, xi } = state

  // ½ thermostat
  xi += 0.5 * dt * (v * v - Ttarget) * invQ
  // ½ exact friction
  v *= Math.exp(-xi * 0.5 * dt)
  // ½ force kick
  v += 0.5 * dt * (-w2 * x)
  // full drift
  x += dt * v
  // ½ force kick
  v += 0.5 * dt * (-w2 * x)
  // ½ exact friction
  v *= Math.exp(-xi * 0.5 * dt)
  // ½ thermostat
  xi += 0.5 * dt * (v * v - Ttarget) * invQ

  return { x, v, xi }
}

/**
 * 多样本：从初态积分 nSteps 步，返回轨迹末态与后半程 ⟨v²⟩。
 * 长跑后 meanV2 应靠近 Ttarget（玩具容差由调用方检验）。
 */
export function noseHooverIntegrate(
  initial: NoseHooverState,
  nSteps: number,
  dt: number,
  omega: number,
  Ttarget: number,
  Q: number,
): {
  final: NoseHooverState
  /** 后半程 ⟨v²⟩ */
  meanV2: number
  /** 全程 max |v| 有限性探针 */
  maxAbsV: number
  finite: boolean
} {
  let s = { ...initial }
  let sumV2 = 0
  let nAcc = 0
  let maxAbsV = Math.abs(s.v)
  const half = Math.floor(nSteps / 2)

  for (let k = 0; k < nSteps; k++) {
    s = noseHooverStep(s, dt, omega, Ttarget, Q)
    const av = Math.abs(s.v)
    if (av > maxAbsV) maxAbsV = av
    if (k >= half) {
      sumV2 += s.v * s.v
      nAcc++
    }
  }

  const meanV2 = nAcc > 0 ? sumV2 / nAcc : s.v * s.v
  const finite =
    Number.isFinite(s.x) &&
    Number.isFinite(s.v) &&
    Number.isFinite(s.xi) &&
    Number.isFinite(meanV2)

  return { final: s, meanV2, maxAbsV, finite }
}

/**
 * Nose–Hoover 样例：1D 谐振子 NVT 玩具。
 * 单轨 Nose–Hoover 谐振子可能非遍历，故对多组初值做后半程 ⟨v²⟩ 再平均，
 * 宽松检验靠近 T_target。
 */
export function runNoseHooverSample(
  opts?: {
    omega?: number
    Ttarget?: number
    Q?: number
    dt?: number
    steps?: number
    x0?: number
    v0?: number
    xi0?: number
    /** |⟨v²⟩ − T| / T 上限，缺省 0.4 */
    tolRel?: number
  },
): {
  meanV2: number
  Ttarget: number
  relErr: number
  maxAbsV: number
  final: NoseHooverState
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_NOSE_HOOVER
  familyId: typeof MD_L3_PARENT
} {
  const omega = opts?.omega ?? 1
  const Ttarget = opts?.Ttarget ?? 1
  const Q = opts?.Q ?? 0.5
  const dt = opts?.dt ?? 0.002
  const steps = opts?.steps ?? 30_000
  const tolRel = opts?.tolRel ?? 0.4

  // 若调用方指定单一初值则只跑该轨；否则多初值平均缓解非遍历
  const initials: NoseHooverState[] =
    opts?.x0 !== undefined || opts?.v0 !== undefined || opts?.xi0 !== undefined
      ? [
          {
            x: opts?.x0 ?? 1,
            v: opts?.v0 ?? Math.sqrt(Ttarget),
            xi: opts?.xi0 ?? 0,
          },
        ]
      : [
          { x: 1, v: 0, xi: 0 },
          { x: 0, v: Math.sqrt(Ttarget), xi: 0 },
          { x: 0.7, v: 0.4, xi: 0.05 },
          { x: -0.5, v: -Math.sqrt(Ttarget * 0.5), xi: -0.1 },
        ]

  let sumMean = 0
  let maxAbsV = 0
  let finite = true
  let final: NoseHooverState = initials[0]!

  for (const ic of initials) {
    const r = noseHooverIntegrate(ic, steps, dt, omega, Ttarget, Q)
    sumMean += r.meanV2
    if (r.maxAbsV > maxAbsV) maxAbsV = r.maxAbsV
    if (!r.finite) finite = false
    final = r.final
  }

  const meanV2 = sumMean / initials.length
  const relErr = Math.abs(meanV2 - Ttarget) / Math.max(Ttarget, 1e-30)
  const ok = finite && relErr < tolRel

  return {
    meanV2,
    Ttarget,
    relErr,
    maxAbsV,
    final,
    finite,
    ok,
    methodId: METHOD_ALGO_NOSE_HOOVER,
    familyId: MD_L3_PARENT,
  }
}

// ─── 1D 周期元胞链表 ───────────────────────────────────────────

/** 1D 最小镜像距离（盒长 L）；等价于 dx − L·round(dx/L)。 */
export function minImage1D(dx: number, L: number): number {
  if (!(L > 0)) return dx
  return dx - L * Math.round(dx / L)
}

/**
 * 构建 1D 周期盒 [0, L) 上每个粒子在 rCut 内的邻居下标列表。
 * 元胞边长 cellSize ≥ rCut；仅检查本胞与 ±1 邻胞（含周期绕回）。
 * 返回 lists[i] = 与 i 距离 ≤ rCut 的 j（j ≠ i，无序、不重复）。
 */
export function buildCellList(
  positions: Float64Array,
  L: number,
  rCut: number,
): number[][] {
  const n = positions.length
  const lists: number[][] = Array.from({ length: n }, () => [])
  if (n === 0 || !(L > 0) || !(rCut >= 0)) return lists

  // 胞数：cellSize = L/nCells ≥ rCut ⇒ nCells ≤ floor(L/rCut)
  let nCells = rCut > 0 ? Math.max(1, Math.floor(L / rCut)) : 1
  // 至少 3 胞时 ±1 邻胞互不重叠；少于 3 则退化为全对（仍用同一路径）
  if (nCells < 1) nCells = 1
  const cellSize = L / nCells

  const cells: number[][] = Array.from({ length: nCells }, () => [])
  const cellOf = new Int32Array(n)

  for (let i = 0; i < n; i++) {
    // 折入 [0, L)
    let x = positions[i]!
    x = ((x % L) + L) % L
    let c = Math.floor(x / cellSize)
    if (c >= nCells) c = nCells - 1
    if (c < 0) c = 0
    cellOf[i] = c
    cells[c]!.push(i)
  }

  const rCut2 = rCut * rCut
  const seen = new Uint8Array(n) // 每 i 重置：避免邻胞重叠重复

  for (let i = 0; i < n; i++) {
    const xi = positions[i]!
    const ci = cellOf[i]!
    // 邻域：ci−1, ci, ci+1（周期）
    for (let dc = -1; dc <= 1; dc++) {
      const cj = (((ci + dc) % nCells) + nCells) % nCells
      const bucket = cells[cj]!
      for (let k = 0; k < bucket.length; k++) {
        const j = bucket[k]!
        if (j === i || seen[j]) continue
        const dx = minImage1D(positions[j]! - xi, L)
        if (dx * dx <= rCut2) {
          lists[i]!.push(j)
          seen[j] = 1
        }
      }
    }
    // 清 seen（仅本 i 写入过的 j）
    const li = lists[i]!
    for (let t = 0; t < li.length; t++) seen[li[t]!] = 0
  }

  return lists
}

/**
 * 由邻居列表计无序对 (i,j) i<j 的个数（只计 j>i，抗不对称）。
 */
export function countPairsFromLists(lists: number[][]): number {
  let pairs = 0
  for (let i = 0; i < lists.length; i++) {
    const li = lists[i]!
    for (let t = 0; t < li.length; t++) {
      if (li[t]! > i) pairs++
    }
  }
  return pairs
}

/** 暴力：1D 周期最小镜像，计 |r_ij| ≤ rCut 的无序对数。 */
export function countPairsBruteForce(
  positions: Float64Array,
  L: number,
  rCut: number,
): number {
  const n = positions.length
  const rCut2 = rCut * rCut
  let pairs = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = minImage1D(positions[j]! - positions[i]!, L)
      if (dx * dx <= rCut2) pairs++
    }
  }
  return pairs
}

/** 元胞链表计对：与 countPairsBruteForce 同语义。 */
export function countPairsWithin(
  positions: Float64Array,
  L: number,
  rCut: number,
): number {
  return countPairsFromLists(buildCellList(positions, L, rCut))
}

/**
 * 元胞链表样例：随机 1D 构型上 cell-list 对数 = 暴力对数。
 */
export function runCellListSample(
  opts?: {
    n?: number
    L?: number
    rCut?: number
    seed?: number
  },
): {
  n: number
  L: number
  rCut: number
  pairsCell: number
  pairsBrute: number
  match: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CELL_LIST
  familyId: typeof MD_L3_PARENT
} {
  const n = opts?.n ?? 48
  const L = opts?.L ?? 20
  const rCut = opts?.rCut ?? 1.5
  let seed = opts?.seed ?? 42

  // 简易 LCG
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    return (seed >>> 0) / 4294967296
  }

  const positions = new Float64Array(n)
  for (let i = 0; i < n; i++) positions[i] = rand() * L

  const pairsCell = countPairsWithin(positions, L, rCut)
  const pairsBrute = countPairsBruteForce(positions, L, rCut)
  const match = pairsCell === pairsBrute
  const ok = match && Number.isFinite(pairsCell)

  return {
    n,
    L,
    rCut,
    pairsCell,
    pairsBrute,
    match,
    ok,
    methodId: METHOD_ALGO_CELL_LIST,
    familyId: MD_L3_PARENT,
  }
}
