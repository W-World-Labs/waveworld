// 信号流图（Signal Flow Graph）+ Mason 增益公式——信息通道的传递函数/信号面。
// ⚠️ 采纳状态：本轮 deep-research **未核实**（不在 5 路检索的存活 claim 里）；
//   此为控制/信号处理界公认成熟形式化（Mason 1953, S.J. Mason），作信息通道 transfer 的标准工具补入，
//   待下一轮核实确认其在统一模块图里的确切地位（可能与 ETP 传递函数链重叠）。
// 用法：把 ETP 序列(F8)各环传递函数连成信号流图，用 Mason 求端到端增益（含反馈/前馈）。

export interface SFEdge { from: string; to: string; gain: number }
export interface SignalFlowGraph { nodes: string[]; edges: SFEdge[] }

/** 源→汇的所有前向路径（不重复经过节点）及其增益乘积。 */
export function forwardPaths(g: SignalFlowGraph, src: string, sink: string): { path: string[]; gain: number }[] {
  const out: { path: string[]; gain: number }[] = []
  const adj = new Map<string, SFEdge[]>()
  for (const e of g.edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from)!.push(e)
  }
  const dfs = (node: string, visited: Set<string>, path: string[], gain: number) => {
    if (node === sink) { out.push({ path: [...path], gain }); return }
    for (const e of adj.get(node) ?? []) {
      if (visited.has(e.to)) continue
      visited.add(e.to)
      path.push(e.to)
      dfs(e.to, visited, path, gain * e.gain)
      path.pop()
      visited.delete(e.to)
    }
  }
  dfs(src, new Set([src]), [src], 1)
  return out
}

/** 所有简单回路（cycle）及其增益与成员节点集（用于 Mason 的 non-touching 判定）。 */
export function loops(g: SignalFlowGraph): { path: string[]; gain: number; nodes: Set<string> }[] {
  const out: { path: string[]; gain: number; nodes: Set<string> }[] = []
  const adj = new Map<string, SFEdge[]>()
  for (const e of g.edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from)!.push(e)
  }
  const all = g.nodes
  const dfs = (start: string, node: string, visited: Set<string>, path: string[], gain: number) => {
    for (const e of adj.get(node) ?? []) {
      if (e.to === start) {
        out.push({ path: [...path], gain: gain * e.gain, nodes: new Set(path) })   // 闭合边增益乘入
        continue
      }
      const idx = all.indexOf(e.to)
      if (idx <= all.indexOf(start) || visited.has(e.to)) continue   // 规范化：只记 start 为最小下标的环
      visited.add(e.to); path.push(e.to)
      dfs(start, e.to, visited, path, gain * e.gain)
      path.pop(); visited.delete(e.to)
    }
  }
  for (const s of all) dfs(s, s, new Set([s]), [s], 1)
  // 去重（同环不同方向/起点）
  const seen = new Set<string>()
  return out.filter((l) => {
    const k = [...l.nodes].sort().join(',')
    if (seen.has(k)) return false
    seen.add(k); return true
  })
}

/** Mason 增益公式 T = (Σ_k P_k·Δ_k) / Δ。
 *  Δ = 1 − Σ(单环) + Σ(两两不接触环乘积) − Σ(三三不接触) + …
 *  Δ_k = 删去与前向路径 k 接触的所有环后的 Δ。 */
export function masonGain(g: SignalFlowGraph, src: string, sink: string): number {
  const fps = forwardPaths(g, src, sink)
  const allLoops = loops(g)
  const touching = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x))

  // Δ for an arbitrary loop set
  const deltaOf = (loopSet: typeof allLoops): number => {
    // 枚举所有「两两不接触」子集，按大小交替符号
    let delta = 1
    const subs: typeof allLoops[] = [[]]
    for (const l of loopSet) {
      const ext: typeof allLoops[] = []
      for (const s of subs) {
        if (s.every((x) => !touching(x.nodes, l.nodes))) ext.push([...s, l])
      }
      subs.push(...ext)
    }
    for (const s of subs) {
      if (s.length === 0) continue
      const prod = s.reduce((a, l) => a * l.gain, 1)
      delta += s.length % 2 === 1 ? -prod : prod
    }
    return delta
  }
  const delta = deltaOf(allLoops)
  let num = 0
  for (const fp of fps) {
    const fpNodes = new Set(fp.path)
    const nonTouching = allLoops.filter((l) => !touching(l.nodes, fpNodes))
    num += fp.gain * deltaOf(nonTouching)
  }
  return Math.abs(delta) < 1e-15 ? Number.NaN : num / delta
}
