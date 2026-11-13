// 能量转换路径的「最优化内核」（纯函数）。
//
// 与 src/lib/paths.ts 的分工：
//  - paths.ts ：在「坍缩到顶层形式」的图上做 DFS 枚举 + 按效率排序，限深 maxDepth。
//    它枚举“浏览用”的全部简单路径，但 (a) slice(maxResults) 后只是“枚举范围内最优”，真最优若
//    需更多跳会被 maxDepth 剪掉；(b) 每对节点只留“效率最高代表边”，换成本/碳等目标就选错边；
//    (c) 把子形态坍缩到顶层并跳过同形式边（f===t），静默丢弃 ~21 条子形态级边
//    （含 SDT 核心 chemical-excited-triplet→chemical-ros）。
//  - optimize.ts（本文件）：**保证全局最优**。利用「效率连乘」可转成「-ln η 可加且非负」，
//    跑 Dijkstra 求单条最优、Yen 求 K 条最短；并在**真实节点级图**（不坍缩、不丢同形式边）上搜索。
//
// 端点的「族」语义（救回子形态边、又不凭空在兄弟子形态间瞬移）：
//   查询 from→to 时，把顶层端点视为「它本身 + 其所有子形态」的族：
//     · 起点族 = {from} ∪ 子孙——“我拥有该能量形式”意味着可在任一子形态（子频段/子态）上起步；
//     · 终点族 = {to}  ∪ 子孙——抵达任一子形态即视为抵达该形式。
//   搜索只走**真实转换边**。这样：从顶层 electromagnetic 出发能用 em-radio→electric 这类子形态边；
//   而 triplet→ros 这种兄弟子形态间的转换**必须走真实的能量转移边**（有损耗），不会因共享母形式而免费互通。
//   实现上用零成本的虚拟超级源/汇把整族接成单源单汇，再跑标准 Dijkstra/Yen，最后剥掉虚拟边。
//   局限：从一个**具体子形态**端点查询时，不会自动套用母形式的通用边（物理上更保守）；UI 端点为顶层形式时无此问题。
//
// 代价模型（P0 仅效率/一次能源层；成本¥/碳gCO₂ 见后续阶段，需先补边级数据）：
//   w_eff(e) = -ln(effForChain(e))，η∈(0,1] ⇒ w≥0。∑w 最小 ⇔ ∏η 最大。
//   给定输出反推输入 E_in = E_out/∏η，逐跳损耗 ΔJ_i = E_{i-1}(1-η_i)。
//   transport(COP>1) 边经 effForChain 封顶到 1 ⇒ w=0，全图非负权，Dijkstra 成立。
//   一旦引入“成本/碳”这类对 COP 搬运可为负权的目标，需改用拆边法或 Bellman-Ford（后续阶段）。

import type { ConversionEdge, EnergyNode } from '../data/ontology/types'
import { effForChain } from './paths'
import type { Hop, Path } from './paths'

const VSRC = '__opt_src__'
const VDST = '__opt_dst__'
const VIRTUAL_PREFIX = 'virtual:'
const isVirtual = (e: ConversionEdge): boolean => e.id.startsWith(VIRTUAL_PREFIX)

/** 相变/激发/尺度专属/需特定条件才发生的「态」子形态：**不作零成本族展开起点**——"我拥有母形式"
 *  ≠"这里正发生该过程"（如拥有质能 ≠ 正在聚变/有黑洞霍金辐射；拥有引力能 ≠ 有宇观引力波）。
 *  作为**终点/中转**抵达仍允许；被直接当 from 查询时仍保留为自身单点起点。
 *  纯分辨率细化的子形态(子频段/子态：em-*、el-*、radiant-blackbody/solar、mass-rest 等)不在此列。 */
export const EXCLUDE_FROM_START_FAMILY = new Set<string>([
  'mass-fusion', 'mass-fission', 'mass-annihilation', 'mass-binding-defect',
  'nuclear-fission', 'nuclear-fusion', 'nuclear-decay',
  'gravitational-wave', 'gravitational-tidal',
  'chemical-excited-triplet', 'chemical-ros', 'chemical-combustion',
  'thermal-latent', 'thermal-radiant-heat', 'radiant-laser',
])

function virtualEdge(from: string, to: string): ConversionEdge {
  return {
    id: `${VIRTUAL_PREFIX}${from}>${to}`, from, to, name: '(虚拟接线)', principle: '',
    efficiency: { symbol: 'η', unit: '1', min: 1, max: 1, value: 1 },
    lossMechanisms: [], consensus: { status: 'established' },
  }
}

export interface OptGraph {
  /** nodeId → 出边（仅真实转换边）。 */
  out: Map<string, ConversionEdge[]>
  nodeIds: Set<string>
  /** id → 「族」= {id} ∪ 全部子孙节点 id。 */
  family: Map<string, string[]>
}

