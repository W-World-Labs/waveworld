/**
 * META 方法族 · 纯算法入口（路径效率 + 能量→Token 链）。
 * 对应 methods.data 中的元方法：
 *   method-path-efficiency  — DFS 路径 + 效率连乘 + MC 区间抽样
 *   method-energy-token-chain — 发电→电网→DC→GPU→推理 效率链
 * 一律委托已有纯函数（paths / mc / energyChain），不重实现。
 */
import { NODES } from '../../data/ontology/nodes'
import { EDGES } from '../../data/ontology/edges'
import {
  buildPathGraph,
  chainEffInterval,
  findPaths,
  type Hop,
  type Path,
  type PathGraph,
} from '../paths'
import {
  mcStats,
  monteCarloCPU,
  rng,
  samplePath,
  type McPath,
  type McStat,
} from '../mc'
import {
  computeChain,
  DEFAULT_INPUT,
  GRID_EFF,
  GPU_COMP_EFF,
  INFER_EFF,
  POWER_SOURCES,
  TRANS_EFF,
  type ChainInput,
  type ChainResult,
} from '../energyChain'

export const META_PATH_PARENT = 'method-path-efficiency'
export const META_TOKEN_PARENT = 'method-energy-token-chain'

/** 子算法 · 数据中心 PUE 效率因子 η_dc = 1/PUE。 */
export const META_PUE_ID = 'method-algo-pue-factor'

/** 子算法 · Token 吞吐 tokens/J（= 1 / J·token⁻¹）。 */
export const META_TOKEN_THROUGHPUT_ID = 'method-algo-token-throughput'

/** 子算法 · 路径图 Dijkstra（边权 −log η）。 */
export const META_PATH_DIJKSTRA_ID = 'method-algo-path-dijkstra-stub'

/**
 * 在 PathGraph 上以 w = −log(η) 求 from→to 最大效率路径（∑w 最小 ⇔ ∏η 最大）。
 * 使用 paths.ts 的 buildPathGraph 邻接；朴素 Dijkstra（图很小）。
 */
export function dijkstraNegLogEta(
  g: PathGraph,
  from: string,
  to: string,
): Path | null {
  if (from === to) return null
  const dist = new Map<string, number>([[from, 0]])
  const prevHop = new Map<string, Hop>()
  const done = new Set<string>()
  const pq: Array<{ d: number; id: string }> = [{ d: 0, id: from }]
  while (pq.length) {
    let bi = 0
    for (let i = 1; i < pq.length; i++) if (pq[i]!.d < pq[bi]!.d) bi = i
    const { id: u, d } = pq.splice(bi, 1)[0]!
    if (done.has(u)) continue
    done.add(u)
    if (u === to) break
    const row = g.adj.get(u)
    if (!row) continue
    for (const [v, { edge, eff }] of row) {
      if (done.has(v)) continue
      const eta = Math.max(eff, 1e-12)
      const w = -Math.log(eta)
      const nd = d + w
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd)
        prevHop.set(v, { from: u, to: v, edge, eff })
        pq.push({ d: nd, id: v })
      }
    }
  }
  if (!prevHop.has(to)) return null
  const hops: Hop[] = []
  let cur = to
  while (cur !== from) {
    const h = prevHop.get(cur)
    if (!h) return null
    hops.push(h)
    cur = h.from
  }
  hops.reverse()
  const totalEff = hops.reduce((a, h) => a * h.eff, 1)
  return { hops, totalEff }
}

/** Dijkstra −log η 样例：与 DFS 最优路径对拍 totalEff。 */
export function runPathDijkstraSample(
  from = 'chemical',
  to = 'electric',
): {
  found: boolean
  hopCount: number
  totalEff: number
  totalWeight: number
  matchesDfsBest: boolean
  methodId: typeof META_PATH_DIJKSTRA_ID
  familyId: typeof META_PATH_PARENT
} {
  const g = buildPathGraph(NODES, EDGES)
  const best = dijkstraNegLogEta(g, from, to)
  const dfs = findPaths(g, from, to, { maxDepth: 6, maxResults: 30 })
  const dfsBest = dfs[0] ?? null
  if (!best) {
    return {
      found: false,
      hopCount: 0,
      totalEff: 0,
      totalWeight: Infinity,
      matchesDfsBest: dfsBest === null,
      methodId: META_PATH_DIJKSTRA_ID,
      familyId: META_PATH_PARENT,
    }
  }
  const totalWeight = best.hops.reduce(
    (s, h) => s + -Math.log(Math.max(h.eff, 1e-12)),
    0,
  )
  const matchesDfsBest =
    dfsBest !== null && Math.abs(best.totalEff - dfsBest.totalEff) < 1e-9
  return {
    found: true,
    hopCount: best.hops.length,
    totalEff: best.totalEff,
    totalWeight,
    matchesDfsBest,
    methodId: META_PATH_DIJKSTRA_ID,
    familyId: META_PATH_PARENT,
  }
}

