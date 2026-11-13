// src/data/ontology/ontology.test.ts
import { describe, it, expect } from 'vitest'
import { NODES } from './nodes'
import { EDGES, EDGE_PLAIN_ZH_IDS } from './edges'
import { explainFormula } from '../../lib/formulaExplain'
import { CONTROVERSIES } from './controversies'
import { PHENOMENA } from './phenomena'
import { isQuantity, isFrontierPhenomenon, type ConsensusStatus, type Likelihood } from './types'
import { evalExpr } from '../../lib/formula'
import { theoreticalEtaLimit } from '../../lib/physics/registry'
import mainEdgesRaw from './edges.data.json'
import subformEdgesRaw from './edges.subform.data.json'

const STATUSES: ConsensusStatus[] = ['established', 'convention', 'contested', 'open']
const LIKELIHOODS: Likelihood[] = ['leading', 'plausible', 'minority']
const ids = new Set(NODES.map((n) => n.id))
const edgeIds = new Set(EDGES.map((e) => e.id))

describe('节点完整性', () => {
  it('id 唯一', () => {
    expect(ids.size).toBe(NODES.length)
  })
  it('每个节点 ≥1 个合法 Quantity 且 consensus.status 合法', () => {
    for (const n of NODES) {
      expect(n.quantities.length).toBeGreaterThan(0)
      expect(n.quantities.every(isQuantity)).toBe(true)
      expect(STATUSES).toContain(n.consensus.status)
    }
  })
  it('子形态 parent 指向存在的节点', () => {
    for (const n of NODES) if (n.parent) expect(ids.has(n.parent)).toBe(true)
  })
  it('electromagnetic 有 8 个直接子节点（7 频段 + radiant）且 spectrum 仍 7 频段', () => {
    expect(NODES.filter((n) => n.parent === 'electromagnetic')).toHaveLength(8)
    expect(NODES.find((n) => n.id === 'electromagnetic')!.spectrum!.length).toBe(7) // radiant 无 spectrum
  })
})

describe('边完整性', () => {
  it(`有规模化覆盖（${EDGES.length} 条边）`, () => {
    expect(EDGES.length).toBeGreaterThanOrEqual(120)
  })
  it('id 唯一', () => {
    const set = new Set(EDGES.map((e) => e.id))
    expect(set.size).toBe(EDGES.length)
  })

  // KUX 靶 G：只增人话知识；词条必须挂到真实边且能进解释层
  it('edges.plainZh 每条 id 存在且 formula.plainZh 生效', () => {
    expect(EDGE_PLAIN_ZH_IDS.length).toBeGreaterThanOrEqual(500)
    for (const id of EDGE_PLAIN_ZH_IDS) {
      expect(edgeIds.has(id), `plainZh 未知边 id: ${id}`).toBe(true)
      const e = EDGES.find((x) => x.id === id)!
      expect(e.formula, `${id} 应有 formula`).toBeTruthy()
      expect(e.formula!.plainZh && e.formula!.plainZh.length).toBeGreaterThan(8)
      const view = explainFormula(e.formula!)
      expect(view.plainZh).toBe(e.formula!.plainZh)
    }
  })

  it('凡有 formula 的边均有 plainZh（全覆盖闸门）', () => {
    const withF = EDGES.filter((e) => e.formula)
    const missing = withF.filter((e) => !e.formula?.plainZh || e.formula.plainZh.length < 8).map((e) => e.id)
    expect(missing, `缺 plainZh: ${missing.slice(0, 8).join()}`).toHaveLength(0)
    expect(withF.length).toBe(EDGE_PLAIN_ZH_IDS.length)
  })

  // KUX G 质量：禁止过短「标签式」人话（至少一句完整说明）
  it('plainZh 长度下限（质量）', () => {
    const thin = EDGES.filter((e) => e.formula?.plainZh && e.formula.plainZh.length < 16).map((e) => e.id)
    expect(thin, `过短 plainZh: ${thin.slice(0, 8).join()}`).toHaveLength(0)
  })
  it('主集与子形态集 id 无跨文件碰撞（去重前）——防合法原子被 edges.ts 去重静默丢弃', () => {
    const mainIds = new Set((mainEdgesRaw as Array<{ id: string }>).map((e) => e.id))
    const collisions = (subformEdgesRaw as Array<{ id: string }>).map((e) => e.id).filter((id) => mainIds.has(id))
    expect(collisions, `跨文件 id 碰撞: ${collisions.join()}`).toHaveLength(0)
  })
  it('from/to 解析到存在节点，效率无量纲且区间合法', () => {
    for (const e of EDGES) {
      expect(ids.has(e.from), `from ${e.from} (${e.id})`).toBe(true)
      expect(ids.has(e.to), `to ${e.to} (${e.id})`).toBe(true)
      expect(e.efficiency.unit).toBe('1')
      expect(typeof e.efficiency.min).toBe('number')
      expect(typeof e.efficiency.max).toBe('number')
      expect(e.efficiency.max! >= e.efficiency.min!, `η 区间 ${e.id}`).toBe(true)
    }
  })
  // 物理闸门（第一定律）：真实能量转换边 η≤1；只有搬运/能效型 transport(COP) 边可 >1。
  // 这能挡住「把 COP/量子产率/理论上限塞进 η」这类被 paths/optimize 当能量效率连乘的越界值。
  it('转换边(非 transport) η≤1，且 transport 边须显式 kind=transport', () => {
    const bad: string[] = []
    for (const e of EDGES) {
      if (e.kind === 'transport') {
        if (!(e.efficiency.max! > 1)) bad.push(`${e.id}: transport 但 COP_max=${e.efficiency.max}≤1`)
      } else if (e.efficiency.max! > 1 + 1e-9) {
        bad.push(`${e.id}: 非 transport 却 η_max=${e.efficiency.max}>1（应改 kind=transport 或修正 η）`)
      }
    }
    expect(bad, bad.join('\n')).toHaveLength(0)
  })
  // 第二定律（卡诺）保守闸门：转换边 η_max ≤ φ_from/φ_to（闸门㶲因子仅热能用保守高温上界<1、
  // 其余取 1）。实际只约束「热→功」边 η ≤ ~0.85（防把废热当高品位功的越界），对其余边退化为 η≤1。
  const parent = new Map(NODES.map((n) => [n.id, n.parent]))
  const formOf = (id: string) => parent.get(id) ?? id
  it('每条转换边 η_max ≤ 第一性原理理论上限（卡诺 / Landsberg辐射→功 / 第一定律）', () => {
    // src/lib/physics 从基本定律算出的保守上限：热→功用卡诺(2000K)、辐射/电磁→功用 Landsberg(太阳温)、
    // 其余第一定律 η≤1；transport(COP) 不按 η 限。会挡住任何把 COP/量子产率/理论值当 η 的越界。
    const bad: string[] = []
    for (const e of EDGES) {
      const lim = theoreticalEtaLimit(e, formOf)
      if (Number.isFinite(lim.eta) && e.efficiency.max! > lim.eta + 1e-6) {
        bad.push(`${e.id}: η_max=${e.efficiency.max} > 理论上限 ${lim.eta.toFixed(3)}（${lim.law}）`)
      }
    }
    expect(bad, bad.join('\n')).toHaveLength(0)
  })
})