/** 节点级建图：不坍缩、保留每对全部候选边；并预计算各节点的「族」。 */
export function buildOptGraph(nodes: EnergyNode[], edges: ConversionEdge[]): OptGraph {
  const out = new Map<string, ConversionEdge[]>()
  const nodeIds = new Set<string>(nodes.map((n) => n.id))
  for (const e of edges) {
    if (e.from === e.to) continue // 真自环无意义
    nodeIds.add(e.from); nodeIds.add(e.to)
    let row = out.get(e.from)
    if (!row) { row = []; out.set(e.from, row) }
    row.push(e)
  }
  // 子孙：按 parent 建子表，BFS 展开
  const children = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parent) continue
    let c = children.get(n.parent)
    if (!c) { c = []; children.set(n.parent, c) }
    c.push(n.id)
  }
  const family = new Map<string, string[]>()
  for (const id of nodeIds) {
    const fam: string[] = [id]
    const queue = [id]
    while (queue.length) {
      const cur = queue.shift()!
      for (const c of children.get(cur) ?? []) { fam.push(c); queue.push(c) }
    }
    family.set(id, fam)
  }
  return { out, nodeIds, family }
}

/** 默认权重：-ln η，可加且非负。 */
export const negLogEff = (e: ConversionEdge): number => -Math.log(Math.max(effForChain(e), 1e-12))

export interface OptOptions {
  /** 可加非负边权；默认 negLogEff（效率最优）。虚拟接线边恒计 0。 */
  weight?: (e: ConversionEdge) => number
  /** 约束谓词：返回 false 的真实边被排除（虚拟边不受约束）。 */
  filter?: (e: ConversionEdge) => boolean
  /** 返回路径条数（Yen K 最短）；默认 1。 */
  k?: number
  /** 可选：真实跳数上限。 */
  maxHops?: number
}

/** 带权路径（在 paths.ts 的 Path 上补充排序键与真实跳数）。 */
export interface OptPath extends Path {
  totalWeight: number
  realHops: number
}

const edgeKey = (e: ConversionEdge) => `${e.from}>${e.to}>${e.id}`
const sameNodes = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

interface Route { nodes: string[]; edges: ConversionEdge[]; weight: number }
interface DijkstraCtx {
  bannedNodes?: Set<string>
  bannedEdges?: Set<string>
  allowed?: (e: ConversionEdge) => boolean
}

/** 单源单汇 Dijkstra（非负权 ⇒ 结果天然是简单路径）。null 表示不可达。 */
function dijkstra(
  g: OptGraph, from: string, to: string,
  W: (e: ConversionEdge) => number, ctx: DijkstraCtx = {},
): Route | null {
  if (from === to) return { nodes: [from], edges: [], weight: 0 }
  const dist = new Map<string, number>([[from, 0]])
  const prevEdge = new Map<string, ConversionEdge>()
  const prevNode = new Map<string, string>()
  const done = new Set<string>()
  const pq: Array<{ d: number; id: string }> = [{ d: 0, id: from }] // 朴素 PQ：图很小
  while (pq.length) {
    let bi = 0
    for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[bi].d) bi = i
    const { id: u, d } = pq.splice(bi, 1)[0]
    if (done.has(u)) continue
    done.add(u)
    if (u === to) break
    for (const e of g.out.get(u) ?? []) {
      const v = e.to
      if (done.has(v)) continue
      if (ctx.bannedNodes?.has(v)) continue
      if (ctx.bannedEdges?.has(edgeKey(e))) continue
      if (!isVirtual(e) && ctx.allowed && !ctx.allowed(e)) continue
      const nd = d + W(e)
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd); prevEdge.set(v, e); prevNode.set(v, u)
        pq.push({ d: nd, id: v })
      }
    }
  }
  if (!prevEdge.has(to)) return null
  const nodes: string[] = [to]
  const edges: ConversionEdge[] = []
  let cur = to
  while (cur !== from) {
    const e = prevEdge.get(cur)!
    edges.push(e); cur = prevNode.get(cur)!; nodes.push(cur)
  }
  nodes.reverse(); edges.reverse()
  return { nodes, edges, weight: dist.get(to)! }
}

