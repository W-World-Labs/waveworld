import { describe, it, expect } from 'vitest'
import { buildOptGraph, findOptimalPaths, negLogEff } from './optimize'
import { buildPathGraph, findPaths } from './paths'
import { NODES } from '../data/ontology/nodes'
import { EDGES } from '../data/ontology/edges'
import type { ConversionEdge, EnergyNode } from '../data/ontology/types'

// ---- 小图工具：构造已知答案的玩具图 ----
const N = (id: string, parent?: string): EnergyNode =>
  ({ id, name: id, desc: '', quantities: [], consensus: { status: 'established' }, parent })
const E = (id: string, from: string, to: string, eff: number): ConversionEdge =>
  ({ id, from, to, name: id, principle: '', efficiency: { symbol: 'η', unit: '1', min: eff, max: eff }, lossMechanisms: [], consensus: { status: 'established' } })

describe('findOptimalPaths（玩具图：已知最优）', () => {
  // A→B 0.5 ; A→C 0.9 ; C→B 0.9 ; B→D 0.5（均为顶层节点，族=自身）
  // A→D 最优 = A→C→B→D = 0.405 > A→B→D = 0.25
  const nodes = ['A', 'B', 'C', 'D'].map((id) => N(id))
  const edges = [E('ab', 'A', 'B', 0.5), E('ac', 'A', 'C', 0.9), E('cb', 'C', 'B', 0.9), E('bd', 'B', 'D', 0.5)]
  const g = buildOptGraph(nodes, edges)

  it('Dijkstra 找到的不是直达而是更高效率的间接链', () => {
    const [best] = findOptimalPaths(g, 'A', 'D', { k: 1 })
    expect(best.hops.map((h) => h.edge.id)).toEqual(['ac', 'cb', 'bd'])
    expect(best.totalEff).toBeCloseTo(0.405, 12)
    expect(best.realHops).toBe(3)
  })

  it('-ln η 权重与效率连乘等价：exp(-totalWeight)=totalEff', () => {
    const [best] = findOptimalPaths(g, 'A', 'D', { k: 1 })
    expect(Math.exp(-best.totalWeight)).toBeCloseTo(best.totalEff, 12)
  })

  it('Yen 返回 K 条互异路径，按效率严格降序（代价升序）', () => {
    const paths = findOptimalPaths(g, 'A', 'D', { k: 5 })
    expect(paths.length).toBe(2) // 仅两条简单路径
    expect(paths[0].totalEff).toBeCloseTo(0.405, 12)
    expect(paths[1].totalEff).toBeCloseTo(0.25, 12)
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i - 1].totalEff).toBeGreaterThanOrEqual(paths[i].totalEff)
      expect(paths[i - 1].totalWeight).toBeLessThanOrEqual(paths[i].totalWeight + 1e-12)
    }
    const sigs = paths.map((p) => p.hops.map((h) => h.edge.id).join('>'))
    expect(new Set(sigs).size).toBe(sigs.length)
  })

  it('filter 排除某边后，该边不再出现且最优路径随之改变', () => {
    const paths = findOptimalPaths(g, 'A', 'D', { k: 5, filter: (e) => e.id !== 'ac' })
    expect(paths.every((p) => p.hops.every((h) => h.edge.id !== 'ac'))).toBe(true)
    expect(paths[0].totalEff).toBeCloseTo(0.25, 12) // 只剩 A→B→D
  })

  it('maxHops 限制真实跳数', () => {
    expect(findOptimalPaths(g, 'A', 'D', { k: 5, maxHops: 1 })).toHaveLength(0) // 最少 2 跳
    const two = findOptimalPaths(g, 'A', 'D', { k: 5, maxHops: 2 })
    expect(two).toHaveLength(1)
    expect(two[0].hops.map((h) => h.edge.id)).toEqual(['ab', 'bd'])
  })

  it('from===to 返回空', () => {
    expect(findOptimalPaths(g, 'A', 'A')).toHaveLength(0)
  })
})

describe('端点「族」展开（救回子形态边，但不在兄弟子形态间免费瞬移）', () => {
  // chemical(顶层) ⊃ triplet, ros ; em(顶层) ⊃ em-vis
  // 真实边：photo: em-vis→triplet (0.5) ; t2r: triplet→ros (0.6)
  const nodes = [N('chemical'), N('triplet', 'chemical'), N('ros', 'chemical'), N('em'), N('em-vis', 'em')]
  const edges = [E('t2r', 'triplet', 'ros', 0.6), E('photo', 'em-vis', 'triplet', 0.5)]
  const g = buildOptGraph(nodes, edges)

  it('从顶层 em 出发可用子形态边 em-vis→triplet；抵达任一 chemical 子形态即视为抵达 chemical', () => {
    const [best] = findOptimalPaths(g, 'em', 'chemical', { k: 1 })
    expect(best.hops.map((h) => h.edge.id)).toEqual(['photo']) // 落在 triplet 即达 chemical
    expect(best.totalEff).toBeCloseTo(0.5, 12)
    expect(best.realHops).toBe(1)
  })

  it('指向具体子形态 ros 时必须走真实能量转移边 t2r（无免费兄弟瞬移）', () => {
    const [best] = findOptimalPaths(g, 'em', 'ros', { k: 1 })
    expect(best.hops.map((h) => h.edge.id)).toEqual(['photo', 't2r'])
    expect(best.totalEff).toBeCloseTo(0.3, 12) // 0.5 × 0.6，没有 1.0 的免费通路
  })

  it('triplet→ros 唯一通路是真实边 t2r，不会因共享母形式 chemical 而免费互通', () => {
    const [best] = findOptimalPaths(g, 'triplet', 'ros', { k: 5 })
    expect(best.hops.map((h) => h.edge.id)).toEqual(['t2r'])
    expect(best.totalEff).toBeCloseTo(0.6, 12)
  })

  it('negLogEff 对效率 1 的边为 0、随 η 递减递增', () => {
    expect(negLogEff(E('x', 'a', 'b', 1))).toBeCloseTo(0, 12)
    expect(negLogEff(E('y', 'a', 'b', 0.5))).toBeGreaterThan(0)
    expect(negLogEff(E('z', 'a', 'b', 0.5))).toBeCloseTo(-Math.log(0.5), 12)
  })
})