describe('公式自洽/回归闸门（非物理正确性）', () => {
  // 每条 Formula 自带工作算例 sample+expected；断言 evalExpr(expr, sample) ≈ expected。
  // 注意：expected 由 scripts/clean-edges.mjs 用同语义求值器快照，故本测试只守护「求值器×公式书写」
  // 不漂移（回归闸门），并**不**校验公式物理是否正确。公式的物理正确性由 efficiency 的第一定律
  // 闸门（上文「转换边 η≤1」）与人工/对抗式核查保证。
  const formulas: { owner: string; expr: string; sample: Record<string, number>; expected: number; tol: number }[] = []
  for (const e of EDGES) {
    const collect = (f: typeof e.formula, owner: string) => {
      if (f && f.sample && typeof f.expected === 'number') {
        formulas.push({ owner, expr: f.expr, sample: f.sample, expected: f.expected, tol: f.tol ?? 1e-6 })
      }
    }
    collect(e.formula, e.id)
    for (const l of e.lossMechanisms) collect(l.formula, `${e.id}/${l.name}`)
  }

  it(`至少 150 条公式带可校验算例`, () => {
    expect(formulas.length).toBeGreaterThanOrEqual(150)
  })

  it('每条公式 evalExpr(expr, sample) ≈ expected（相对容差内）', () => {
    const fails: string[] = []
    for (const f of formulas) {
      const got = evalExpr(f.expr, f.sample)
      const rel = Math.abs(got - f.expected) / Math.max(Math.abs(f.expected), 1e-30)
      if (!Number.isFinite(got) || rel > Math.max(f.tol, 1e-6)) {
        fails.push(`${f.owner}: expr=${f.expr} expected=${f.expected} got=${got}`)
      }
    }
    expect(fails, fails.slice(0, 10).join('\n')).toHaveLength(0)
  })
})

describe('争议完整性', () => {
  it('每条争议 status 合法且至少一个 viewpoint 或 summary', () => {
    for (const c of CONTROVERSIES) {
      expect(STATUSES).toContain(c.consensus.status)
      expect((c.consensus.viewpoints?.length ?? 0) > 0 || !!c.consensus.summary).toBe(true)
    }
  })

  it('controversies relatedNodeIds ⊆ NODES', () => {
    for (const c of CONTROVERSIES) {
      for (const id of c.relatedNodeIds ?? []) expect(ids.has(id), id).toBe(true)
    }
  })
})

/** 骨架节点：允许零边，须在此登记（防静默孤儿蔓延）。el-static = 静电势能教学位。 */
const ORPHAN_ALLOWLIST = new Set(['el-static'])

