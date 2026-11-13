import { describe, expect, it } from 'vitest'
import { METHODS, methodById } from '../../data/methods/methods'
import {
  DEPTH_LEGACY_TO_SPINE,
  PRODUCT_CALCULATION_METHODS,
  resolveDepthSpineId,
} from '../../data/methods/depthTrees.product'
import {
  buildParallelExplainSession,
  findMethodsByLink,
  flattenExplainTree,
  getMethod,
  getMethodExplainTree,
  listMethods,
} from './index'

/** Title markers that must not appear in product trees. */
const RESIDUAL_TITLE =
  /residual|残差|Honest|诚实|Dragomir|Hellinger|Bhattacharyya|Compose KPI|合成 KPI|基础 KPI|skillEnvelope|联合门/i

describe('principle-depth product migration — methods spine', () => {
  it('product catalog is spine-canonical and non-empty', () => {
    const ms = listMethods()
    expect(ms.length).toBe(PRODUCT_CALCULATION_METHODS.length)
    expect(ms.length).toBeGreaterThanOrEqual(8)
    for (const m of ms) {
      expect(m.id.startsWith('method-')).toBe(true)
      expect(methodById(m.id)).toBeTruthy()
    }
  })

  it('every product method has a METHODS spine row', () => {
    for (const m of PRODUCT_CALCULATION_METHODS) {
      const row = methodById(m.id)
      expect(row, `missing METHODS row for ${m.id}`).toBeTruthy()
      expect(row!.role === 'family' || !row!.parentId || row!.role).toBeTruthy()
    }
  })

  it('legacy kind-* aliases resolve to spine ids', () => {
    expect(resolveDepthSpineId('kind-lbm-d3q19')).toBe('method-lattice-boltzmann')
    expect(resolveDepthSpineId('kind-em-fdtd-3d')).toBe('method-fdtd')
    expect(resolveDepthSpineId('kind-md-lj')).toBe('method-md-lj')
    expect(resolveDepthSpineId('kind-path-experiment')).toBe(
      'method-photosensitization-kinetics',
    )
    expect(resolveDepthSpineId('conversion-efficiency-generic')).toBe(
      'method-exergy-analysis',
    )
    expect(getMethod('kind-lbm-d3q19')?.id).toBe('method-lattice-boltzmann')
  })

  it('DEPTH_LEGACY_TO_SPINE covers all 9 legacy seeds', () => {
    expect(Object.keys(DEPTH_LEGACY_TO_SPINE).length).toBe(9)
    for (const spine of Object.values(DEPTH_LEGACY_TO_SPINE)) {
      expect(methodById(spine)).toBeTruthy()
      expect(PRODUCT_CALCULATION_METHODS.some((m) => m.id === spine)).toBe(true)
    }
  })

  it('product trees have no residual/honesty KPI titles', () => {
    for (const m of PRODUCT_CALCULATION_METHODS) {
      const flat = flattenExplainTree(m.explainRoot)
      for (const n of flat) {
        const title = `${n.id} ${n.titleZh} ${n.titleEn ?? ''}`
        expect(title, `${m.id} :: ${n.id}`).not.toMatch(RESIDUAL_TITLE)
      }
    }
  })

  it('product trees keep principle + foundation depth', () => {
    for (const m of PRODUCT_CALCULATION_METHODS) {
      const flat = flattenExplainTree(m.explainRoot)
      const layers = new Set(flat.map((n) => n.layer))
      expect(layers.has('method') || layers.has('L0') || layers.has('engineering')).toBe(
        true,
      )
      expect(
        layers.has('principle') || layers.has('foundation'),
        `${m.id} needs principle or foundation`,
      ).toBe(true)
    }
  })

  it('getMethodExplainTree accepts legacy id via alias', () => {
    const tree = getMethodExplainTree('kind-acoustics-3d')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    expect(flat.some((n) => n.layer === 'foundation')).toBe(true)
    expect(flat.every((n) => !RESIDUAL_TITLE.test(n.titleZh))).toBe(true)
  })

  it('parallel product session multi-method', () => {
    const session = buildParallelExplainSession({
      methodIds: [
        'method-alfven-speed',
        'method-electro-thermal-igbt',
        'method-lattice-boltzmann',
      ],
    })
    expect(session.methods).toHaveLength(3)
    expect(session.allSubExplains.length).toBeGreaterThan(20)
  })

  it('findMethodsByLink resolves engineering kinds on product trees', () => {
    const hit = findMethodsByLink({ jobKind: 'lbm-d3q19' })
    expect(hit.some((m) => m.id === 'method-lattice-boltzmann')).toBe(true)
  })

  it('METHODS catalog still larger than product depth bridge', () => {
    expect(METHODS.length).toBeGreaterThan(500)
    expect(PRODUCT_CALCULATION_METHODS.length).toBeLessThan(METHODS.length)
  })
})