/** 路径搜索样本：在真实 ontology 图上 DFS 枚举 from→to。 */
export function runPathSearchSample(
  from = 'chemical',
  to = 'electric',
  opts: { maxDepth?: number; maxResults?: number } = {},
): {
  pathCount: number
  best: Path | null
  hopCount: number
  totalEff: number
  productMatches: boolean
} {
  const g = buildPathGraph(NODES, EDGES)
  const paths = findPaths(g, from, to, {
    maxDepth: opts.maxDepth ?? 4,
    maxResults: opts.maxResults ?? 15,
  })
  const best = paths[0] ?? null
  if (!best) {
    return { pathCount: 0, best: null, hopCount: 0, totalEff: 0, productMatches: true }
  }
  const product = best.hops.reduce((a, h) => a * h.eff, 1)
  return {
    pathCount: paths.length,
    best,
    hopCount: best.hops.length,
    totalEff: best.totalEff,
    productMatches: Math.abs(best.totalEff - product) < 1e-12,
  }
}

/** 多路径效率连乘：每条 totalEff = ∏ hop.eff，且均 ≤ 1（transport 已封顶）。 */
export function runPathEffProductSample(
  from = 'nuclear',
  to = 'mechanical',
): {
  paths: Path[]
  allProductMatch: boolean
  allEffLeq1: boolean
  sortedDesc: boolean
} {
  const g = buildPathGraph(NODES, EDGES)
  const paths = findPaths(g, from, to, { maxDepth: 4, maxResults: 20 })
  let allProductMatch = true
  let allEffLeq1 = true
  for (const p of paths) {
    const prod = p.hops.reduce((a, h) => a * h.eff, 1)
    if (Math.abs(p.totalEff - prod) > 1e-12) allProductMatch = false
    if (p.totalEff > 1 + 1e-9) allEffLeq1 = false
  }
  let sortedDesc = true
  for (let i = 1; i < paths.length; i++) {
    if (paths[i - 1].totalEff < paths[i].totalEff - 1e-15) sortedDesc = false
  }
  return { paths, allProductMatch, allEffLeq1, sortedDesc }
}

/**
 * 路径 MC 样本：用 chainEffInterval 把边效率区间（transport→[1,1]）喂给 monteCarloCPU。
 * 与 Paths UI / effForChain 同源口径。
 */
export function runPathMcSample(
  from = 'chemical',
  to = 'electric',
  N = 4000,
  seed = 17,
): {
  pathCount: number
  stats: McStat[]
  meansInBounds: boolean
  bestMean: number
  analyticMidProduct: number[]
} {
  const g = buildPathGraph(NODES, EDGES)
  const paths = findPaths(g, from, to, { maxDepth: 3, maxResults: 8 })
  const mcPaths: McPath[] = paths.map((p) => ({
    hops: p.hops.map((h) => chainEffInterval(h.edge)),
  }))
  const stats = monteCarloCPU(mcPaths, N, seed)

  // 独立均匀：E[∏U] = ∏E[U] = 中点连乘
  const analyticMidProduct = mcPaths.map((mp) =>
    mp.hops.reduce((a, h) => a * ((h.min + h.max) / 2), 1),
  )

  let meansInBounds = true
  for (const s of stats) {
    if (!(s.mean >= 0 && s.mean <= 1 + 1e-9)) meansInBounds = false
    if (!(s.min <= s.p10 && s.p10 <= s.p50 && s.p50 <= s.p90 && s.p90 <= s.max + 1e-12)) {
      meansInBounds = false
    }
  }
  const bestMean = stats.reduce((m, s) => Math.max(m, s.mean), 0)
  return { pathCount: paths.length, stats, meansInBounds, bestMean, analyticMidProduct }
}

/** 单路径 samplePath 直接抽样 + mcStats。 */
export function runSamplePathDirect(
  hops: { min: number; max: number }[],
  N = 5000,
  seed = 7,
): McStat {
  return mcStats(samplePath({ hops }, N, rng(seed)))
}

/**
 * 能量→Token 全链路样本：委托 computeChain。
 * 返回有效效率、分阶段功率与 token 经济指标。
 */
