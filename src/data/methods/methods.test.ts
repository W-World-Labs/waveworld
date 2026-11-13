import { describe, it, expect } from 'vitest'
import {
  METHODS,
  methodsForSimPath,
  methodById,
  childrenOf,
  rootMethods,
  pathToRoot,
  parallelGroup,
  parallelGroupIds,
  parallelsOf,
  effectiveRole,
} from './methods'
import {
  METHOD_DEPENDENCIES,
  ancestorIds,
  depsOf,
  findCycle,
  learningPath,
} from './dependencies'
import { KIND_COLOR, KIND_LABEL, KIND_ORDER } from './kindMeta'
import { DOMAINS, ALL_LEAVES } from '../../nav'
import { NODES } from '../ontology/nodes'
import { isFoundationalMethod } from './types'

const nodeIds = new Set(NODES.map((n) => n.id))
const leafPaths = new Set(ALL_LEAVES.map((l) => l.path))

const simLeaves = (): string[] => {
  const sim = DOMAINS.find((d) => d.key === 'sim')
  if (!sim) throw new Error('sim domain missing')
  return sim.facets.flatMap((f) => f.items.map((it) => it.path))
}

describe('FoundationalMethod 目录', () => {
  it('id 唯一且 type guard 通过', () => {
    const set = new Set(METHODS.map((m) => m.id))
    expect(set.size).toBe(METHODS.length)
    expect(METHODS.length).toBeGreaterThanOrEqual(20)
    for (const m of METHODS) expect(isFoundationalMethod(m)).toBe(true)
  })

  it('simPaths 若声明则 ∈ 导航叶子', () => {
    for (const m of METHODS) {
      for (const p of m.simPaths ?? []) {
        expect(leafPaths.has(p), `${m.id} simPath ${p}`).toBe(true)
      }
    }
  })

  // KUX 靶 G：挂仿真的方法必须带人话四件套原料（禁止只丢 id/机器串）
  it('有 simPaths 的方法：中文名、摘要、基础式齐全', () => {
    const hasHan = (s: string) => /[\u4e00-\u9fff]/.test(s)
    const bad: string[] = []
    for (const m of METHODS) {
      if (!m.simPaths?.length) continue
      if (!hasHan(m.name)) bad.push(`${m.id}: name 缺中文`)
      if (!m.summary || m.summary.length < 8) bad.push(`${m.id}: summary 过短`)
      if (!m.foundations?.length) bad.push(`${m.id}: foundations 空`)
    }
    expect(bad, bad.join('\n')).toHaveLength(0)
  })

  it('relatedNodeIds ⊆ NODES', () => {
    for (const m of METHODS) {
      for (const id of m.relatedNodeIds ?? []) {
        expect(nodeIds.has(id), `${m.id} → ${id}`).toBe(true)
      }
    }
  })

  it('methodsForSimPath(fdtd) 命中 FDTD 方法', () => {
    const list = methodsForSimPath('fdtd')
    expect(list.some((m) => m.id === 'method-fdtd')).toBe(true)
  })

  it('methodById', () => {
    expect(methodById('method-md-lj')?.nameEn).toMatch(/MD/)
  })
})

describe('sim 域覆盖不变量（无孤儿可运行叶子）', () => {
  it('每个方法型 sim 叶子 path 被 ≥1 个方法的 simPaths 引用', () => {
    const leaves = simLeaves()
    expect(leaves.length).toBeGreaterThanOrEqual(30)
    // Dymola is a feature-concept catalog of independently implemented operations,
    // not one runnable method family; its page and case list have separate coverage.
    expect(leaves).toContain('dymola')
    const orphans: string[] = []
    for (const p of leaves) {
      if (p === 'dymola') continue
      const hits = methodsForSimPath(p)
      if (hits.length === 0) orphans.push(p)
    }
    expect(orphans, `orphan sim leaves: ${orphans.join(', ')}`).toEqual([])
  })
})