/** Yen K 最短（无环）路径。 */
function yen(
  g: OptGraph, from: string, to: string,
  W: (e: ConversionEdge) => number, K: number, allowed?: (e: ConversionEdge) => boolean,
): Route[] {
  const A: Route[] = []
  const first = dijkstra(g, from, to, W, { allowed })
  if (!first) return A
  A.push(first)
  const B: Route[] = []
  for (let k = 1; k < K; k++) {
    const prev = A[k - 1]
    for (let i = 0; i < prev.nodes.length - 1; i++) {
      const spurNode = prev.nodes[i]
      const rootNodes = prev.nodes.slice(0, i + 1)
      const rootEdges = prev.edges.slice(0, i)
      const bannedEdges = new Set<string>()
      for (const p of A) {
        if (p.nodes.length > i && sameNodes(p.nodes.slice(0, i + 1), rootNodes)) {
          const e = p.edges[i]
          if (e) bannedEdges.add(edgeKey(e))
        }
      }
      const bannedNodes = new Set(rootNodes.slice(0, i)) // 根路径上除 spur 外的节点
      const spur = dijkstra(g, spurNode, to, W, { bannedNodes, bannedEdges, allowed })
      if (!spur) continue
      const nodes = rootNodes.slice(0, -1).concat(spur.nodes)
      const edges = rootEdges.concat(spur.edges)
      const rootWeight = rootEdges.reduce((s, e) => s + W(e), 0)
      const cand: Route = { nodes, edges, weight: rootWeight + spur.weight }
      if (B.some((b) => sameNodes(b.nodes, cand.nodes))) continue
      if (A.some((a) => sameNodes(a.nodes, cand.nodes))) continue
      B.push(cand)
    }
    if (!B.length) break
    B.sort((a, b) => a.weight - b.weight)
    A.push(B.shift()!)
  }
  return A
}

/** 把整族端点接到虚拟超级源/汇上（零成本），不改动 g.out 的共享数组。 */
function augment(g: OptGraph, startSet: string[], targetSet: string[]): OptGraph {
  const out = new Map(g.out)
  out.set(VSRC, startSet.map((s) => virtualEdge(VSRC, s)))
  for (const t of targetSet) {
    out.set(t, [...(g.out.get(t) ?? []), virtualEdge(t, VDST)])
  }
  return { out, nodeIds: g.nodeIds, family: g.family }
}

function toOptPath(r: Route): OptPath {
  const real = r.edges.filter((e) => !isVirtual(e))
  const hops: Hop[] = real.map((e) => ({ from: e.from, to: e.to, edge: e, eff: effForChain(e) }))
  const totalEff = hops.reduce((a, h) => a * h.eff, 1)
  return { hops, totalEff, totalWeight: r.weight, realHops: hops.length }
}

/**
 * 求 from→to 的最优路径（保证全局最优）+ K 条最短备选。顶层端点按「族」展开。
 * 默认按效率（-ln η）；传 weight 换目标，传 filter 加约束。返回按代价升序（效率降序）。
 */
export function findOptimalPaths(
  g: OptGraph, from: string, to: string, opts: OptOptions = {},
): OptPath[] {
  // 不在 from===to 时早退：同一形式经储能往返(如 电→化学→电)是真实且有教学价值的路径，
  // 由族展开 + 虚拟源汇 + realHops>=1 过滤 + 简单路径约束自然表达(无真实往返则返回空)。
  const weight = opts.weight ?? negLogEff
  const W = (e: ConversionEdge) => (isVirtual(e) ? 0 : weight(e))
  const K = Math.max(1, opts.k ?? 1)
  // 起点族剔除 distinct-state 子形态(相变/激发/过程态)：它们不能作零成本起点；但 from 本身恒保留。
  const startSet = (g.family.get(from) ?? [from]).filter((s) => s === from || !EXCLUDE_FROM_START_FAMILY.has(s))
  const targetSet = g.family.get(to) ?? [to] // 终点族不剔除：作为终点抵达仍允许
  const aug = augment(g, startSet, targetSet)
  // 端点族有重叠时(from===to 或上下位)会先出现 |overlap| 条 0 真实跳的退化路径(VSRC→X→VDST)，
  // 它们被 realHops>=1 过滤；故多取 |overlap| 条，保证真实(含储能往返)路径能进前 K。
  const overlap = startSet.filter((s) => targetSet.includes(s)).length
  // maxHops 是对返回结果的过滤而非搜索内剪枝；当最优(高效率)路径较长时会被滤掉，故设上限时多取一批，
  // 使 ≤maxHops 的短路径有机会进前 K（启发式，足够覆盖典型图；传感等需短链路时尤其重要）。
  const extra = opts.maxHops != null ? 4 * K + 16 : 0
  let routes = yen(aug, VSRC, VDST, W, K + overlap + extra, opts.filter).map(toOptPath)
  routes = routes.filter((p) => p.realHops >= 1) // 0 真实跳=端点本就同族，非转换路径
  if (opts.maxHops != null) routes = routes.filter((p) => p.realHops <= opts.maxHops!)
  return routes.slice(0, K)
}
