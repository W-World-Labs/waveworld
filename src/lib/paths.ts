// 能量转换路径搜索（纯函数）。在顶层能量形式构成的有向图上做 DFS，
// 枚举 from→…→to 的所有路径（无重复节点、限深），按累积效率（各跳效率连乘）排序。
import type { ConversionEdge, EnergyNode } from '../data/ontology/types'

export interface Hop { from: string; to: string; edge: ConversionEdge; eff: number }
export interface Path { hops: Hop[]; totalEff: number }
export interface PathGraph {
  formOf: (id: string) => string
  /** from 顶层形式 → (to 顶层形式 → 该对的代表边/效率) */
  adj: Map<string, Map<string, { edge: ConversionEdge; eff: number }>>
}

// 链路累积用的等效效率：取区间 [min,max] 的代表性典型值 (min+max)/2，与蒙特卡洛 U[min,max] 的均值
// 一致——避免用区间上界(常为实验室记录值)排序导致系统性乐观、且与 MC 自相矛盾。封顶 1.0：
// 热泵等 COP>1 设备搬运的是环境热（非凭空造能），效率链中最多按 100% 计，否则连乘虚高 >100%。
// 真实 COP/峰值仍存于 edge.efficiency，供 UI 单独标注。
/** 搬运/能效型（COP 设备）：kind 标记，或退化按 COP>1 判定。 */
export const isTransport = (e: ConversionEdge) => e.kind === 'transport' || (e.efficiency.max ?? 0) > 1
/** 链路累积效率的代表区间(单一真源)：搬运型(COP)边整段封顶到 [1,1]；转换边用 min(1,·) 后的 [min,max]。
 *  effForChain 取此区间中点、蒙特卡洛抽样此区间——二者同源，避免"先封顶后抽样"vs"先平均后封顶"口径不一致(C5)。 */
export const chainEffInterval = (e: ConversionEdge): { min: number; max: number } => {
  if (isTransport(e)) return { min: 1, max: 1 }
  return {
    min: Math.min(1, e.efficiency.min ?? e.efficiency.max ?? 0),
    max: Math.min(1, e.efficiency.max ?? e.efficiency.min ?? 0),
  }
}
export const effForChain = (e: ConversionEdge) => {
  const iv = chainEffInterval(e)
  return (iv.min + iv.max) / 2
}

const effOf = (e: ConversionEdge) => effForChain(e)

export function buildPathGraph(nodes: EnergyNode[], edges: ConversionEdge[]): PathGraph {
  const parent = new Map(nodes.map((n) => [n.id, n.parent]))
  const formOf = (id: string) => parent.get(id) ?? id
  const adj = new Map<string, Map<string, { edge: ConversionEdge; eff: number }>>()
  for (const e of edges) {
    const f = formOf(e.from), t = formOf(e.to)
    if (f === t) continue // 跳过同形式自环（路径图只看跨形式跃迁）
    const eff = effOf(e)
    let row = adj.get(f)
    if (!row) { row = new Map(); adj.set(f, row) }
    const cur = row.get(t)
    if (!cur || eff > cur.eff) row.set(t, { edge: e, eff }) // 每对取效率最高的代表边
  }
  return { formOf, adj }
}

export function findPaths(
  g: PathGraph, from: string, to: string,
  opts: { maxDepth?: number; maxResults?: number } = {},
): Path[] {
  const maxDepth = opts.maxDepth ?? 4
  const maxResults = opts.maxResults ?? 15
  const results: Path[] = []
  if (from === to) return results

  const visited = new Set<string>([from])
  const hops: Hop[] = []
  const dfs = (cur: string, eff: number) => {
    if (hops.length > 0 && cur === to) {
      results.push({ hops: hops.slice(), totalEff: eff })
      return // 到达目标即收尾，不让 to 出现在中途
    }
    if (hops.length >= maxDepth) return
    const row = g.adj.get(cur)
    if (!row) return
    for (const [nxt, { edge, eff: e }] of row) {
      if (visited.has(nxt)) continue
      visited.add(nxt)
      hops.push({ from: cur, to: nxt, edge, eff: e })
      dfs(nxt, eff * e)
      hops.pop()
      visited.delete(nxt)
    }
  }
  dfs(from, 1)
  results.sort((a, b) => b.totalEff - a.totalEff)
  return results.slice(0, maxResults)
}