describe('图结构 · 孤儿节点', () => {
  it('无入射/出射边的节点必须在白名单（骨架占位）', () => {
    const incident = new Set<string>()
    for (const e of EDGES) {
      incident.add(e.from)
      incident.add(e.to)
    }
    const orphans = NODES.map((n) => n.id).filter((id) => !incident.has(id))
    for (const id of orphans) {
      expect(ORPHAN_ALLOWLIST.has(id), `意外孤儿节点: ${id}`).toBe(true)
    }
  })
})



describe('前沿现象完整性', () => {
  it('至少有 SDT 首条现象，id 唯一，类型守卫通过', () => {
    expect(PHENOMENA.length).toBeGreaterThanOrEqual(1)
    const set = new Set(PHENOMENA.map((p) => p.id))
    expect(set.size).toBe(PHENOMENA.length)
    for (const p of PHENOMENA) expect(isFrontierPhenomenon(p)).toBe(true)
  })

  it('每个现象的 consensus.status 合法（contested/open 等）', () => {
    for (const p of PHENOMENA) expect(STATUSES).toContain(p.consensus.status)
  })

  // 把现象/假说里所有 step 的 nodeId/edgeId/reuseEdgeIds 引用收集出来逐条校验。
  const stepNodeRefs: { owner: string; nodeId: string }[] = []
  const establishedEdgeRefs: { owner: string; edgeId: string }[] = []
  const reuseEdgeRefs: { owner: string; edgeId: string }[] = []

  for (const p of PHENOMENA) {
    for (const s of p.steps) {
      if (s.nodeId) stepNodeRefs.push({ owner: `${p.id}/step`, nodeId: s.nodeId })
      if (s.edgeId) establishedEdgeRefs.push({ owner: `${p.id}/step`, edgeId: s.edgeId })
    }
    for (const h of p.hypotheses) {
      for (const s of h.steps ?? []) {
        if (s.nodeId) stepNodeRefs.push({ owner: `${p.id}/${h.id}/step`, nodeId: s.nodeId })
        // 假说子路径里非 hypothetical 的 edgeId 是已确立边，须入 EDGES；
        // hypothetical 连线没有 edgeId（虚线只在现象层）。
        if (s.edgeId) establishedEdgeRefs.push({ owner: `${p.id}/${h.id}/step`, edgeId: s.edgeId })
      }
      for (const e of h.reuseEdgeIds ?? []) reuseEdgeRefs.push({ owner: `${p.id}/${h.id}/reuse`, edgeId: e })
    }
  }

  it('所有 step.nodeId 都存在于 NODES', () => {
    for (const r of stepNodeRefs) expect(ids.has(r.nodeId), `${r.owner}: nodeId ${r.nodeId}`).toBe(true)
  })

  it('所有 step.edgeId（已确立边）都存在于 EDGES', () => {
    for (const r of establishedEdgeRefs) expect(edgeIds.has(r.edgeId), `${r.owner}: edgeId ${r.edgeId}`).toBe(true)
  })

  it('所有 reuseEdgeIds 都存在于 EDGES', () => {
    for (const r of reuseEdgeRefs) expect(edgeIds.has(r.edgeId), `${r.owner}: reuseEdgeId ${r.edgeId}`).toBe(true)
  })

  it('hypothetical 连线不出现在 EDGES（争议留现象层，不污染效率图）', () => {
    // 争议步骤用 hypothetical=true 标记，它们没有也不应有进入 EDGES 的 edgeId。
    for (const p of PHENOMENA) {
      for (const h of p.hypotheses) {
        for (const s of h.steps ?? []) {
          if (s.hypothetical) {
            expect(s.edgeId, `${p.id}/${h.id}: hypothetical step 不应携带 edgeId`).toBeUndefined()
          }
        }
      }
    }
    // 反向：现象里凡是已确立边链接，对应节点/边都在主图——保证「声→三线态」这类争议连线确实没建成 EDGES。
    const sonoToTriplet = EDGES.some((e) => e.from === 'acoustic' && e.to === 'chemical-excited-triplet')
    expect(sonoToTriplet, '争议的「声→三线态」连线不应进 EDGES').toBe(false)
  })

  it('每个假说 likelihood 合法、consensus.status 合法，至少一条 leading 假说', () => {
    for (const p of PHENOMENA) {
      expect(p.hypotheses.length).toBeGreaterThan(0)
      for (const h of p.hypotheses) {
        expect(LIKELIHOODS).toContain(h.likelihood)
        expect(STATUSES).toContain(h.consensus.status)
      }
      expect(p.hypotheses.some((h) => h.likelihood === 'leading'), `${p.id} 应有 leading 假说`).toBe(true)
    }
  })

  it('每个现象至少一条真实档案且 kind 合法', () => {
    const KINDS = ['science', 'engineering', 'clinical']
    for (const p of PHENOMENA) {
      expect(p.applications.length).toBeGreaterThan(0)
      for (const a of p.applications) expect(KINDS).toContain(a.kind)
    }
  })

  it('SDT 现象的 sampleId 指向 photosensitization 仿真', () => {
    const sdt = PHENOMENA.find((p) => p.id === 'sonodynamic-therapy')
    expect(sdt, 'SDT 现象应存在').toBeTruthy()
    expect(sdt!.sampleId).toBe('photosensitization')
  })
})