export function runEnergyTokenChainSample(
  input: ChainInput = DEFAULT_INPUT,
): {
  result: ChainResult
  effective: number
  afterInfer: number
  stageProduct: number
  effectiveLeqAfterInfer: boolean
  jPerToken: number
} {
  const result = computeChain(input)
  const src = POWER_SOURCES[input.power_source]
  const dc_eff = 1.0 / input.pue
  // 与 energyChain.computeChain 相同的连乘：gen→grid→trans→dc→gpu→infer
  const stageProduct =
    src.gen_eff * GRID_EFF * TRANS_EFF * dc_eff * GPU_COMP_EFF * INFER_EFF
  return {
    result,
    effective: result.stages.effective,
    afterInfer: result.stages.after_infer,
    stageProduct,
    effectiveLeqAfterInfer: result.stages.effective <= result.stages.after_infer + 1e-9,
    jPerToken: result.token_economics.j_per_token,
  }
}

/**
 * PUE 因子纯样例：数据中心 IT 有效功率比 η_dc = 1/PUE（PUE≥1 → η∈(0,1]）。
 * 与 energyChain.computeChain 中 dc_eff 定义一致。
 */
export function runPueSample(pue = 1.2): {
  pue: number
  dcEff: number
  idealEff: number
  worseThanIdeal: boolean
  methodId: typeof META_PUE_ID
  familyId: typeof META_TOKEN_PARENT
} {
  if (!Number.isFinite(pue) || pue < 1) {
    throw new Error(`runPueSample: pue must be finite and ≥ 1, got ${pue}`)
  }
  const dcEff = 1.0 / pue
  const idealEff = 1.0 / 1.0
  return {
    pue,
    dcEff,
    idealEff,
    worseThanIdeal: dcEff < idealEff || pue > 1,
    methodId: META_PUE_ID,
    familyId: META_TOKEN_PARENT,
  }
}

/**
 * Token 链效率单调衰减：各 stage 按顺序非增，且 effective = after_infer × quality。
 */
export function runTokenStageMonotoneSample(
  input: ChainInput = DEFAULT_INPUT,
): {
  stages: number[]
  monotone: boolean
  totalFromRaw: number
  effectiveFromRaw: number
} {
  const r = computeChain(input)
  const stages = [
    r.stages.raw_input,
    r.stages.after_gen,
    r.stages.after_grid,
    r.stages.after_trans,
    r.stages.after_dc,
    r.stages.after_gpu,
    r.stages.after_infer,
    r.stages.effective,
  ]
  let monotone = true
  for (let i = 1; i < stages.length; i++) {
    if (stages[i] > stages[i - 1] + 1e-9) monotone = false
  }
  return {
    stages,
    monotone,
    totalFromRaw: r.stage_pct.total_from_raw,
    effectiveFromRaw: r.stage_pct.effective_from_raw,
  }
}

/**
 * Token 能效吞吐纯样例：tokens_per_joule = 1 / j_per_token，
 * 与 total_tps / wall_watts 对拍；并回链 tokens_per_kwh。
 */
export function runTokenThroughputSample(
  input: ChainInput = DEFAULT_INPUT,
): {
  wallWatts: number
  totalTps: number
  jPerToken: number
  tokensPerJoule: number
  tokensPerKwh: number
  /** tokens/J 与 tps/W 一致 */
  matchesTpsOverW: boolean
  /** tokens/kWh ≈ tokens/J · 3.6e6 */
  matchesKwh: boolean
  methodId: typeof META_TOKEN_THROUGHPUT_ID
  familyId: typeof META_TOKEN_PARENT
} {
  const result = computeChain(input)
  const { wall_watts, total_tps, j_per_token, tokens_per_kwh } =
    result.token_economics
  // 原始定义（未舍入）：tps/W = 1/(W/tps)
  const tokensPerJoule = total_tps / wall_watts
  const jExact = wall_watts / total_tps
  return {
    wallWatts: wall_watts,
    totalTps: total_tps,
    jPerToken: j_per_token,
    tokensPerJoule,
    tokensPerKwh: tokens_per_kwh,
    matchesTpsOverW: Math.abs(tokensPerJoule * jExact - 1) < 1e-12,
    // computeChain 对 j_per_token / tokens_per_kwh 做了舍入，容差覆盖 round
    matchesKwh:
      Math.abs(tokens_per_kwh - tokensPerJoule * 3_600_000) <
      2 + 1e-6 * Math.max(1, tokens_per_kwh),
    methodId: META_TOKEN_THROUGHPUT_ID,
    familyId: META_TOKEN_PARENT,
  }
}