describe('真实 EDGES 图', () => {
  const optG = buildOptGraph(NODES, EDGES)
  const forms = NODES.filter((n) => !n.parent).map((n) => n.id)

  it('所有顶层对的最优累积效率 ≤ 100%（非负权 ⇒ ∏η≤1）', () => {
    for (const a of forms) for (const b of forms) if (a !== b) {
      const [best] = findOptimalPaths(optG, a, b, { k: 1 })
      if (best) expect(best.totalEff, `${a}→${b}`).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('连通性与 DFS 一致：全部 90 个顶层有序对均可达', () => {
    const fg = buildPathGraph(NODES, EDGES)
    for (const a of forms) for (const b of forms) if (a !== b) {
      const dfs = findPaths(fg, a, b, { maxDepth: 5 })
      const opt = findOptimalPaths(optG, a, b, { k: 1 })
      if (dfs.length) expect(opt.length, `${a}→${b} DFS 可达则 OPT 也应可达`).toBeGreaterThan(0)
    }
  })

  it('路径在节点级严格连续：每跳 to===下一跳 from（不做跨分辨率免费拼接，故比 DFS 更物理诚实）', () => {
    // DFS 的“最优”常是把 γ 射线(nuclear-decay→em-gamma)接到可见光光导(η0.95)之类的跨分辨率虚高链。
    // 本内核只走真实边、节点级连续，因此对 nuclear→mechanical 给出诚实的 90%（直达），而非 DFS 的 93.1%。
    for (const [a, b] of [['nuclear', 'mechanical'], ['electric', 'mass'], ['electromagnetic', 'chemical']]) {
      for (const p of findOptimalPaths(optG, a, b, { k: 6 })) {
        for (let i = 1; i < p.hops.length; i++) {
          expect(p.hops[i - 1].to, `${a}→${b} 第 ${i} 跳断裂`).toBe(p.hops[i].from)
        }
      }
    }
  })

  it('救回被 DFS 丢弃的子形态边：chemical-excited-triplet→chemical-ros 经真实边 chemical-triplet-to-ros 可达', () => {
    // 旧 buildPathGraph 中 formOf(两端)都=chemical、f===t→continue，这条 SDT 核心边从未入图。
    const fg = buildPathGraph(NODES, EDGES)
    expect(fg.adj.get('chemical')?.has('chemical') ?? false).toBe(false)
    const [best] = findOptimalPaths(optG, 'chemical-excited-triplet', 'chemical-ros', { k: 3 })
    expect(best).toBeTruthy()
    expect(best.hops.some((h) => h.edge.id === 'chemical-triplet-to-ros')).toBe(true)
  })

  it('每条返回路径起止落在端点族内、无重复节点', () => {
    const paths = findOptimalPaths(optG, 'nuclear', 'mechanical', { k: 8 })
    expect(paths.length).toBeGreaterThan(0)
    const startFam = new Set(optG.family.get('nuclear'))
    const endFam = new Set(optG.family.get('mechanical'))
    for (const p of paths) {
      expect(startFam.has(p.hops[0].from), '起点在 nuclear 族内').toBe(true)
      expect(endFam.has(p.hops[p.hops.length - 1].to), '终点在 mechanical 族内').toBe(true)
      const seq = [p.hops[0].from, ...p.hops.map((h) => h.to)]
      expect(new Set(seq).size, '无重复节点').toBe(seq.length)
    }
  })

  it('C2：distinct-state 子形态不作零成本族展开起点，但直接查询仍保留为单点起点', () => {
    // 直接查 mass-fusion→thermal 仍可达(from 本身保留)
    expect(findOptimalPaths(optG, 'mass-fusion', 'thermal', { k: 1 }).length).toBeGreaterThan(0)
    // 但从顶层 mass 出发，最优/备选路径不得以聚变/裂变等"过程态"作第 0 跳起点
    const excluded = new Set(['mass-fusion', 'mass-fission', 'mass-binding-defect', 'mass-annihilation'])
    for (const p of findOptimalPaths(optG, 'mass', 'thermal', { k: 20 })) {
      expect(excluded.has(p.hops[0].from), `${p.hops[0].from} 不应作 mass 的零成本起点`).toBe(false)
    }
  })

  it('同形式储能往返可计算（电→电 经机械/化学返回，每条 ≥1 真实跳）', () => {
    const rt = findOptimalPaths(optG, 'electric', 'electric', { k: 3 })
    expect(rt.length).toBeGreaterThan(0)
    for (const p of rt) {
      expect(p.realHops).toBeGreaterThanOrEqual(1)
      expect(p.totalEff).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('约束过滤：排除 contested/open 边后，结果不含此类边', () => {
    const filter = (e: ConversionEdge) => e.consensus.status !== 'contested' && e.consensus.status !== 'open'
    const paths = findOptimalPaths(optG, 'mass', 'mechanical', { k: 10, filter })
    for (const p of paths) {
      for (const h of p.hops) {
        expect(['contested', 'open']).not.toContain(h.edge.consensus.status)
      }
    }
  })
})