describe('方法嵌套 parentId', () => {
  it('parent 均存在；子节点 pathToRoot 含父；root 无 parent', () => {
    const ids = new Set(METHODS.map((m) => m.id))
    for (const m of METHODS) {
      if (m.parentId) {
        expect(ids.has(m.parentId), m.id).toBe(true)
        const path = pathToRoot(m.id)
        expect(path[0]?.id).toBe(m.id)
        expect(path.some((x) => x.id === m.parentId)).toBe(true)
      }
    }
    for (const r of rootMethods()) {
      expect(r.parentId).toBeUndefined()
    }
  })

  it('集总电路族至少 2 个子算法', () => {
    const kids = childrenOf('method-lumped-circuit')
    expect(kids.length).toBeGreaterThanOrEqual(2)
    expect(kids.every((k) => k.kind === 'circuit')).toBe(true)
    expect(kids.some((k) => k.id === 'method-algo-series-rlc')).toBe(true)
    expect(kids.some((k) => k.id === 'method-algo-rc-rl-transient')).toBe(true)
  })

  it('存在二级嵌套（孙模块 pathToRoot≥3）', () => {
    expect(methodById('method-algo-dsp-notch')?.parentId).toBe('method-algo-biodsp-pipeline')
    expect(methodById('method-algo-fluid-buoyancy')?.parentId).toBe('method-algo-fluid-pipeline')
    expect(methodById('method-algo-wave-poke')?.parentId).toBe('method-algo-wave-leapfrog')
    expect(pathToRoot('method-algo-dsp-notch').length).toBeGreaterThanOrEqual(3)
    expect(childrenOf('method-algo-biodsp-pipeline').length).toBeGreaterThanOrEqual(3)
  })

  it('主要方法族均已下钻（覆盖 + 深度）', () => {
    const minKids: Record<string, number> = {
      'method-md-lj': 5,
      'method-bioelectric': 5,
      'method-photosensitization-kinetics': 3,
      'method-fdtd': 5,
      'method-ns-stable-fluids': 4,
      'method-monte-carlo': 5,
      'method-array-beamforming': 4,
      'method-b-mode-ultrasound': 3,
      'method-spm': 4,
      'method-tdoa-trilateration': 2,
      'method-nljd': 3,
      'method-lumped-circuit': 2,
      'method-heat-ftcs': 4,
      'method-wave-fd': 3,
      'method-laser-rate': 3,
      'method-spectrum-viewer': 3,
      'method-display-opto': 3,
      'method-path-efficiency': 3,
      'method-energy-token-chain': 2,
      'method-fem': 2,
      'method-lattice-boltzmann': 2,
      'method-boundary-element': 2,
      'method-particle-in-cell': 2,
      'method-dft-electronic': 2,
      'method-kalman': 3,
      'method-finite-volume': 2,
      'method-ray-optics': 1,
      'method-spectral-method': 2,
      'method-wavelet': 2,
      'method-spectral-element': 2,
      'method-level-set': 2,
      'method-immersed-boundary': 2,
      'method-particle-filter': 1,
      'method-comsol-style-multiphysics': 2,
      'method-exergy-analysis': 1,
    }
    for (const [id, n] of Object.entries(minKids)) {
      expect(childrenOf(id).length, id).toBeGreaterThanOrEqual(n)
    }
  })

  it('并行组：同组 ≥2、parallelsOf 对称、role 可推断', () => {
    const ids = parallelGroupIds()
    for (const g of [
      'sdt-mechanism',
      'md-forcefield',
      'heat-solver',
      'fdtd-boundary',
      'ising-solver',
      'mc-update',
      'array-link-view',
      'array-beamformer',
      'spm-modality',
      'loc-geometry',
      'spectrum-band',
      'display-device',
      'md-ensemble',
      'rlc-integrator',
      'kalman-filter',
    ]) {
      expect(ids).toContain(g)
    }
    for (const g of ids) {
      const members = parallelGroup(g)
      expect(members.length).toBeGreaterThanOrEqual(2)
      const a = members[0]
      const peers = parallelsOf(a.id)
      expect(peers.length).toBe(members.length - 1)
    }
    expect(effectiveRole(methodById('method-lumped-circuit')!)).toBe('family')
    expect(effectiveRole(methodById('method-variant-sdt-cavitation')!)).toMatch(/parallel|variant/)
  })



  it('拒绝逻辑：未知 parent / 环由 validate 在加载期保证（结构断言）', () => {
    expect(METHODS.length).toBeGreaterThan(0)
    for (const m of METHODS) {
      if (m.parentId) expect(m.parentId).not.toBe(m.id)
    }
  })
})

describe('方法先修依赖图', () => {
  it('端点均在 METHODS，无自环，无环', () => {
    const ids = new Set(METHODS.map((m) => m.id))
    expect(METHOD_DEPENDENCIES.length).toBeGreaterThanOrEqual(16)
    for (const e of METHOD_DEPENDENCIES) {
      expect(ids.has(e.methodId), e.methodId).toBe(true)
      expect(ids.has(e.prerequisiteId), e.prerequisiteId).toBe(true)
      expect(e.methodId).not.toBe(e.prerequisiteId)
      expect(['hard', 'soft']).toContain(e.strength)
      expect(e.reason.length).toBeGreaterThan(4)
    }
    expect(findCycle()).toBeNull()
  })

  it('FDTD 传递先修包含波方程蛙跳', () => {
    const a = ancestorIds('method-fdtd')
    expect(a.has('method-wave-fd')).toBe(true)
    expect(depsOf('method-fdtd').some((e) => e.prerequisiteId === 'method-wave-fd')).toBe(true)
  })

  it('能量→Token 先修路径搜索与 MC', () => {
    const a = ancestorIds('method-energy-token-chain')
    expect(a.has('method-path-efficiency')).toBe(true)
    expect(a.has('method-monte-carlo')).toBe(true)
  })

  it('learningPath 以目标结尾且含祖先', () => {
    const path = learningPath('method-fdtd')
    expect(path[path.length - 1]).toBe('method-fdtd')
    expect(path).toContain('method-wave-fd')
    expect(new Set(path).size).toBe(path.length)
  })

  it('kindMeta 覆盖全部 MethodKind 键', () => {
    expect(KIND_ORDER.length).toBe(Object.keys(KIND_LABEL).length)
    for (const k of KIND_ORDER) {
      expect(KIND_COLOR[k]).toMatch(/^#/)
      expect(KIND_LABEL[k].length).toBeGreaterThan(0)
    }
  })

  it('every method with summary has summaryEn without CJK', () => {
    const withSum = METHODS.filter((m) => m.summary?.trim())
    expect(withSum.length).toBeGreaterThan(100)
    for (const m of withSum) {
      expect(m.summaryEn, m.id).toBeTruthy()
      expect(m.summaryEn!, m.id).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })

  it('every method dependency has reasonEn without CJK', () => {
    expect(METHOD_DEPENDENCIES.length).toBeGreaterThan(100)
    for (const e of METHOD_DEPENDENCIES) {
      expect(e.reasonEn, `${e.methodId}>${e.prerequisiteId}`).toBeTruthy()
      expect(e.reasonEn!, `${e.methodId}>${e.prerequisiteId}`).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })
})
