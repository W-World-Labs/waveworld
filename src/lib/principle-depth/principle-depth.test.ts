import { describe, expect, it } from 'vitest'
import {
  enrichWithFormulaViews,
  flattenExplainTree,
  PRINCIPLE_DEPTH_LAYERS,
} from './index'
/**
 * Residual compose / honesty trees still live on LEGACY registry (kind-* ids).
 * Product UI uses residual-free spine trees — see principle-depth.product.test.ts.
 */
import {
  buildLegacyParallelExplainSession as buildParallelExplainSession,
  findLegacyMethodsByLink as findMethodsByLink,
  getLegacyMethodExplainTree as getMethodExplainTree,
  listLegacyMethods as listMethods,
} from './legacyQuery'

describe('principle-depth — multi-method multi-layer explain', () => {
  it('lists calculation methods', () => {
    const ms = listMethods()
    expect(ms.length).toBeGreaterThanOrEqual(8)
    expect(ms.some((m) => m.id === 'method-alfven-speed')).toBe(true)
    expect(ms.some((m) => m.id === 'kind-lbm-d3q19')).toBe(true)
    expect(ms.some((m) => m.id === 'kind-acoustics-3d')).toBe(true)
    expect(ms.some((m) => m.id === 'kind-md-lj')).toBe(true)
    expect(ms.some((m) => m.id === 'kind-em-fdtd-3d')).toBe(true)
    expect(ms.some((m) => m.id === 'kind-structural-mindlin')).toBe(true)
    expect(ms.some((m) => m.id === 'kind-path-experiment')).toBe(true)
  })

  it('drills alfven from method to foundation formula', () => {
    const tree = getMethodExplainTree('method-alfven-speed')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    const layers = new Set(flat.map((n) => n.layer))
    expect(layers.has('method')).toBe(true)
    expect(layers.has('principle')).toBe(true)
    expect(layers.has('foundation')).toBe(true)
    expect(layers.has('L0')).toBe(true)
    const formulaNode = flat.find((n) => n.formula)
    expect(formulaNode?.formula?.expr).toMatch(/vA|sqrt/i)
  })

  it('filters to foundation layer only but keeps structure', () => {
    const tree = getMethodExplainTree('method-alfven-speed', {
      layers: ['foundation'],
    })
    const flat = flattenExplainTree(tree!)
    // may include ancestors for structure; every leaf-ish foundation present
    expect(flat.some((n) => n.layer === 'foundation')).toBe(true)
    expect(flat.filter((n) => n.layer === 'foundation').length).toBeGreaterThanOrEqual(2)
  })

  it('parallel session: multi method + multi layer + all sub-explains', () => {
    const session = buildParallelExplainSession({
      methodIds: [
        'method-alfven-speed',
        'kind-electro-thermal-igbt',
        'conversion-efficiency-generic',
      ],
      layers: 'all',
    })
    expect(session.methods).toHaveLength(3)
    expect(session.allSubExplains.length).toBeGreaterThan(10)
    // each method contributes
    for (const m of session.methods) {
      expect(m.allExplains.length).toBeGreaterThan(2)
    }
    // byLayer cross-cut
    expect((session.byLayer.foundation ?? []).length).toBeGreaterThan(0)
    expect((session.byLayer.principle ?? []).length).toBeGreaterThan(0)
    expect((session.byLayer.method ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('user can select only principle+foundation across two methods', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-lbm-d3q19', 'kind-electro-thermal-igbt'],
      layers: ['principle', 'foundation'],
    })
    expect(session.methodIds).toEqual([
      'kind-lbm-d3q19',
      'kind-electro-thermal-igbt',
    ])
    const layers = new Set(session.allSubExplains.map((n) => n.layer))
    // filtered views may keep method ancestors in tree but allExplains with includeAll
    // default includeAll keeps nodes in filtered tree — ancestors may be method layer
    expect(layers.has('principle') || layers.has('foundation')).toBe(true)
    for (const n of session.allSubExplains) {
      if (n.layer === 'engineering' || n.layer === 'L0') {
        // allowed only as structural ancestors if present
      }
    }
    expect(
      session.allSubExplains.some((n) => n.layer === 'foundation'),
    ).toBe(true)
  })

  it('enrichWithFormulaViews attaches plainZh', () => {
    const session = buildParallelExplainSession({
      methodIds: ['conversion-efficiency-generic'],
    })
    const withF = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const row = withF.find((n) => n.formulaView)
    expect(row?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(row?.formulaView?.expr).toContain('eta')
  })

  it('findMethodsByLink jobKind', () => {
    const hit = findMethodsByLink({ jobKind: 'lbm-d3q19' })
    expect(hit.some((m) => m.id === 'kind-lbm-d3q19')).toBe(true)
  })

  it('depth layer catalog is stable', () => {
    expect(PRINCIPLE_DEPTH_LAYERS).toContain('compose')
    expect(PRINCIPLE_DEPTH_LAYERS).toContain('foundation')
  })

  it('maxDepth 0 returns only root method node structure', () => {
    const tree = getMethodExplainTree('method-alfven-speed', { maxDepth: 0 })
    expect(tree?.children).toBeUndefined()
    expect(tree?.layer).toBe('method')
  })

  it('acoustics planewave drills method → principle → foundation with formulas', () => {
    const tree = getMethodExplainTree('kind-acoustics-3d')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    const layers = new Set(flat.map((n) => n.layer))
    expect(layers.has('method')).toBe(true)
    expect(layers.has('principle')).toBe(true)
    expect(layers.has('foundation')).toBe(true)
    expect(layers.has('engineering')).toBe(true)
    expect(layers.has('compose')).toBe(true)

    const speed = flat.find((n) => n.id === 'acoustics-foundation-c')
    expect(speed?.formula?.expr).toMatch(/sqrt/i)
    expect(speed?.formula?.plainZh).toMatch(/声速/)
    expect(speed?.formula?.expected).toBeCloseTo(Math.sqrt(2.2e9 / 1000), 6)

    const z = flat.find((n) => n.id === 'acoustics-foundation-impedance')
    expect(z?.formula?.expr).toBe('Z = rho * c')
    expect(z?.formula?.plainZh).toMatch(/阻抗/)
    expect(z?.formula?.expected).toBe(408)

    const k = flat.find((n) => n.id === 'acoustics-foundation-k')
    expect(k?.formula?.expr).toBe('k = omega / c')
    expect(k?.formula?.plainZh?.length ?? 0).toBeGreaterThan(4)

    const period = flat.find((n) => n.id === 'acoustics-foundation-period')
    expect(period?.formula?.expr).toMatch(/2 \* pi|omega/)
    expect(period?.formula?.expected).toBeCloseTo(0.001, 12)
    expect(period?.formula?.plainZh).toMatch(/周期|角频率/)

    const dtMax = flat.find((n) => n.id === 'acoustics-foundation-dt-max')
    expect(dtMax?.formula?.expr).toMatch(/dx \/ c|dt_max/)
    expect(dtMax?.formula?.expected).toBeCloseTo(1e-3 / 340, 12)
    expect(dtMax?.formula?.plainZh).toMatch(/CFL|时间步|声速/)

    const plane = flat.find((n) => n.id === 'acoustics-compose-plane-wave-pv')
    expect(plane?.formula?.expr).toMatch(/p \/ v|p\/v/)
    expect(plane?.formula?.expected).toBeCloseTo(408, 10)
    expect(plane?.formula?.plainZh).toMatch(/平面波|阻抗/)

    const I = flat.find((n) => n.id === 'acoustics-compose-intensity')
    expect(I?.formula?.expr).toMatch(/p \* p|2 \* Z/)
    expect(I?.formula?.expected).toBeCloseTo(204, 10)
    expect(I?.formula?.plainZh).toMatch(/声强|阻抗/)

    const R = flat.find((n) => n.id === 'acoustics-compose-reflection')
    expect(R?.formula?.expr).toMatch(/Z2|Z1/)
    expect(R?.formula?.expected).toBeCloseTo(-1, 10)
    expect(R?.formula?.plainZh).toMatch(/反射|阻抗/)

    const s = flat.find((n) => n.id === 'acoustics-compose-cfl-ratio')
    expect(s?.formula?.expr).toMatch(/dt|dx|c/)
    expect(s?.formula?.expected).toBeCloseTo(1e-6 / (1e-3 / 340), 12)
    expect(s?.formula?.plainZh).toMatch(/CFL|时间步/)

    const Zkr = flat.find((n) => n.id === 'acoustics-compose-Z-from-K-rho')
    expect(Zkr?.formula?.expr).toMatch(/sqrt/)
    expect(Zkr?.formula?.expected).toBeCloseTo(Math.sqrt(2.2e9 * 1000), 6)
    expect(Zkr?.formula?.plainZh).toMatch(/阻抗|模量|密度/)

    const match = flat.find((n) => n.id === 'acoustics-compose-impedance-match')
    expect(match?.formula?.expected).toBeCloseTo(0, 10)
    expect(match?.formula?.plainZh).toMatch(/残差|阻抗|匹配/)

    const lam = flat.find((n) => n.id === 'acoustics-compose-wavelength')
    expect(lam?.formula?.expr).toMatch(/lambda|omega|c/)
    expect(lam?.formula?.expected).toBeCloseTo(0.34, 10)
    expect(lam?.formula?.plainZh).toMatch(/波长/)

    const Tp = flat.find((n) => n.id === 'acoustics-compose-transmission')
    expect(Tp?.formula?.expr).toMatch(/Z2|Z1/)
    expect(Tp?.formula?.expected).toBeCloseTo(1, 10)
    expect(Tp?.formula?.plainZh).toMatch(/透射|阻抗/)

    const ppw = flat.find((n) => n.id === 'acoustics-compose-ppw')
    expect(ppw?.formula?.expr).toMatch(/lambda|dx/)
    expect(ppw?.formula?.expected).toBeCloseTo(34, 10)
    expect(ppw?.formula?.plainZh).toMatch(/波长|网格|分辨率/)

    const travel = flat.find((n) => n.id === 'acoustics-compose-travel-time')
    expect(travel?.formula?.expr).toMatch(/L \/ c|tau/)
    expect(travel?.formula?.expected).toBeCloseTo(1, 10)
    expect(travel?.formula?.plainZh).toMatch(/渡越|声速|路径/)

    const u = flat.find((n) => n.id === 'acoustics-compose-energy-density')
    expect(u?.formula?.expr).toMatch(/p \* p|rho|c/)
    expect(u?.formula?.expected).toBeCloseTo(
      (408 * 408) / (2 * 1.2 * 340 * 340),
      10,
    )
    expect(u?.formula?.plainZh).toMatch(/能量|声压|密度/)

    const cK = flat.find((n) => n.id === 'acoustics-compose-c-from-K-rho')
    expect(cK?.formula?.expr).toMatch(/sqrt/)
    expect(cK?.formula?.expected).toBeCloseTo(Math.sqrt(2.2e9 / 1000), 6)
    expect(cK?.formula?.plainZh).toMatch(/声速|模量|密度/)

    const rt = flat.find((n) => n.id === 'acoustics-compose-RT-closure')
    expect(rt?.formula?.expr).toMatch(/R|T/)
    expect(rt?.formula?.expected).toBeCloseTo(0, 10)
    expect(rt?.formula?.plainZh).toMatch(/反射|透射|残差|闭合/)

    const vPZ = flat.find((n) => n.id === 'acoustics-compose-v-from-p-Z')
    expect(vPZ?.formula?.expr).toMatch(/v|p|Z/)
    expect(vPZ?.formula?.expected).toBeCloseTo(1, 10)
    expect(vPZ?.formula?.plainZh).toMatch(/质点|声压|阻抗|合成/)

    const Zrc = flat.find((n) => n.id === 'acoustics-compose-Z-rho-c')
    expect(Zrc?.formula?.expr).toMatch(/rho|c/)
    expect(Zrc?.formula?.expected).toBeCloseTo(408, 10)
    expect(Zrc?.formula?.plainZh).toMatch(/阻抗|密度|声速|合成/)

    const Iuc = flat.find((n) => n.id === 'acoustics-compose-I-from-u-c')
    expect(Iuc?.formula?.expr).toMatch(/I|u|c/)
    expect(Iuc?.formula?.expected).toBeCloseTo(204, 10)
    expect(Iuc?.formula?.plainZh).toMatch(/声强|能量|声速/)

    const IuRes = flat.find((n) => n.id === 'acoustics-compose-I-u-residual')
    expect(IuRes?.formula?.expr).toMatch(/res|I|u/)
    expect(IuRes?.formula?.expected).toBeCloseTo(0, 10)
    expect(IuRes?.formula?.plainZh).toMatch(/残差|声强|能量|合同/)

    const cp = flat.find((n) => n.id === 'acoustics-compose-phase-speed')
    expect(cp?.formula?.expr).toMatch(/c_p|omega|k/)
    expect(cp?.formula?.expected).toBeCloseTo(340, 10)
    expect(cp?.formula?.plainZh).toMatch(/相速|角频率|波数|声速/)

    const dtMaxC = flat.find((n) => n.id === 'acoustics-compose-dt-max')
    expect(dtMaxC?.formula?.expr).toMatch(/dt_max|dx|c/)
    expect(dtMaxC?.formula?.expected).toBeCloseTo(1e-3 / 340, 12)
    expect(dtMaxC?.formula?.plainZh).toMatch(/时间步|网格|声速|合成/)

    const fLam = flat.find((n) => n.id === 'acoustics-compose-freq-from-lambda')
    expect(fLam?.formula?.expr).toMatch(/f|c|lambda/)
    expect(fLam?.formula?.expected).toBeCloseTo(1000, 10)
    expect(fLam?.formula?.plainZh).toMatch(/频率|声速|波长|合成/)

    // S28cj iuda-dense multi-CFL residual (wave35 residual compose expand)
    const cIudaSpan = flat.find(
      (n) => n.id === 'acoustics-compose-iuda-dense-cfl-span',
    )
    expect(cIudaSpan?.formula?.expr).toMatch(/cfl_hi|cfl_lo|span/)
    expect(cIudaSpan?.formula?.expected).toBeCloseTo(0.3, 10)
    expect(cIudaSpan?.formula?.plainZh).toMatch(/iuda|CFL|跨度/)

    const cThirtieth = flat.find(
      (n) => n.id === 'acoustics-compose-thirtieth-grid-ranking-honesty',
    )
    expect(cThirtieth?.formula?.expr).toMatch(/rank_ok/)
    expect(cThirtieth?.formula?.expected).toBeCloseTo(0, 10)
    expect(cThirtieth?.formula?.plainZh).toMatch(/thirtieth|ranking|诚实/)

    const cIudaDrop = flat.find(
      (n) => n.id === 'acoustics-compose-iuda-longer-drop',
    )
    expect(cIudaDrop?.formula?.expr).toMatch(/E_short|E_long|drop/)
    expect(cIudaDrop?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cIudaDrop?.formula?.plainZh).toMatch(/iuda|longer|下降/)

    const c29p = flat.find(
      (n) => n.id === 'acoustics-compose-twenty-ninth-longer-parity',
    )
    expect(c29p?.formula?.expr).toMatch(/parity_ok/)
    expect(c29p?.formula?.expected).toBeCloseTo(0, 10)
    expect(c29p?.formula?.plainZh).toMatch(/twenty-ninth|parity|诚实/)

    const cIudag = flat.find(
      (n) => n.id === 'acoustics-compose-iuda-dense-honesty-gate',
    )
    expect(cIudag?.formula?.expr).toMatch(/gate|c_rank|c_drop/)
    expect(cIudag?.formula?.expected).toBeCloseTo(1, 10)
    expect(cIudag?.formula?.plainZh).toMatch(/iuda-dense|包装|诚实|门/)

    // S28ck juda-dense multi-CFL residual (wave36 residual compose expand; bridges wave35)
    const cJudaSpan = flat.find(
      (n) => n.id === 'acoustics-compose-juda-dense-cfl-span',
    )
    expect(cJudaSpan?.formula?.expr).toMatch(/cfl_hi|cfl_lo|span/)
    expect(cJudaSpan?.formula?.expected).toBeCloseTo(0.3, 10)
    expect(cJudaSpan?.formula?.plainZh).toMatch(/juda|CFL|跨度/)

    const cThirtyFirst = flat.find(
      (n) => n.id === 'acoustics-compose-thirty-first-grid-ranking-honesty',
    )
    expect(cThirtyFirst?.formula?.expr).toMatch(/rank_ok/)
    expect(cThirtyFirst?.formula?.expected).toBeCloseTo(0, 10)
    expect(cThirtyFirst?.formula?.plainZh).toMatch(/thirty-first|ranking|诚实/)

    const cJudaDrop = flat.find(
      (n) => n.id === 'acoustics-compose-juda-longer-drop',
    )
    expect(cJudaDrop?.formula?.expr).toMatch(/E_short|E_long|drop/)
    expect(cJudaDrop?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cJudaDrop?.formula?.plainZh).toMatch(/juda|longer|下降/)

    const c30p = flat.find(
      (n) => n.id === 'acoustics-compose-thirtieth-longer-parity',
    )
    expect(c30p?.formula?.expr).toMatch(/parity_ok/)
    expect(c30p?.formula?.expected).toBeCloseTo(0, 10)
    expect(c30p?.formula?.plainZh).toMatch(/thirtieth|parity|诚实/)

    const cJudag = flat.find(
      (n) => n.id === 'acoustics-compose-juda-dense-honesty-gate',
    )
    expect(cJudag?.formula?.expr).toMatch(/gate|c_rank|c_drop/)
    expect(cJudag?.formula?.expected).toBeCloseTo(1, 10)
    expect(cJudag?.formula?.plainZh).toMatch(/juda-dense|包装|诚实|门/)

    const composeWithFormula = flat.filter(
      (n) => n.id.startsWith('acoustics-compose-') && n.formula,
    )
    expect(composeWithFormula.length).toBeGreaterThanOrEqual(28)
    for (const n of composeWithFormula) {
      expect(n.formula?.plainZh && n.formula.plainZh.length).toBeGreaterThan(4)
      expect(n.formula?.plainEn && n.formula.plainEn.length).toBeGreaterThan(4)
      expect(n.formula?.expected).toEqual(expect.any(Number))
      expect(Number.isFinite(n.formula!.expected as number)).toBe(true)
    }
  })

  it('acoustics enrichWithFormulaViews attaches plainZh on compose formulas', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-acoustics-3d'],
      layers: 'all',
    })
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const plane = enriched.find(
      (n) => n.id === 'acoustics-compose-plane-wave-pv' && n.formulaView,
    )
    expect(plane?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(plane?.formulaView?.expr).toMatch(/p|v/)
    const refl = enriched.find(
      (n) => n.id === 'acoustics-compose-reflection' && n.formulaView,
    )
    expect(refl?.formulaView?.plainZh).toMatch(/反射|阻抗/)
    const cfl = enriched.find(
      (n) => n.id === 'acoustics-compose-cfl-ratio' && n.formulaView,
    )
    expect(cfl?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const Zkr = enriched.find(
      (n) => n.id === 'acoustics-compose-Z-from-K-rho' && n.formulaView,
    )
    expect(Zkr?.formulaView?.plainZh).toMatch(/阻抗|模量|密度/)
    const Tp = enriched.find(
      (n) => n.id === 'acoustics-compose-transmission' && n.formulaView,
    )
    expect(Tp?.formulaView?.plainZh).toMatch(/透射|阻抗/)
    const ppw = enriched.find(
      (n) => n.id === 'acoustics-compose-ppw' && n.formulaView,
    )
    expect(ppw?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const energy = enriched.find(
      (n) => n.id === 'acoustics-compose-energy-density' && n.formulaView,
    )
    expect(energy?.formulaView?.plainZh).toMatch(/能量|声压/)
    const rt = enriched.find(
      (n) => n.id === 'acoustics-compose-RT-closure' && n.formulaView,
    )
    expect(rt?.formulaView?.plainZh).toMatch(/反射|透射|残差/)
    const vPZ = enriched.find(
      (n) => n.id === 'acoustics-compose-v-from-p-Z' && n.formulaView,
    )
    expect(vPZ?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(vPZ?.formulaView?.expr).toMatch(/v|p|Z/)
    const Iuc = enriched.find(
      (n) => n.id === 'acoustics-compose-I-from-u-c' && n.formulaView,
    )
    expect(Iuc?.formulaView?.plainZh).toMatch(/声强|能量|声速/)
    const IuRes = enriched.find(
      (n) => n.id === 'acoustics-compose-I-u-residual' && n.formulaView,
    )
    expect(IuRes?.formulaView?.plainZh).toMatch(/残差|声强|能量/)
    const cp = enriched.find(
      (n) => n.id === 'acoustics-compose-phase-speed' && n.formulaView,
    )
    expect(cp?.formulaView?.plainZh).toMatch(/相速|角频率|波数/)
    const fLam = enriched.find(
      (n) => n.id === 'acoustics-compose-freq-from-lambda' && n.formulaView,
    )
    expect(fLam?.formulaView?.plainZh).toMatch(/频率|声速|波长/)
    const iudaSpan = enriched.find(
      (n) =>
        n.id === 'acoustics-compose-iuda-dense-cfl-span' && n.formulaView,
    )
    expect(iudaSpan?.formulaView?.plainZh).toMatch(/iuda|CFL|跨度/)
    const iudag = enriched.find(
      (n) =>
        n.id === 'acoustics-compose-iuda-dense-honesty-gate' && n.formulaView,
    )
    expect(iudag?.formulaView?.plainZh).toMatch(/iuda-dense|包装|诚实|门/)
  })

  it('findMethodsByLink jobKind acoustics-3d', () => {
    const hit = findMethodsByLink({ jobKind: 'acoustics-3d' })
    expect(hit.some((m) => m.id === 'kind-acoustics-3d')).toBe(true)
  })

  it('parallel session includes acoustics with alfven and igbt', () => {
    const session = buildParallelExplainSession({
      methodIds: [
        'method-alfven-speed',
        'kind-electro-thermal-igbt',
        'kind-acoustics-3d',
      ],
      layers: ['principle', 'foundation'],
    })
    expect(session.methods).toHaveLength(3)
    expect(
      session.allSubExplains.some((n) => n.id === 'acoustics-foundation-c'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'acoustics-compose-plane-wave-pv'),
    ).toBe(true)
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const acousticsFormula = enriched.find(
      (n) => n.id === 'acoustics-foundation-impedance' && n.formulaView,
    )
    expect(acousticsFormula?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(acousticsFormula?.formulaView?.expr).toContain('Z')
  })

  it('md-lj drills method → principle → foundation with LJ formulas', () => {
    const tree = getMethodExplainTree('kind-md-lj')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    const layers = new Set(flat.map((n) => n.layer))
    expect(layers.has('method')).toBe(true)
    expect(layers.has('principle')).toBe(true)
    expect(layers.has('foundation')).toBe(true)
    expect(layers.has('engineering')).toBe(true)
    expect(layers.has('compose')).toBe(true)
    expect(layers.has('L0')).toBe(true)

    const foundations = flat.filter((n) => n.layer === 'foundation')
    expect(foundations.length).toBeGreaterThanOrEqual(10)
    const withFormula = foundations.filter((n) => n.formula)
    expect(withFormula.length).toBeGreaterThanOrEqual(9)
    for (const n of withFormula) {
      expect(n.formula?.plainZh && n.formula.plainZh.length).toBeGreaterThan(4)
    }

    const u = flat.find((n) => n.id === 'md-foundation-lj-u')
    expect(u?.formula?.expr).toMatch(/epsilon|sigma/i)
    expect(u?.formula?.expected).toBeCloseTo(-1, 10)
    expect(u?.formula?.plainZh).toMatch(/LJ|对势|势/)

    const f = flat.find((n) => n.id === 'md-foundation-lj-force')
    expect(f?.formula?.expr).toMatch(/24/)
    expect(f?.formula?.expected).toBe(24)

    const rmin = flat.find((n) => n.id === 'md-foundation-lj-rmin')
    expect(rmin?.formula?.expr).toMatch(/2\^|sigma/i)
    expect(rmin?.formula?.expected).toBeCloseTo(Math.pow(2, 1 / 6), 10)
    expect(rmin?.formula?.plainZh).toMatch(/势阱|最小|σ|sigma/i)

    const well = flat.find((n) => n.id === 'md-foundation-lj-well')
    expect(well?.formula?.expr).toMatch(/-epsilon|U_min/i)
    expect(well?.formula?.expected).toBeCloseTo(-1, 10)
    expect(well?.formula?.plainZh).toMatch(/阱|ε|对势/)

    const sr6 = flat.find((n) => n.id === 'md-foundation-lj-sr6')
    expect(sr6?.formula?.expr).toMatch(/sr6/)
    expect(sr6?.formula?.expected).toBeCloseTo(0, 10)
    expect(sr6?.formula?.plainZh).toMatch(/对势|中间|σ/)

    const feq = flat.find((n) => n.id === 'md-foundation-lj-force-eq')
    expect(feq?.formula?.expected).toBeCloseTo(0, 10)
    expect(feq?.formula?.plainZh).toMatch(/力|零|势阱/)

    const pairSum = flat.find((n) => n.id === 'md-foundation-lj-pair-sum')
    expect(pairSum?.formula?.expr).toMatch(/U12|U_tot/)
    expect(pairSum?.formula?.expected).toBeCloseTo(-3, 10)
    expect(pairSum?.formula?.plainZh).toMatch(/对势|求和|粒子对/)

    const verlet = flat.find((n) => n.id === 'md-foundation-verlet')
    expect(verlet?.formula?.expr).toMatch(/x_new|dt/)
    expect(verlet?.formula?.expected).toBeCloseTo(0.09, 10)
    expect(verlet?.formula?.plainZh).toMatch(/Verlet|位置/)

    const ke = flat.find((n) => n.id === 'md-foundation-ke')
    expect(ke?.formula?.expected).toBeCloseTo(9, 10)
    expect(ke?.formula?.plainZh).toMatch(/动能|质量/)

    const etot = flat.find((n) => n.id === 'md-foundation-etot')
    expect(etot?.formula?.expr).toMatch(/KE|U_tot/)
    expect(etot?.formula?.expected).toBeCloseTo(8, 10)
    expect(etot?.formula?.plainZh).toMatch(/动能|对势|总能/)

    const n3 = flat.find((n) => n.id === 'md-foundation-newton3')
    expect(n3?.formula?.expected).toBeCloseTo(0, 10)
    expect(n3?.formula?.plainZh).toMatch(/作用|反作用|力/)

    const nvtPrinciple = flat.find((n) => n.id === 'md-principle-nvt-npt')
    expect(nvtPrinciple?.layer).toBe('principle')
    expect(nvtPrinciple?.titleZh).toMatch(/NVT|NPT|平衡/)

    const fTke = flat.find((n) => n.id === 'md-foundation-T-from-ke')
    expect(fTke?.formula?.expr).toMatch(/KE|N_dof/)
    expect(fTke?.formula?.expected).toBeCloseTo((2 * 150) / 297, 10)
    expect(fTke?.formula?.plainZh).toMatch(/温度|动能|自由度/)

    const fNdof = flat.find((n) => n.id === 'md-foundation-Ndof')
    expect(fNdof?.formula?.expected).toBeCloseTo(297, 10)
    expect(fNdof?.formula?.plainZh).toMatch(/自由度|质心|3N/)

    const fLam = flat.find((n) => n.id === 'md-foundation-velocity-scale')
    expect(fLam?.formula?.expr).toMatch(/sqrt|T_target|T/)
    expect(fLam?.formula?.expected).toBeCloseTo(Math.sqrt(1 / 0.81), 10)
    expect(fLam?.formula?.plainZh).toMatch(/速度|缩放|温度/)

    const fBer = flat.find((n) => n.id === 'md-foundation-berendsen-lambda')
    expect(fBer?.formula?.expr).toMatch(/tau_T|dt/)
    expect(fBer?.formula?.expected).toBeCloseTo(
      Math.sqrt(1 + (0.001 / 0.1) * (1 / 0.81 - 1)),
      10,
    )
    expect(fBer?.formula?.plainZh).toMatch(/Berendsen|缩放|耦合/)

    const fTres = flat.find((n) => n.id === 'md-foundation-T-residual')
    expect(fTres?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(fTres?.formula?.plainZh).toMatch(/温度|残差|NVT|目标/)

    const fPkin = flat.find((n) => n.id === 'md-foundation-P-ideal')
    expect(fPkin?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(fPkin?.formula?.plainZh).toMatch(/压力|粒子|体积|温度/)

    const fPvir = flat.find((n) => n.id === 'md-foundation-P-virial')
    expect(fPvir?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(fPvir?.formula?.plainZh).toMatch(/维里|压力|动能/)

    const fPres = flat.find((n) => n.id === 'md-foundation-P-residual')
    expect(fPres?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(fPres?.formula?.plainZh).toMatch(/压力|残差|NPT|目标/)

    const fLang = flat.find((n) => n.id === 'md-foundation-langevin-drag')
    expect(fLang?.formula?.expected).toBeCloseTo(-2, 10)
    expect(fLang?.formula?.plainZh).toMatch(/Langevin|阻尼|摩擦/)

    const fVbar = flat.find((n) => n.id === 'md-foundation-V-barostat')
    expect(fVbar?.formula?.expected).toBeCloseTo(999, 10)
    expect(fVbar?.formula?.plainZh).toMatch(/体积|Berendsen|压力|耦合/)

    const eres = flat.find((n) => n.id === 'md-compose-energy-residual')
    expect(eres?.formula?.expected).toBeCloseTo(0.00125, 10)
    expect(eres?.formula?.plainZh).toMatch(/残差|能量/)

    const composePair = flat.find((n) => n.id === 'md-compose-pair-ke')
    expect(composePair?.formula?.expected).toBeCloseTo(1, 10)
    expect(composePair?.formula?.plainZh).toMatch(/动能|对势|合成/)

    const forceClose = flat.find((n) => n.id === 'md-compose-force-closure')
    expect(forceClose?.formula?.expected).toBeCloseTo(0, 10)
    expect(forceClose?.formula?.plainZh).toMatch(/力|Newton|作用|反作用/)

    const verletC = flat.find((n) => n.id === 'md-compose-verlet')
    expect(verletC?.formula?.expr).toMatch(/x_new|dt/)
    expect(verletC?.formula?.expected).toBeCloseTo(0.09, 10)
    expect(verletC?.formula?.plainZh).toMatch(/Verlet|位置/)

    const temp = flat.find((n) => n.id === 'md-compose-temperature')
    expect(temp?.formula?.expected).toBeCloseTo(3, 10)
    expect(temp?.formula?.plainZh).toMatch(/动能|温度|自由度/)

    const fscale = flat.find((n) => n.id === 'md-compose-pair-force-scale')
    expect(fscale?.formula?.expected).toBeCloseTo(24, 10)
    expect(fscale?.formula?.plainZh).toMatch(/力|ε|σ|LJ/)

    const keMv = flat.find((n) => n.id === 'md-compose-ke-from-mv')
    expect(keMv?.formula?.expr).toMatch(/0\.5|m|v/)
    expect(keMv?.formula?.expected).toBeCloseTo(9, 10)
    expect(keMv?.formula?.plainZh).toMatch(/动能|质量|速率/)

    const accel = flat.find((n) => n.id === 'md-compose-accel')
    expect(accel?.formula?.expr).toMatch(/F|m/)
    expect(accel?.formula?.expected).toBeCloseTo(12, 10)
    expect(accel?.formula?.plainZh).toMatch(/加速|力|质量|Verlet|LJ/)

    const cRmin = flat.find((n) => n.id === 'md-compose-rmin')
    expect(cRmin?.formula?.expr).toMatch(/2\^|sigma/i)
    expect(cRmin?.formula?.expected).toBeCloseTo(Math.pow(2, 1 / 6), 10)
    expect(cRmin?.formula?.plainZh).toMatch(/势阱|最小|σ|sigma|力/i)

    const cWell = flat.find((n) => n.id === 'md-compose-well')
    expect(cWell?.formula?.expr).toMatch(/-epsilon|U_min/i)
    expect(cWell?.formula?.expected).toBeCloseTo(-1, 10)
    expect(cWell?.formula?.plainZh).toMatch(/阱|ε|对势/)

    const cPair = flat.find((n) => n.id === 'md-compose-pair-sum')
    expect(cPair?.formula?.expr).toMatch(/U12|U_tot/)
    expect(cPair?.formula?.expected).toBeCloseTo(-3, 10)
    expect(cPair?.formula?.plainZh).toMatch(/对势|合成|动能|守恒/)

    const cFeq = flat.find((n) => n.id === 'md-compose-force-eq-residual')
    expect(cFeq?.formula?.expected).toBeCloseTo(0, 10)
    expect(cFeq?.formula?.plainZh).toMatch(/势阱|力|残差|零/)

    const cEtot = flat.find((n) => n.id === 'md-compose-etot')
    expect(cEtot?.formula?.expr).toMatch(/KE|U_tot/)
    expect(cEtot?.formula?.expected).toBeCloseTo(8, 10)
    expect(cEtot?.formula?.plainZh).toMatch(/动能|对势|守恒|总能|机械/)

    const sr6U = flat.find((n) => n.id === 'md-compose-sr6-u')
    expect(sr6U?.formula?.expr).toMatch(/sr6/)
    expect(sr6U?.formula?.expected).toBeCloseTo(0, 10)
    expect(sr6U?.formula?.plainZh).toMatch(/对势|中间|σ|阱/)

    const uZero = flat.find((n) => n.id === 'md-compose-u-zero-residual')
    expect(uZero?.formula?.expected).toBeCloseTo(0, 10)
    expect(uZero?.formula?.plainZh).toMatch(/零势|残差|σ/)

    const vHalf = flat.find((n) => n.id === 'md-compose-v-half')
    expect(vHalf?.formula?.expr).toMatch(/v_new|a|dt/)
    expect(vHalf?.formula?.expected).toBeCloseTo(0.8, 10)
    expect(vHalf?.formula?.plainZh).toMatch(/速度|加速|Verlet|动能/)

    const keT = flat.find((n) => n.id === 'md-compose-ke-T-residual')
    expect(keT?.formula?.expr).toMatch(/KE|N_dof|T/)
    expect(keT?.formula?.expected).toBeCloseTo(0, 10)
    expect(keT?.formula?.plainZh).toMatch(/动能|温度|残差/)

    const fMatch = flat.find((n) => n.id === 'md-compose-F-scale-match')
    expect(fMatch?.formula?.expr).toMatch(/24|epsilon|sigma/)
    expect(fMatch?.formula?.expected).toBeCloseTo(0, 10)
    expect(fMatch?.formula?.plainZh).toMatch(/力|残差|σ|24/)

    const nPairs = flat.find((n) => n.id === 'md-compose-n-pairs')
    expect(nPairs?.formula?.expr).toMatch(/N_pairs|N/)
    expect(nPairs?.formula?.expected).toBeCloseTo(3, 10)
    expect(nPairs?.formula?.plainZh).toMatch(/对|粒子|组合|求和/)

    const cNdof = flat.find((n) => n.id === 'md-compose-Ndof')
    expect(cNdof?.formula?.expected).toBeCloseTo(297, 10)
    expect(cNdof?.formula?.plainZh).toMatch(/自由度|粒子|温度|NVT/)

    const cTke = flat.find((n) => n.id === 'md-compose-T-from-ke')
    expect(cTke?.formula?.expected).toBeCloseTo((2 * 150) / 297, 10)
    expect(cTke?.formula?.plainZh).toMatch(/温度|动能|NVT|热浴/)

    const cLam = flat.find((n) => n.id === 'md-compose-velocity-scale')
    expect(cLam?.formula?.expected).toBeCloseTo(Math.sqrt(1 / 0.81), 10)
    expect(cLam?.formula?.plainZh).toMatch(/速度|缩放|温度/)

    const cVres = flat.find((n) => n.id === 'md-compose-v-rescale')
    expect(cVres?.formula?.expected).toBeCloseTo(Math.sqrt(1 / 0.81), 10)
    expect(cVres?.formula?.plainZh).toMatch(/速度|缩放|热浴/)

    const cKeScale = flat.find((n) => n.id === 'md-compose-ke-after-scale')
    expect(cKeScale?.formula?.expected).toBeCloseTo(1, 10)
    expect(cKeScale?.formula?.plainZh).toMatch(/动能|缩放|温度/)

    const cBer = flat.find((n) => n.id === 'md-compose-berendsen-lambda')
    expect(cBer?.formula?.expected).toBeCloseTo(
      Math.sqrt(1 + (0.001 / 0.1) * (1 / 0.81 - 1)),
      10,
    )
    expect(cBer?.formula?.plainZh).toMatch(/Berendsen|缩放|耦合|温度/)

    const cTres = flat.find((n) => n.id === 'md-compose-T-residual')
    expect(cTres?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(cTres?.formula?.plainZh).toMatch(/NVT|温度|残差|平衡|诚实/)

    const cTwin = flat.find((n) => n.id === 'md-compose-T-window-mean')
    expect(cTwin?.formula?.expected).toBeCloseTo(1.01, 10)
    expect(cTwin?.formula?.plainZh).toMatch(/平衡|窗|平均|温度/)

    const cLang = flat.find((n) => n.id === 'md-compose-langevin-drag')
    expect(cLang?.formula?.expected).toBeCloseTo(-2, 10)
    expect(cLang?.formula?.plainZh).toMatch(/Langevin|阻尼|摩擦|LJ/)

    const cPkin = flat.find((n) => n.id === 'md-compose-P-ideal')
    expect(cPkin?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(cPkin?.formula?.plainZh).toMatch(/压力|动能|NPT|体积/)

    const cPvir = flat.find((n) => n.id === 'md-compose-P-virial')
    expect(cPvir?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(cPvir?.formula?.plainZh).toMatch(/维里|压力|NPT/)

    const cPres = flat.find((n) => n.id === 'md-compose-P-residual')
    expect(cPres?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cPres?.formula?.plainZh).toMatch(/NPT|压力|残差|平衡|诚实/)

    const cVbar = flat.find((n) => n.id === 'md-compose-V-barostat')
    expect(cVbar?.formula?.expected).toBeCloseTo(999, 10)
    expect(cVbar?.formula?.plainZh).toMatch(/体积|NPT|压力|耦合/)

    const cRho = flat.find((n) => n.id === 'md-compose-rho')
    expect(cRho?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(cRho?.formula?.plainZh).toMatch(/密度|粒子|体积|NPT/)

    const cLbox = flat.find((n) => n.id === 'md-compose-L-box')
    expect(cLbox?.formula?.expected).toBeCloseTo(10, 10)
    expect(cLbox?.formula?.plainZh).toMatch(/盒|边|体积|立方/)

    const cPrhoT = flat.find((n) => n.id === 'md-compose-P-rho-T')
    expect(cPrhoT?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(cPrhoT?.formula?.plainZh).toMatch(/压力|密度|温度|闭合/)

    const cTmatch = flat.find((n) => n.id === 'md-compose-T-match-residual')
    expect(cTmatch?.formula?.expected).toBeCloseTo(0, 10)
    expect(cTmatch?.formula?.plainZh).toMatch(/缩放|温度|匹配|残差/)

    const cDetH = flat.find((n) => n.id === 'md-compose-detH')
    expect(cDetH?.formula?.expr).toMatch(/Lx|Ly|Lz|V/)
    expect(cDetH?.formula?.expected).toBeCloseTo(1000, 10)
    expect(cDetH?.formula?.plainZh).toMatch(/体积|三斜|边|det|正交/)

    const cHalf = flat.find((n) => n.id === 'md-compose-half-spacing')
    expect(cHalf?.formula?.expr).toMatch(/half|L/)
    expect(cHalf?.formula?.expected).toBeCloseTo(5, 10)
    expect(cHalf?.formula?.plainZh).toMatch(/半|面间距|截断|立方/)

    const cRcut = flat.find((n) => n.id === 'md-compose-rCut-safe-residual')
    expect(cRcut?.formula?.expr).toMatch(/r_cut|half|max/)
    expect(cRcut?.formula?.expected).toBeCloseTo(0, 10)
    expect(cRcut?.formula?.plainZh).toMatch(/截断|半|残差|安全/)

    const cImg = flat.find((n) => n.id === 'md-compose-abs-lattice-count')
    expect(cImg?.formula?.expr).toMatch(/range|2/)
    expect(cImg?.formula?.expected).toBeCloseTo(27, 10)
    expect(cImg?.formula?.plainZh).toMatch(/邻格|像|绝对|最小镜像/)

    const cPh = flat.find((n) => n.id === 'md-compose-p-hydro')
    expect(cPh?.formula?.expr).toMatch(/Wxx|Wyy|Wzz|V/)
    expect(cPh?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(cPh?.formula?.plainZh).toMatch(/静水|维里|体积|三斜/)

    const cVsym = flat.find((n) => n.id === 'md-compose-virial-sym-residual')
    expect(cVsym?.formula?.expr).toMatch(/Wxy|Wyx/)
    expect(cVsym?.formula?.expected).toBeCloseTo(0, 10)
    expect(cVsym?.formula?.plainZh).toMatch(/维里|对称|残差/)

    const cCub = flat.find((n) => n.id === 'md-compose-cubic-match-residual')
    expect(cCub?.formula?.expr).toMatch(/d_tri|d_cub/)
    expect(cCub?.formula?.expected).toBeCloseTo(0, 10)
    expect(cCub?.formula?.plainZh).toMatch(/立方|三斜|最小镜像|残差/)

    const cMuV = flat.find((n) => n.id === 'md-compose-mu-volume')
    expect(cMuV?.formula?.expr).toMatch(/mu|V/)
    expect(cMuV?.formula?.expected).toBeCloseTo(1.01 ** 3 * 1000, 10)
    expect(cMuV?.formula?.plainZh).toMatch(/μ|体积|各向同性|缩放/)

    const cSkin = flat.find((n) => n.id === 'md-compose-skin-gate-residual')
    expect(cSkin?.formula?.expr).toMatch(/d_max|skin|max/)
    expect(cSkin?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSkin?.formula?.plainZh).toMatch(/skin|Verlet|重建|残差/)

    const cList = flat.find((n) => n.id === 'md-compose-list-ratio')
    expect(cList?.formula?.expr).toMatch(/n_listed|n_all/)
    expect(cList?.formula?.expected).toBeCloseTo(12 / 45, 10)
    expect(cList?.formula?.plainZh).toMatch(/邻表|密度|列表|对/)

    const cDualT = flat.find((n) => n.id === 'md-compose-dual-T-window')
    expect(cDualT?.formula?.expr).toMatch(/T_early|T_trail|T_star/)
    expect(cDualT?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDualT?.formula?.plainZh).toMatch(/双窗|温度|诚实|残差/)

    const cDualV = flat.find((n) => n.id === 'md-compose-dual-V-window')
    expect(cDualV?.formula?.expr).toMatch(/V_early|V_trail|V0/)
    expect(cDualV?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDualV?.formula?.plainZh).toMatch(/双窗|体积|诚实|残差/)

    const cDualP = flat.find((n) => n.id === 'md-compose-dual-hydro-window')
    expect(cDualP?.formula?.expr).toMatch(/P_early|P_trail|P_star/)
    expect(cDualP?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDualP?.formula?.plainZh).toMatch(/双窗|静水|诚实|残差/)

    const cSn = flat.find((n) => n.id === 'md-compose-shear-norm')
    expect(cSn?.formula?.expr).toMatch(/sxy|sxz|syz|sqrt/)
    expect(cSn?.formula?.expected).toBeCloseTo(0.03, 10)
    expect(cSn?.formula?.plainZh).toMatch(/剪切|范数|应力/)

    const cDualSn = flat.find((n) => n.id === 'md-compose-dual-shear-norm')
    expect(cDualSn?.formula?.expr).toMatch(/sn_early|sn_trail/)
    expect(cDualSn?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDualSn?.formula?.plainZh).toMatch(/双窗|剪切|诚实|残差/)

    const cAbsFrac = flat.find((n) => n.id === 'md-compose-abs-frac-agree-residual')
    expect(cAbsFrac?.formula?.expr).toMatch(/d_abs|d_frac/)
    expect(cAbsFrac?.formula?.expected).toBeCloseTo(0, 10)
    expect(cAbsFrac?.formula?.plainZh).toMatch(/绝对|分数|最小镜像|残差/)

    const cHscale = flat.find((n) => n.id === 'md-compose-h-scale')
    expect(cHscale?.formula?.expr).toMatch(/mu|L/)
    expect(cHscale?.formula?.expected).toBeCloseTo(10.1, 10)
    expect(cHscale?.formula?.plainZh).toMatch(/μ|边长|缩放|各向同性/)

    const cTripleT = flat.find((n) => n.id === 'md-compose-triple-T-window')
    expect(cTripleT?.formula?.expr).toMatch(/T_early|T_mid|T_trail/)
    expect(cTripleT?.formula?.expected).toBeCloseTo(0, 10)
    expect(cTripleT?.formula?.plainZh).toMatch(/三窗|温度|诚实|残差/)

    const cAbsCell = flat.find((n) => n.id === 'md-compose-abs-cell-U-residual')
    expect(cAbsCell?.formula?.expr).toMatch(/U_abs|U_cell/)
    expect(cAbsCell?.formula?.expected).toBeCloseTo(0, 10)
    expect(cAbsCell?.formula?.plainZh).toMatch(/绝对|cell|能量|残差|对势/)

    // S29ca mad↔min dual gap + Minkowski-4 + Canberra + clad floors (wave35 residual compose expand)
    const cMadMin = flat.find((n) => n.id === 'md-compose-mad-min-gap')
    expect(cMadMin?.formula?.expr).toMatch(/madMinGap|mad|pairwise_min/)
    expect(cMadMin?.formula?.expected).toBeCloseTo(0, 10)
    expect(cMadMin?.formula?.plainZh).toMatch(/mad|min|对偶|间隙/)

    const cM4 = flat.find((n) => n.id === 'md-compose-minkowski4-dual')
    expect(cM4?.formula?.expr).toMatch(/M4|d1|d2|d3/)
    expect(cM4?.formula?.expected).toBeCloseTo(0, 10)
    expect(cM4?.formula?.plainZh).toMatch(/Minkowski|四次方/)

    const cCan = flat.find((n) => n.id === 'md-compose-canberra-dual')
    expect(cCan?.formula?.expr).toMatch(/Can|d1|e/)
    expect(cCan?.formula?.expected).toBeCloseTo(0, 10)
    expect(cCan?.formula?.plainZh).toMatch(/Canberra|相对/)

    const cCladG = flat.find((n) => n.id === 'md-compose-clad-floors-gate')
    expect(cCladG?.formula?.expr).toMatch(/gate|c_madMin|c_M4/)
    expect(cCladG?.formula?.expected).toBeCloseTo(1, 10)
    expect(cCladG?.formula?.plainZh).toMatch(/clad|floors|诚实|门/)

    const cClad = flat.find(
      (n) => n.id === 'md-compose-equilibration-clad-honest',
    )
    expect(cClad?.formula?.expr).toMatch(/clad|c_mw|c_floors/)
    expect(cClad?.formula?.expected).toBeCloseTo(1, 10)
    expect(cClad?.formula?.plainZh).toMatch(/clad|multi-window|honest/)

    // S29cb max↔min dual + Cosine + Bray–Curtis + plated honesty (wave36 residual compose expand; bridges wave35)
    const cMaxMin = flat.find((n) => n.id === 'md-compose-max-min-gap')
    expect(cMaxMin?.formula?.expr).toMatch(/maxMinGap|pairwise_max|pairwise_min/)
    expect(cMaxMin?.formula?.expected).toBeCloseTo(0, 10)
    expect(cMaxMin?.formula?.plainZh).toMatch(/max|min|对偶|间隙/)

    const cCos = flat.find((n) => n.id === 'md-compose-cosine-dual')
    expect(cCos?.formula?.expr).toMatch(/Cos|dot|norm/)
    expect(cCos?.formula?.expected).toBeCloseTo(0, 10)
    expect(cCos?.formula?.plainZh).toMatch(/Cosine|余弦/)

    const cBc = flat.find((n) => n.id === 'md-compose-bray-curtis-dual')
    expect(cBc?.formula?.expr).toMatch(/BC|d1|s1/)
    expect(cBc?.formula?.expected).toBeCloseTo(0, 10)
    expect(cBc?.formula?.plainZh).toMatch(/Bray|Curtis/)

    const cPlatedG = flat.find((n) => n.id === 'md-compose-plated-floors-gate')
    expect(cPlatedG?.formula?.expr).toMatch(/gate|c_maxMin|c_cos|c_bc/)
    expect(cPlatedG?.formula?.expected).toBeCloseTo(1, 10)
    expect(cPlatedG?.formula?.plainZh).toMatch(/plated|floors|诚实|门/)

    const cPlated = flat.find(
      (n) => n.id === 'md-compose-equilibration-plated-honest',
    )
    expect(cPlated?.formula?.expr).toMatch(/plated|c_mw|c_floors/)
    expect(cPlated?.formula?.expected).toBeCloseTo(1, 10)
    expect(cPlated?.formula?.plainZh).toMatch(/plated|multi-window|honest/)

    const composeWithFormula = flat.filter(
      (n) => n.id.startsWith('md-compose-') && n.formula,
    )
    expect(composeWithFormula.length).toBeGreaterThanOrEqual(62)
    for (const n of composeWithFormula) {
      expect(n.formula?.plainZh && n.formula.plainZh.length).toBeGreaterThan(4)
      expect(n.formula?.plainEn && n.formula.plainEn.length).toBeGreaterThan(4)
      expect(n.formula?.expected).toEqual(expect.any(Number))
      expect(Number.isFinite(n.formula!.expected as number)).toBe(true)
    }
  })

  it('md-lj enrichWithFormulaViews attaches plainZh on pair-energy foundations', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-md-lj'],
      layers: 'all',
    })
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const pairSum = enriched.find(
      (n) => n.id === 'md-foundation-lj-pair-sum' && n.formulaView,
    )
    expect(pairSum?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(pairSum?.formulaView?.expr).toMatch(/U_tot|U12/)
    const well = enriched.find(
      (n) => n.id === 'md-foundation-lj-well' && n.formulaView,
    )
    expect(well?.formulaView?.plainZh).toMatch(/阱|ε|对势/)
    const eres = enriched.find(
      (n) => n.id === 'md-compose-energy-residual' && n.formulaView,
    )
    expect(eres?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const forceClose = enriched.find(
      (n) => n.id === 'md-compose-force-closure' && n.formulaView,
    )
    expect(forceClose?.formulaView?.plainZh).toMatch(/力|Newton|作用|反作用/)
    const temp = enriched.find(
      (n) => n.id === 'md-compose-temperature' && n.formulaView,
    )
    expect(temp?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const keMv = enriched.find(
      (n) => n.id === 'md-compose-ke-from-mv' && n.formulaView,
    )
    expect(keMv?.formulaView?.plainZh).toMatch(/动能|质量|速率/)
    const accel = enriched.find(
      (n) => n.id === 'md-compose-accel' && n.formulaView,
    )
    expect(accel?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(accel?.formulaView?.expr).toMatch(/F|m/)
    const cEtot = enriched.find(
      (n) => n.id === 'md-compose-etot' && n.formulaView,
    )
    expect(cEtot?.formulaView?.plainZh).toMatch(/动能|对势|守恒|总能|机械/)
    const cRmin = enriched.find(
      (n) => n.id === 'md-compose-rmin' && n.formulaView,
    )
    expect(cRmin?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const sr6U = enriched.find(
      (n) => n.id === 'md-compose-sr6-u' && n.formulaView,
    )
    expect(sr6U?.formulaView?.plainZh).toMatch(/对势|中间|σ|阱/)
    expect(sr6U?.formulaView?.expr).toMatch(/sr6/)
    const vHalf = enriched.find(
      (n) => n.id === 'md-compose-v-half' && n.formulaView,
    )
    expect(vHalf?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(vHalf?.formulaView?.expr).toMatch(/v_new|a|dt/)
    const keT = enriched.find(
      (n) => n.id === 'md-compose-ke-T-residual' && n.formulaView,
    )
    expect(keT?.formulaView?.plainZh).toMatch(/动能|温度|残差/)
    const fMatch = enriched.find(
      (n) => n.id === 'md-compose-F-scale-match' && n.formulaView,
    )
    expect(fMatch?.formulaView?.plainZh).toMatch(/力|残差/)
    const nPairs = enriched.find(
      (n) => n.id === 'md-compose-n-pairs' && n.formulaView,
    )
    expect(nPairs?.formulaView?.plainZh).toMatch(/对|粒子|组合|求和/)
    const cTres = enriched.find(
      (n) => n.id === 'md-compose-T-residual' && n.formulaView,
    )
    expect(cTres?.formulaView?.plainZh).toMatch(/NVT|温度|残差|平衡|诚实/)
    const cPres = enriched.find(
      (n) => n.id === 'md-compose-P-residual' && n.formulaView,
    )
    expect(cPres?.formulaView?.plainZh).toMatch(/NPT|压力|残差|平衡|诚实/)
    const cBer = enriched.find(
      (n) => n.id === 'md-compose-berendsen-lambda' && n.formulaView,
    )
    expect(cBer?.formulaView?.plainZh).toMatch(/Berendsen|缩放|耦合/)
    const cVbar = enriched.find(
      (n) => n.id === 'md-compose-V-barostat' && n.formulaView,
    )
    expect(cVbar?.formulaView?.plainZh).toMatch(/体积|NPT|压力/)
    const cLang = enriched.find(
      (n) => n.id === 'md-compose-langevin-drag' && n.formulaView,
    )
    expect(cLang?.formulaView?.plainZh).toMatch(/Langevin|阻尼/)
    const cPvir = enriched.find(
      (n) => n.id === 'md-compose-P-virial' && n.formulaView,
    )
    expect(cPvir?.formulaView?.plainZh).toMatch(/维里|压力/)
    const detH = enriched.find(
      (n) => n.id === 'md-compose-detH' && n.formulaView,
    )
    expect(detH?.formulaView?.plainZh).toMatch(/体积|三斜|边/)
    const dualT = enriched.find(
      (n) => n.id === 'md-compose-dual-T-window' && n.formulaView,
    )
    expect(dualT?.formulaView?.plainZh).toMatch(/双窗|温度|诚实/)
    const halfSp = enriched.find(
      (n) => n.id === 'md-compose-half-spacing' && n.formulaView,
    )
    expect(halfSp?.formulaView?.plainZh).toMatch(/半|面间距|截断/)
    const pHydro = enriched.find(
      (n) => n.id === 'md-compose-p-hydro' && n.formulaView,
    )
    expect(pHydro?.formulaView?.plainZh).toMatch(/静水|维里/)
    const shearN = enriched.find(
      (n) => n.id === 'md-compose-shear-norm' && n.formulaView,
    )
    expect(shearN?.formulaView?.plainZh).toMatch(/剪切|范数/)
    const absCell = enriched.find(
      (n) => n.id === 'md-compose-abs-cell-U-residual' && n.formulaView,
    )
    expect(absCell?.formulaView?.plainZh).toMatch(/绝对|cell|能量|残差/)
    const madMin = enriched.find(
      (n) => n.id === 'md-compose-mad-min-gap' && n.formulaView,
    )
    expect(madMin?.formulaView?.plainZh).toMatch(/mad|min|对偶|间隙/)
    const cladG = enriched.find(
      (n) => n.id === 'md-compose-clad-floors-gate' && n.formulaView,
    )
    expect(cladG?.formulaView?.plainZh).toMatch(/clad|floors|诚实|门/)
  })

  it('findMethodsByLink jobKind md-batch', () => {
    const hit = findMethodsByLink({ jobKind: 'md-batch' })
    expect(hit.some((m) => m.id === 'kind-md-lj')).toBe(true)
  })

  it('electro-thermal-igbt drills method → principle → foundation with Foster formulas', () => {
    const tree = getMethodExplainTree('kind-electro-thermal-igbt')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    const layers = new Set(flat.map((n) => n.layer))
    expect(layers.has('method')).toBe(true)
    expect(layers.has('principle')).toBe(true)
    expect(layers.has('foundation')).toBe(true)
    expect(layers.has('engineering')).toBe(true)
    expect(layers.has('compose')).toBe(true)
    expect(layers.has('L0')).toBe(true)

    const rth = flat.find((n) => n.id === 'igbt-foundation-rth')
    expect(rth?.formula?.expr).toBe('dT = P * Rth')
    expect(rth?.formula?.expected).toBe(50)
    expect(rth?.formula?.plainZh).toMatch(/温升|热阻/)

    const tau = flat.find((n) => n.id === 'igbt-foundation-tau')
    expect(tau?.formula?.expr).toBe('tau = R * C')
    expect(tau?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(tau?.formula?.plainZh).toMatch(/时间常数|热阻|热容/)

    const step = flat.find((n) => n.id === 'igbt-foundation-step')
    expect(step?.formula?.expr).toMatch(/exp/)
    expect(step?.formula?.expected).toBeCloseTo(
      100 * 0.5 * (1 - Math.exp(-1)),
      10,
    )
    expect(step?.formula?.plainZh).toMatch(/Foster|阶跃|温升/)

    const sum = flat.find((n) => n.id === 'igbt-foundation-rth-sum')
    expect(sum?.formula?.expr).toMatch(/R1 \+ R2 \+ R3/)
    expect(sum?.formula?.expected).toBeCloseTo(0.5, 10)

    const tj = flat.find((n) => n.id === 'igbt-foundation-tj')
    expect(tj?.formula?.expr).toBe('Tj = Tref + dT')
    expect(tj?.formula?.expected).toBe(75)
    expect(tj?.formula?.plainZh).toMatch(/结温/)

    const cSteady = flat.find((n) => n.id === 'igbt-compose-steady-dT')
    expect(cSteady?.formula?.expr).toMatch(/P \* Rth/)
    expect(cSteady?.formula?.expected).toBeCloseTo(50, 10)
    expect(cSteady?.formula?.plainZh).toMatch(/温升|热阻|功率/)

    const cTj = flat.find((n) => n.id === 'igbt-compose-tj')
    expect(cTj?.formula?.expr).toMatch(/Tref|Rth/)
    expect(cTj?.formula?.expected).toBeCloseTo(75, 10)
    expect(cTj?.formula?.plainZh).toMatch(/结温|热阻/)

    const cStep = flat.find((n) => n.id === 'igbt-compose-step-sum')
    expect(cStep?.formula?.expr).toMatch(/exp|R1|tau/)
    expect(cStep?.formula?.expected).toBeCloseTo(
      100 * (0.2 * (1 - Math.exp(-1)) + 0.3 * (1 - Math.exp(-0.1))),
      10,
    )
    expect(cStep?.formula?.plainZh).toMatch(/Foster|阶跃|支路/)

    const cTau = flat.find((n) => n.id === 'igbt-compose-tau')
    expect(cTau?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(cTau?.formula?.plainZh).toMatch(/时间常数|热阻|热容/)

    const cMatch = flat.find((n) => n.id === 'igbt-compose-rth-match')
    expect(cMatch?.formula?.expected).toBeCloseTo(0, 10)
    expect(cMatch?.formula?.plainZh).toMatch(/残差|热阻|匹配/)

    const cLoss = flat.find((n) => n.id === 'igbt-compose-loss-inject')
    expect(cLoss?.formula?.expected).toBeCloseTo(100, 10)
    expect(cLoss?.formula?.plainZh).toMatch(/损耗|注入|导通|开关/)

    const cRthSum = flat.find((n) => n.id === 'igbt-compose-rth-sum')
    expect(cRthSum?.formula?.expr).toMatch(/R1 \+ R2 \+ R3/)
    expect(cRthSum?.formula?.expected).toBeCloseTo(0.5, 10)
    expect(cRthSum?.formula?.plainZh).toMatch(/热阻|支路|合成/)

    const cZth = flat.find((n) => n.id === 'igbt-compose-zth')
    expect(cZth?.formula?.expr).toMatch(/exp|R/)
    expect(cZth?.formula?.expected).toBeCloseTo(0.5 * (1 - Math.exp(-1)), 10)
    expect(cZth?.formula?.plainZh).toMatch(/热阻抗|指数|热阻/)

    const c63 = flat.find((n) => n.id === 'igbt-compose-step-63')
    expect(c63?.formula?.expected).toBeCloseTo(
      100 * 0.5 * (1 - Math.exp(-1)),
      10,
    )
    expect(c63?.formula?.plainZh).toMatch(/时间常数|63|稳态|阶跃/)

    const cC = flat.find((n) => n.id === 'igbt-compose-C-from-tau')
    expect(cC?.formula?.expr).toMatch(/tau \/ R|C =/)
    expect(cC?.formula?.expected).toBeCloseTo(0.5, 10)
    expect(cC?.formula?.plainZh).toMatch(/热容|时间常数|热阻/)

    const cPsw = flat.find((n) => n.id === 'igbt-compose-psw')
    expect(cPsw?.formula?.expr).toMatch(/Eon|Eoff|fsw/)
    expect(cPsw?.formula?.expected).toBeCloseTo(20, 10)
    expect(cPsw?.formula?.plainZh).toMatch(/开关|频率|能量/)

    const cPcond = flat.find((n) => n.id === 'igbt-compose-pcond')
    expect(cPcond?.formula?.expr).toMatch(/I \* Vce/)
    expect(cPcond?.formula?.expected).toBeCloseTo(80, 10)
    expect(cPcond?.formula?.plainZh).toMatch(/导通|电流|压降/)

    const cDuty = flat.find((n) => n.id === 'igbt-compose-duty-avg')
    expect(cDuty?.formula?.expr).toMatch(/Ppeak|D/)
    expect(cDuty?.formula?.expected).toBeCloseTo(100, 10)
    expect(cDuty?.formula?.plainZh).toMatch(/占空|平均|峰值/)

    const cQ = flat.find((n) => n.id === 'igbt-compose-thermal-energy')
    expect(cQ?.formula?.expr).toMatch(/C \* dT/)
    expect(cQ?.formula?.expected).toBeCloseTo(25, 10)
    expect(cQ?.formula?.plainZh).toMatch(/热容|温升|储能|能量/)

    const cStepRes = flat.find((n) => n.id === 'igbt-compose-step-steady-residual')
    expect(cStepRes?.formula?.expected).toBeCloseTo(0, 10)
    expect(cStepRes?.formula?.plainZh).toMatch(/残差|稳态|阶跃/)

    const cDtZ = flat.find((n) => n.id === 'igbt-compose-dT-from-Zth')
    expect(cDtZ?.formula?.expr).toMatch(/P \* Zth/)
    expect(cDtZ?.formula?.expected).toBeCloseTo(
      100 * 0.5 * (1 - Math.exp(-1)),
      10,
    )
    expect(cDtZ?.formula?.plainZh).toMatch(/温升|功率|热阻抗/)

    const cZthSum = flat.find((n) => n.id === 'igbt-compose-zth-sum')
    expect(cZthSum?.formula?.expr).toMatch(/R1|exp|tau/)
    expect(cZthSum?.formula?.expected).toBeCloseTo(
      0.2 * (1 - Math.exp(-1)) + 0.3 * (1 - Math.exp(-0.1)),
      10,
    )
    expect(cZthSum?.formula?.plainZh).toMatch(/多层|热阻抗|支路|指数/)

    const cRinv = flat.find((n) => n.id === 'igbt-compose-Rth-invert')
    expect(cRinv?.formula?.expr).toMatch(/dT \/ P|Rth =/)
    expect(cRinv?.formula?.expected).toBeCloseTo(0.5, 10)
    expect(cRinv?.formula?.plainZh).toMatch(/热阻|温升|功率/)

    const cFull = flat.find((n) => n.id === 'igbt-compose-full-loss-chain')
    expect(cFull?.formula?.expr).toMatch(/I \* Vce|Eon|fsw/)
    expect(cFull?.formula?.expected).toBeCloseTo(100, 10)
    expect(cFull?.formula?.plainZh).toMatch(/损耗|导通|开关|占空/)

    const cPcondD = flat.find((n) => n.id === 'igbt-compose-pcond-duty')
    expect(cPcondD?.formula?.expr).toMatch(/I \* Vce \* D/)
    expect(cPcondD?.formula?.expected).toBeCloseTo(80, 10)
    expect(cPcondD?.formula?.plainZh).toMatch(/导通|占空|电流/)

    const cEsw = flat.find((n) => n.id === 'igbt-compose-Esw')
    expect(cEsw?.formula?.expr).toMatch(/Eon \+ Eoff/)
    expect(cEsw?.formula?.expected).toBeCloseTo(0.002, 10)
    expect(cEsw?.formula?.plainZh).toMatch(/开关|能量|开通|关断/)

    const cSlope = flat.find((n) => n.id === 'igbt-compose-initial-slope')
    expect(cSlope?.formula?.expr).toMatch(/P \/ C/)
    expect(cSlope?.formula?.expected).toBeCloseTo(200, 10)
    expect(cSlope?.formula?.plainZh).toMatch(/斜率|功率|热容/)

    const cAlpha = flat.find((n) => n.id === 'igbt-compose-progress-alpha')
    expect(cAlpha?.formula?.expr).toMatch(/exp/)
    expect(cAlpha?.formula?.expected).toBeCloseTo(1 - Math.exp(-1), 10)
    expect(cAlpha?.formula?.plainZh).toMatch(/进度|指数|时间/)

    const cRja = flat.find((n) => n.id === 'igbt-compose-Rja-chain')
    expect(cRja?.formula?.expr).toMatch(/Rjc \+ Rca/)
    expect(cRja?.formula?.expected).toBeCloseTo(0.5, 10)
    expect(cRja?.formula?.plainZh).toMatch(/热阻|结|壳|环境/)

    const cMargin = flat.find((n) => n.id === 'igbt-compose-tj-margin')
    expect(cMargin?.formula?.expr).toMatch(/Tmax - Tj/)
    expect(cMargin?.formula?.expected).toBeCloseTo(75, 10)
    expect(cMargin?.formula?.plainZh).toMatch(/裕度|结温/)

    const cTauMatch = flat.find((n) => n.id === 'igbt-compose-tau-match')
    expect(cTauMatch?.formula?.expected).toBeCloseTo(0, 10)
    expect(cTauMatch?.formula?.plainZh).toMatch(/时间常数|残差|匹配/)

    const cZinf = flat.find((n) => n.id === 'igbt-compose-zth-inf-residual')
    expect(cZinf?.formula?.expected).toBeCloseTo(0, 10)
    expect(cZinf?.formula?.plainZh).toMatch(/热阻抗|热阻|残差/)

    const cPulse = flat.find((n) => n.id === 'igbt-compose-pulse-energy')
    expect(cPulse?.formula?.expr).toMatch(/P \* t_on/)
    expect(cPulse?.formula?.expected).toBeCloseTo(1, 10)
    expect(cPulse?.formula?.plainZh).toMatch(/脉冲|能量|功率/)

    // S24o–S24bc multi-pulse duty / Dragomir dual residual packaging (wave27 residual compose expand)
    const cRms = flat.find((n) => n.id === 'igbt-compose-duty-rms')
    expect(cRms?.formula?.expr).toMatch(/Ppeak|sqrt|D|P_rms/)
    expect(cRms?.formula?.expected).toBeCloseTo(50, 10)
    expect(cRms?.formula?.plainZh).toMatch(/占空|RMS|峰值|平方根/)

    const cCrest = flat.find((n) => n.id === 'igbt-compose-duty-crest')
    expect(cCrest?.formula?.expr).toMatch(/crest|sqrt|D/)
    expect(cCrest?.formula?.expected).toBeCloseTo(2, 10)
    expect(cCrest?.formula?.plainZh).toMatch(/波峰|占空|平方根/)

    const cForm = flat.find((n) => n.id === 'igbt-compose-duty-form')
    expect(cForm?.formula?.expr).toMatch(/form|sqrt|D/)
    expect(cForm?.formula?.expected).toBeCloseTo(2, 10)
    expect(cForm?.formula?.plainZh).toMatch(/波形|占空|平方根/)

    const cUtil = flat.find((n) => n.id === 'igbt-compose-duty-util')
    expect(cUtil?.formula?.expr).toMatch(/util|D/)
    expect(cUtil?.formula?.expected).toBeCloseTo(0.25, 10)
    expect(cUtil?.formula?.plainZh).toMatch(/利用|占空/)

    const cPtm = flat.find((n) => n.id === 'igbt-compose-duty-peak-to-mean')
    expect(cPtm?.formula?.expr).toMatch(/peakToMean|D/)
    expect(cPtm?.formula?.expected).toBeCloseTo(4, 10)
    expect(cPtm?.formula?.plainZh).toMatch(/峰均|占空|倒数/)

    const cVar = flat.find((n) => n.id === 'igbt-compose-duty-variance')
    expect(cVar?.formula?.expr).toMatch(/var|P|D/)
    expect(cVar?.formula?.expected).toBeCloseTo(1875, 10)
    expect(cVar?.formula?.plainZh).toMatch(/方差|占空|峰值/)

    const cStd = flat.find((n) => n.id === 'igbt-compose-duty-std')
    expect(cStd?.formula?.expr).toMatch(/std|sqrt|D/)
    expect(cStd?.formula?.expected).toBeCloseTo(
      100 * Math.sqrt(0.25 * 0.75),
      10,
    )
    expect(cStd?.formula?.plainZh).toMatch(/标准|占空|峰值/)

    const cEcy = flat.find((n) => n.id === 'igbt-compose-duty-cycle-energy')
    expect(cEcy?.formula?.expr).toMatch(/E_cyc|P|D|T/)
    expect(cEcy?.formula?.expected).toBeCloseTo(0.5, 10)
    expect(cEcy?.formula?.plainZh).toMatch(/周期|能量|占空|功率/)

    const cCrestR = flat.find((n) => n.id === 'igbt-compose-crest-residual')
    expect(cCrestR?.formula?.expr).toMatch(/crest|sqrt|D/)
    expect(cCrestR?.formula?.expected).toBeCloseTo(0, 10)
    expect(cCrestR?.formula?.plainZh).toMatch(/波峰|残差|电学/)

    const cHel = flat.find((n) => n.id === 'igbt-compose-hellinger-residual')
    expect(cHel?.formula?.expr).toMatch(/H|BC|sqrt/)
    expect(cHel?.formula?.expected).toBeCloseTo(0, 10)
    expect(cHel?.formula?.plainZh).toMatch(/Hellinger|Bhattacharyya|匹配/)

    const cBha = flat.find(
      (n) => n.id === 'igbt-compose-bhattacharyya-residual',
    )
    expect(cBha?.formula?.expr).toMatch(/D_B|ln|BC/)
    expect(cBha?.formula?.expected).toBeCloseTo(0, 10)
    expect(cBha?.formula?.plainZh).toMatch(/Bhattacharyya|系数|残差/)

    const cB1 = flat.find((n) => n.id === 'igbt-compose-dragomir-B1-residual')
    expect(cB1?.formula?.expr).toMatch(/B1|p|q/)
    expect(cB1?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB1?.formula?.plainZh).toMatch(/Dragomir|直方图|矩形/)

    const cB2 = flat.find((n) => n.id === 'igbt-compose-dragomir-B2-residual')
    expect(cB2?.formula?.expr).toMatch(/B2|sqrt|p|q/)
    expect(cB2?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB2?.formula?.plainZh).toMatch(/Dragomir|直方图|矩形/)

    const cDual = flat.find((n) => n.id === 'igbt-compose-dragomir-dual-residual')
    expect(cDual?.formula?.expr).toMatch(/B1|B2/)
    expect(cDual?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDual?.formula?.plainZh).toMatch(/Dragomir|对偶|诚实/)

    const cJmax = flat.find(
      (n) => n.id === 'igbt-compose-duty-joint-max-residual',
    )
    expect(cJmax?.formula?.expr).toMatch(/joint_max|max|H|B1|B2/)
    expect(cJmax?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cJmax?.formula?.plainZh).toMatch(/联合|上确界|最大|Hellinger|Dragomir/)

    const cGate = flat.find(
      (n) => n.id === 'igbt-compose-duty-packaging-honest-gate',
    )
    expect(cGate?.formula?.expr).toMatch(/gate|c_crest|c_H/)
    expect(cGate?.formula?.expected).toBeCloseTo(1, 10)
    expect(cGate?.formula?.plainZh).toMatch(/占空|包装|诚实|门/)

    // S24bf Dragomir B32/B33 vs-rect dual residual packaging (wave30 residual compose expand)
    const cB32 = flat.find((n) => n.id === 'igbt-compose-dragomir-B32-residual')
    expect(cB32?.formula?.expr).toMatch(/B32|p|q/)
    expect(cB32?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB32?.formula?.plainZh).toMatch(/Dragomir|B₃₂|直方图|矩形/)

    const cB33 = flat.find((n) => n.id === 'igbt-compose-dragomir-B33-residual')
    expect(cB33?.formula?.expr).toMatch(/B33|sqrt|p|q/)
    expect(cB33?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB33?.formula?.plainZh).toMatch(/Dragomir|B₃₃|直方图|矩形/)

    const cB32d = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B32-B33-dual-residual',
    )
    expect(cB32d?.formula?.expr).toMatch(/B32|B33/)
    expect(cB32d?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB32d?.formula?.plainZh).toMatch(/Dragomir|B₃₂|B₃₃|对偶|诚实/)

    const cB32j = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B32-B33-joint-max',
    )
    expect(cB32j?.formula?.expr).toMatch(/joint_max|max|B32|B33/)
    expect(cB32j?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cB32j?.formula?.plainZh).toMatch(/联合|上确界|B₃₂|B₃₃/)

    const cB32g = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B32-B33-honesty-gate',
    )
    expect(cB32g?.formula?.expr).toMatch(/gate|c_B32|c_B33/)
    expect(cB32g?.formula?.expected).toBeCloseTo(1, 10)
    expect(cB32g?.formula?.plainZh).toMatch(/Dragomir|B32|B33|包装|诚实|门/)

    // S24bg Dragomir B34/B35 vs-rect dual residual packaging (wave31 residual compose expand)
    const cB34 = flat.find((n) => n.id === 'igbt-compose-dragomir-B34-residual')
    expect(cB34?.formula?.expr).toMatch(/B34|p|q/)
    expect(cB34?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB34?.formula?.plainZh).toMatch(/Dragomir|B₃₄|直方图|矩形/)

    const cB35 = flat.find((n) => n.id === 'igbt-compose-dragomir-B35-residual')
    expect(cB35?.formula?.expr).toMatch(/B35|sqrt|p|q/)
    expect(cB35?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB35?.formula?.plainZh).toMatch(/Dragomir|B₃₅|直方图|矩形/)

    const cB34d = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B34-B35-dual-residual',
    )
    expect(cB34d?.formula?.expr).toMatch(/B34|B35/)
    expect(cB34d?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB34d?.formula?.plainZh).toMatch(/Dragomir|B₃₄|B₃₅|对偶|诚实/)

    const cB34j = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B34-B35-joint-max',
    )
    expect(cB34j?.formula?.expr).toMatch(/joint_max|max|B34|B35/)
    expect(cB34j?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cB34j?.formula?.plainZh).toMatch(/联合|上确界|B₃₄|B₃₅/)

    const cB34g = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B34-B35-honesty-gate',
    )
    expect(cB34g?.formula?.expr).toMatch(/gate|c_B34|c_B35/)
    expect(cB34g?.formula?.expected).toBeCloseTo(1, 10)
    expect(cB34g?.formula?.plainZh).toMatch(/Dragomir|B34|B35|包装|诚实|门/)

    // S24bh Dragomir B36/B37 vs-rect dual residual packaging (wave32 residual compose expand)
    const cB36 = flat.find((n) => n.id === 'igbt-compose-dragomir-B36-residual')
    expect(cB36?.formula?.expr).toMatch(/B36|p|q/)
    expect(cB36?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB36?.formula?.plainZh).toMatch(/Dragomir|B₃₆|直方图|矩形/)

    const cB37 = flat.find((n) => n.id === 'igbt-compose-dragomir-B37-residual')
    expect(cB37?.formula?.expr).toMatch(/B37|sqrt|p|q/)
    expect(cB37?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB37?.formula?.plainZh).toMatch(/Dragomir|B₃₇|直方图|矩形/)

    const cB36d = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B36-B37-dual-residual',
    )
    expect(cB36d?.formula?.expr).toMatch(/B36|B37/)
    expect(cB36d?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB36d?.formula?.plainZh).toMatch(/Dragomir|B₃₆|B₃₇|对偶|诚实/)

    const cB36j = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B36-B37-joint-max',
    )
    expect(cB36j?.formula?.expr).toMatch(/joint_max|max|B36|B37/)
    expect(cB36j?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cB36j?.formula?.plainZh).toMatch(/联合|上确界|B₃₆|B₃₇/)

    const cB36g = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B36-B37-honesty-gate',
    )
    expect(cB36g?.formula?.expr).toMatch(/gate|c_B36|c_B37/)
    expect(cB36g?.formula?.expected).toBeCloseTo(1, 10)
    expect(cB36g?.formula?.plainZh).toMatch(/Dragomir|B36|B37|包装|诚实|门/)

    // S24bi Dragomir B38/B39 vs-rect dual residual packaging (wave33 residual compose expand)
    const cB38 = flat.find((n) => n.id === 'igbt-compose-dragomir-B38-residual')
    expect(cB38?.formula?.expr).toMatch(/B38|p|q/)
    expect(cB38?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB38?.formula?.plainZh).toMatch(/Dragomir|B₃₈|直方图|矩形/)

    const cB39 = flat.find((n) => n.id === 'igbt-compose-dragomir-B39-residual')
    expect(cB39?.formula?.expr).toMatch(/B39|sqrt|p|q/)
    expect(cB39?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB39?.formula?.plainZh).toMatch(/Dragomir|B₃₉|直方图|矩形/)

    const cB38d = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B38-B39-dual-residual',
    )
    expect(cB38d?.formula?.expr).toMatch(/B38|B39/)
    expect(cB38d?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB38d?.formula?.plainZh).toMatch(/Dragomir|B₃₈|B₃₉|对偶|诚实/)

    const cB38j = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B38-B39-joint-max',
    )
    expect(cB38j?.formula?.expr).toMatch(/joint_max|max|B38|B39/)
    expect(cB38j?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cB38j?.formula?.plainZh).toMatch(/联合|上确界|B₃₈|B₃₉/)

    const cB38g = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B38-B39-honesty-gate',
    )
    expect(cB38g?.formula?.expr).toMatch(/gate|c_B38|c_B39/)
    expect(cB38g?.formula?.expected).toBeCloseTo(1, 10)
    expect(cB38g?.formula?.plainZh).toMatch(/Dragomir|B38|B39|包装|诚实|门/)

    // S24bj Dragomir B40/B41 vs-rect dual residual packaging (wave34 residual compose expand)
    const cB40 = flat.find((n) => n.id === 'igbt-compose-dragomir-B40-residual')
    expect(cB40?.formula?.expr).toMatch(/B40|p|q/)
    expect(cB40?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB40?.formula?.plainZh).toMatch(/Dragomir|B₄₀|直方图|矩形/)

    const cB41 = flat.find((n) => n.id === 'igbt-compose-dragomir-B41-residual')
    expect(cB41?.formula?.expr).toMatch(/B41|sqrt|p|q/)
    expect(cB41?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB41?.formula?.plainZh).toMatch(/Dragomir|B₄₁|直方图|矩形/)

    const cB40d = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B40-B41-dual-residual',
    )
    expect(cB40d?.formula?.expr).toMatch(/B40|B41/)
    expect(cB40d?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB40d?.formula?.plainZh).toMatch(/Dragomir|B₄₀|B₄₁|对偶|诚实/)

    const cB40j = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B40-B41-joint-max',
    )
    expect(cB40j?.formula?.expr).toMatch(/joint_max|max|B40|B41/)
    expect(cB40j?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cB40j?.formula?.plainZh).toMatch(/联合|上确界|B₄₀|B₄₁/)

    const cB40g = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B40-B41-honesty-gate',
    )
    expect(cB40g?.formula?.expr).toMatch(/gate|c_B40|c_B41/)
    expect(cB40g?.formula?.expected).toBeCloseTo(1, 10)
    expect(cB40g?.formula?.plainZh).toMatch(/Dragomir|B40|B41|包装|诚实|门/)

    // S24bk Dragomir B42/B43 vs-rect dual residual packaging (wave35 residual compose expand)
    const cB42 = flat.find((n) => n.id === 'igbt-compose-dragomir-B42-residual')
    expect(cB42?.formula?.expr).toMatch(/B42|p|q/)
    expect(cB42?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB42?.formula?.plainZh).toMatch(/Dragomir|B₄₂|直方图|矩形/)

    const cB43 = flat.find((n) => n.id === 'igbt-compose-dragomir-B43-residual')
    expect(cB43?.formula?.expr).toMatch(/B43|sqrt|p|q/)
    expect(cB43?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB43?.formula?.plainZh).toMatch(/Dragomir|B₄₃|直方图|矩形/)

    const cB42d = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B42-B43-dual-residual',
    )
    expect(cB42d?.formula?.expr).toMatch(/B42|B43/)
    expect(cB42d?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB42d?.formula?.plainZh).toMatch(/Dragomir|B₄₂|B₄₃|对偶|诚实/)

    const cB42j = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B42-B43-joint-max',
    )
    expect(cB42j?.formula?.expr).toMatch(/joint_max|max|B42|B43/)
    expect(cB42j?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cB42j?.formula?.plainZh).toMatch(/联合|上确界|B₄₂|B₄₃/)

    const cB42g = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B42-B43-honesty-gate',
    )
    expect(cB42g?.formula?.expr).toMatch(/gate|c_B42|c_B43/)
    expect(cB42g?.formula?.expected).toBeCloseTo(1, 10)
    expect(cB42g?.formula?.plainZh).toMatch(/Dragomir|B42|B43|包装|诚实|门/)

    // S24bl Dragomir B44/B45 vs-rect dual residual packaging (wave36 residual compose expand; bridges wave35)
    const cB44 = flat.find((n) => n.id === 'igbt-compose-dragomir-B44-residual')
    expect(cB44?.formula?.expr).toMatch(/B44|p|q/)
    expect(cB44?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB44?.formula?.plainZh).toMatch(/Dragomir|B₄₄|直方图|矩形/)

    const cB45 = flat.find((n) => n.id === 'igbt-compose-dragomir-B45-residual')
    expect(cB45?.formula?.expr).toMatch(/B45|sqrt|p|q/)
    expect(cB45?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB45?.formula?.plainZh).toMatch(/Dragomir|B₄₅|直方图|矩形/)

    const cB44d = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B44-B45-dual-residual',
    )
    expect(cB44d?.formula?.expr).toMatch(/B44|B45/)
    expect(cB44d?.formula?.expected).toBeCloseTo(0, 10)
    expect(cB44d?.formula?.plainZh).toMatch(/Dragomir|B₄₄|B₄₅|对偶|诚实/)

    const cB44j = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B44-B45-joint-max',
    )
    expect(cB44j?.formula?.expr).toMatch(/joint_max|max|B44|B45/)
    expect(cB44j?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cB44j?.formula?.plainZh).toMatch(/联合|上确界|B₄₄|B₄₅/)

    const cB44g = flat.find(
      (n) => n.id === 'igbt-compose-dragomir-B44-B45-honesty-gate',
    )
    expect(cB44g?.formula?.expr).toMatch(/gate|c_B44|c_B45/)
    expect(cB44g?.formula?.expected).toBeCloseTo(1, 10)
    expect(cB44g?.formula?.plainZh).toMatch(/Dragomir|B44|B45|包装|诚实|门/)


    const composeWithFormula = flat.filter(
      (n) => n.id.startsWith('igbt-compose-') && n.formula,
    )
    expect(composeWithFormula.length).toBeGreaterThanOrEqual(76)
    for (const n of composeWithFormula) {
      expect(n.formula?.plainZh?.length).toBeGreaterThan(4)
      expect(n.formula?.expected).toEqual(expect.any(Number))
      expect(Number.isFinite(n.formula!.expected as number)).toBe(true)
    }
  })

  it('igbt enrichWithFormulaViews attaches plainZh on compose formulas', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-electro-thermal-igbt'],
      layers: 'all',
    })
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const steady = enriched.find(
      (n) => n.id === 'igbt-compose-steady-dT' && n.formulaView,
    )
    expect(steady?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(steady?.formulaView?.expr).toMatch(/P|Rth/)
    const match = enriched.find(
      (n) => n.id === 'igbt-compose-rth-match' && n.formulaView,
    )
    expect(match?.formulaView?.plainZh).toMatch(/残差|热阻|匹配/)
    const step = enriched.find(
      (n) => n.id === 'igbt-compose-step-sum' && n.formulaView,
    )
    expect(step?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const cTj = enriched.find(
      (n) => n.id === 'igbt-compose-tj' && n.formulaView,
    )
    expect(cTj?.formulaView?.plainZh).toMatch(/结温/)
    const cZth = enriched.find(
      (n) => n.id === 'igbt-compose-zth' && n.formulaView,
    )
    expect(cZth?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const cPsw = enriched.find(
      (n) => n.id === 'igbt-compose-psw' && n.formulaView,
    )
    expect(cPsw?.formulaView?.plainZh).toMatch(/开关|频率|能量/)
    const cQ = enriched.find(
      (n) => n.id === 'igbt-compose-thermal-energy' && n.formulaView,
    )
    expect(cQ?.formulaView?.plainZh).toMatch(/热容|温升|储能|能量/)
    const cStepRes = enriched.find(
      (n) => n.id === 'igbt-compose-step-steady-residual' && n.formulaView,
    )
    expect(cStepRes?.formulaView?.plainZh).toMatch(/残差|稳态|阶跃/)
    const cFull = enriched.find(
      (n) => n.id === 'igbt-compose-full-loss-chain' && n.formulaView,
    )
    expect(cFull?.formulaView?.plainZh).toMatch(/损耗|导通|开关/)
    const cZthSum = enriched.find(
      (n) => n.id === 'igbt-compose-zth-sum' && n.formulaView,
    )
    expect(cZthSum?.formulaView?.plainZh).toMatch(/热阻抗|支路|多层/)
    const cMargin = enriched.find(
      (n) => n.id === 'igbt-compose-tj-margin' && n.formulaView,
    )
    expect(cMargin?.formulaView?.plainZh).toMatch(/裕度|结温/)
    const cAlpha = enriched.find(
      (n) => n.id === 'igbt-compose-progress-alpha' && n.formulaView,
    )
    expect(cAlpha?.formulaView?.plainZh).toMatch(/进度|指数/)
    const rms = enriched.find(
      (n) => n.id === 'igbt-compose-duty-rms' && n.formulaView,
    )
    expect(rms?.formulaView?.plainZh).toMatch(/占空|RMS|峰值/)
    const crest = enriched.find(
      (n) => n.id === 'igbt-compose-duty-crest' && n.formulaView,
    )
    expect(crest?.formulaView?.plainZh).toMatch(/波峰|占空/)
    const hel = enriched.find(
      (n) => n.id === 'igbt-compose-hellinger-residual' && n.formulaView,
    )
    expect(hel?.formulaView?.plainZh).toMatch(/Hellinger|Bhattacharyya/)
    const b1 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-B1-residual' && n.formulaView,
    )
    expect(b1?.formulaView?.plainZh).toMatch(/Dragomir|直方图|矩形/)
    const dual = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-dual-residual' && n.formulaView,
    )
    expect(dual?.formulaView?.plainZh).toMatch(/Dragomir|对偶|诚实/)
    const gate = enriched.find(
      (n) =>
        n.id === 'igbt-compose-duty-packaging-honest-gate' && n.formulaView,
    )
    expect(gate?.formulaView?.plainZh).toMatch(/占空|包装|诚实|门/)
    const b32 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-B32-residual' && n.formulaView,
    )
    expect(b32?.formulaView?.plainZh).toMatch(/Dragomir|B₃₂|直方图|矩形/)
    const b32g = enriched.find(
      (n) =>
        n.id === 'igbt-compose-dragomir-B32-B33-honesty-gate' && n.formulaView,
    )
    expect(b32g?.formulaView?.plainZh).toMatch(/Dragomir|B32|B33|包装|诚实|门/)
    const b34 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-B34-residual' && n.formulaView,
    )
    expect(b34?.formulaView?.plainZh).toMatch(/Dragomir|B₃₄|直方图|矩形/)
    const b34g = enriched.find(
      (n) =>
        n.id === 'igbt-compose-dragomir-B34-B35-honesty-gate' && n.formulaView,
    )
    expect(b34g?.formulaView?.plainZh).toMatch(/Dragomir|B34|B35|包装|诚实|门/)
    const b36 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-B36-residual' && n.formulaView,
    )
    expect(b36?.formulaView?.plainZh).toMatch(/Dragomir|B₃₆|直方图|矩形/)
    const b36g = enriched.find(
      (n) =>
        n.id === 'igbt-compose-dragomir-B36-B37-honesty-gate' && n.formulaView,
    )
    expect(b36g?.formulaView?.plainZh).toMatch(/Dragomir|B36|B37|包装|诚实|门/)
    const b38 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-B38-residual' && n.formulaView,
    )
    expect(b38?.formulaView?.plainZh).toMatch(/Dragomir|B₃₈|直方图|矩形/)
    const b38g = enriched.find(
      (n) =>
        n.id === 'igbt-compose-dragomir-B38-B39-honesty-gate' && n.formulaView,
    )
    expect(b38g?.formulaView?.plainZh).toMatch(/Dragomir|B38|B39|包装|诚实|门/)
    const b40 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-B40-residual' && n.formulaView,
    )
    expect(b40?.formulaView?.plainZh).toMatch(/Dragomir|B₄₀|直方图|矩形/)
    const b40g = enriched.find(
      (n) =>
        n.id === 'igbt-compose-dragomir-B40-B41-honesty-gate' && n.formulaView,
    )
    expect(b40g?.formulaView?.plainZh).toMatch(/Dragomir|B40|B41|包装|诚实|门/)
    const b42 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-B42-residual' && n.formulaView,
    )
    expect(b42?.formulaView?.plainZh).toMatch(/Dragomir|B₄₂|直方图|矩形/)
    const b42g = enriched.find(
      (n) =>
        n.id === 'igbt-compose-dragomir-B42-B43-honesty-gate' && n.formulaView,
    )
    expect(b42g?.formulaView?.plainZh).toMatch(/Dragomir|B42|B43|包装|诚实|门/)
    const b44 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-B44-residual' && n.formulaView,
    )
    expect(b44?.formulaView?.plainZh).toMatch(/Dragomir|B₄₄|直方图|矩形/)
    const b44g = enriched.find(
      (n) =>
        n.id === 'igbt-compose-dragomir-B44-B45-honesty-gate' && n.formulaView,
    )
    expect(b44g?.formulaView?.plainZh).toMatch(/Dragomir|B44|B45|包装|诚实|门/)
  })

  it('findMethodsByLink jobKind electro-thermal-igbt', () => {
    const hit = findMethodsByLink({ jobKind: 'electro-thermal-igbt' })
    expect(hit.some((m) => m.id === 'kind-electro-thermal-igbt')).toBe(true)
  })

  it('parallel session includes Foster IGBT with em and acoustics', () => {
    const session = buildParallelExplainSession({
      methodIds: [
        'kind-electro-thermal-igbt',
        'kind-em-fdtd-3d',
        'kind-acoustics-3d',
      ],
      layers: 'all',
    })
    expect(session.methods).toHaveLength(3)
    expect(
      session.allSubExplains.some((n) => n.id === 'igbt-foundation-step'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'igbt-compose-steady-dT'),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'igbt-compose-dragomir-dual-residual',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'igbt-compose-duty-packaging-honest-gate',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'em-foundation-cfl'),
    ).toBe(true)
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const foster = enriched.find(
      (n) => n.id === 'igbt-foundation-tau' && n.formulaView,
    )
    expect(foster?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(foster?.formulaView?.expr).toContain('tau')
    const compose = enriched.find(
      (n) => n.id === 'igbt-compose-tj' && n.formulaView,
    )
    expect(compose?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const s24 = enriched.find(
      (n) => n.id === 'igbt-compose-dragomir-dual-residual' && n.formulaView,
    )
    expect(s24?.formulaView?.plainZh.length).toBeGreaterThan(4)
  })

  it('em-fdtd-3d drills method → principle → foundation with Maxwell formulas', () => {
    const tree = getMethodExplainTree('kind-em-fdtd-3d')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    const layers = new Set(flat.map((n) => n.layer))
    expect(layers.has('method')).toBe(true)
    expect(layers.has('principle')).toBe(true)
    expect(layers.has('foundation')).toBe(true)
    expect(layers.has('engineering')).toBe(true)
    expect(layers.has('compose')).toBe(true)

    const c = flat.find((n) => n.id === 'em-foundation-c')
    expect(c?.formula?.expr).toMatch(/sqrt/i)
    expect(c?.formula?.expected).toBeCloseTo(
      1 / Math.sqrt(1.2566370614e-6 * 8.854187817e-12),
      3,
    )

    const z = flat.find((n) => n.id === 'em-foundation-z0')
    expect(z?.formula?.expr).toMatch(/sqrt/i)
    expect(z?.formula?.expected).toBeCloseTo(
      Math.sqrt(1.2566370614e-6 / 8.854187817e-12),
      1,
    )

    const cfl = flat.find((n) => n.id === 'em-foundation-cfl')
    expect(cfl?.formula?.expr).toMatch(/dt_max|sqrt\(3\)/)
    expect(cfl?.formula?.expected).toBeCloseTo(1e-3 / (3e8 * Math.sqrt(3)), 12)

    const plane = flat.find((n) => n.id === 'em-compose-plane-wave-zh')
    expect(plane?.formula?.expr).toMatch(/E \/ H|E\/H/)
    expect(plane?.formula?.expected).toBeCloseTo(377, 10)
    expect(plane?.formula?.plainZh).toMatch(/平面波|阻抗/)

    const u = flat.find((n) => n.id === 'em-compose-energy-density')
    expect(u?.formula?.expr).toMatch(/eps|mu/)
    expect(u?.formula?.expected).toBeCloseTo(1, 10)
    expect(u?.formula?.plainZh).toMatch(/能量/)

    const s = flat.find((n) => n.id === 'em-compose-cfl-ratio')
    expect(s?.formula?.expr).toMatch(/dt/)
    expect(s?.formula?.expected).toBeCloseTo(
      1e-12 / (1e-3 / (3e8 * Math.sqrt(3))),
      12,
    )
    expect(s?.formula?.plainZh).toMatch(/CFL|时间步/)

    const R = flat.find((n) => n.id === 'em-compose-reflection')
    expect(R?.formula?.expr).toMatch(/Z2|Z1/)
    expect(R?.formula?.expected).toBeCloseTo(-1, 10)
    expect(R?.formula?.plainZh).toMatch(/反射|PEC|阻抗/)

    const match = flat.find((n) => n.id === 'em-compose-impedance-match')
    expect(match?.formula?.expected).toBeCloseTo(0, 10)
    expect(match?.formula?.plainZh).toMatch(/残差|阻抗|匹配/)

    const poynt = flat.find((n) => n.id === 'em-compose-poynting')
    expect(poynt?.formula?.expr).toMatch(/E \* H|E\*H/)
    expect(poynt?.formula?.expected).toBeCloseTo(377, 10)
    expect(poynt?.formula?.plainZh).toMatch(/坡印廷|能流|电场/)

    const SEZ = flat.find((n) => n.id === 'em-compose-S-from-EZ')
    expect(SEZ?.formula?.expr).toMatch(/E \* E|Z/)
    expect(SEZ?.formula?.expected).toBeCloseTo(377, 10)
    expect(SEZ?.formula?.plainZh).toMatch(/能流|阻抗|E/)

    const lam = flat.find((n) => n.id === 'em-compose-wavelength')
    expect(lam?.formula?.expr).toMatch(/c|f|lambda/)
    expect(lam?.formula?.expected).toBeCloseTo(0.3, 10)
    expect(lam?.formula?.plainZh).toMatch(/波长|光速|频率/)

    const dtMu = flat.find((n) => n.id === 'em-compose-dt-max-from-mu-eps')
    expect(dtMu?.formula?.expr).toMatch(/mu|eps|dx/)
    expect(dtMu?.formula?.expected).toBeCloseTo(
      (1e-3 * Math.sqrt(1.2566370614e-6 * 8.854187817e-12)) / Math.sqrt(3),
      12,
    )
    expect(dtMu?.formula?.plainZh).toMatch(/时间步|Yee|网格|μ|ε|介质/)

    const Zmu = flat.find((n) => n.id === 'em-compose-Z-from-mu-eps')
    expect(Zmu?.formula?.expr).toMatch(/sqrt/)
    expect(Zmu?.formula?.expected).toBeCloseTo(
      Math.sqrt(1.2566370614e-6 / 8.854187817e-12),
      1,
    )
    expect(Zmu?.formula?.plainZh).toMatch(/阻抗|磁导|介电|E\/H|平面波/)

    const cMu = flat.find((n) => n.id === 'em-compose-c-from-mu-eps')
    expect(cMu?.formula?.expr).toMatch(/sqrt/)
    expect(cMu?.formula?.expected).toBeCloseTo(
      1 / Math.sqrt(1.2566370614e-6 * 8.854187817e-12),
      3,
    )
    expect(cMu?.formula?.plainZh).toMatch(/光速|磁导|介电|CFL|波长/)

    const H = flat.find((n) => n.id === 'em-compose-H-from-EZ')
    expect(H?.formula?.expr).toMatch(/E \/ Z|E\/Z/)
    expect(H?.formula?.expected).toBeCloseTo(1, 10)
    expect(H?.formula?.plainZh).toMatch(/磁场|电场|阻抗|平面波/)

    const Tp = flat.find((n) => n.id === 'em-compose-transmission')
    expect(Tp?.formula?.expr).toMatch(/Z2|Z1/)
    expect(Tp?.formula?.expected).toBeCloseTo(1, 10)
    expect(Tp?.formula?.plainZh).toMatch(/透射|阻抗/)

    const rt = flat.find((n) => n.id === 'em-compose-RT-closure')
    expect(rt?.formula?.expected).toBeCloseTo(0, 10)
    expect(rt?.formula?.plainZh).toMatch(/反射|透射|残差|闭合/)

    const ppw = flat.find((n) => n.id === 'em-compose-ppw')
    expect(ppw?.formula?.expr).toMatch(/lambda|dx/)
    expect(ppw?.formula?.expected).toBeCloseTo(30, 10)
    expect(ppw?.formula?.plainZh).toMatch(/波长|网格|分辨率|点数/)

    const travel = flat.find((n) => n.id === 'em-compose-travel-time')
    expect(travel?.formula?.expr).toMatch(/L \/ c|tau/)
    expect(travel?.formula?.expected).toBeCloseTo(1e-9, 12)
    expect(travel?.formula?.plainZh).toMatch(/渡越|光速|路径/)

    const sRes = flat.find((n) => n.id === 'em-compose-S-match-residual')
    expect(sRes?.formula?.expected).toBeCloseTo(0, 10)
    expect(sRes?.formula?.plainZh).toMatch(/坡印廷|能流|残差|匹配/)

    const phase = flat.find((n) => n.id === 'em-compose-phase-speed')
    expect(phase?.formula?.expr).toMatch(/omega|k/)
    expect(phase?.formula?.expected).toBeCloseTo(3e8, 6)
    expect(phase?.formula?.plainZh).toMatch(/相速|角频率|波数|光速/)

    const fLam = flat.find((n) => n.id === 'em-compose-freq-from-lambda')
    expect(fLam?.formula?.expr).toMatch(/c|lambda/)
    expect(fLam?.formula?.expected).toBeCloseTo(1e9, 6)
    expect(fLam?.formula?.plainZh).toMatch(/频率|光速|波长/)

    const dtC = flat.find((n) => n.id === 'em-compose-dt-max-from-c')
    expect(dtC?.formula?.expr).toMatch(/dx|c|sqrt/)
    expect(dtC?.formula?.expected).toBeCloseTo(1e-3 / (3e8 * Math.sqrt(3)), 12)
    expect(dtC?.formula?.plainZh).toMatch(/时间步|网格|光速|Yee|√3|sqrt/)

    const kOm = flat.find((n) => n.id === 'em-compose-k-from-omega')
    expect(kOm?.formula?.expr).toMatch(/omega|c/)
    expect(kOm?.formula?.expected).toBeCloseTo((2 * Math.PI * 1e9) / 3e8, 10)
    expect(kOm?.formula?.plainZh).toMatch(/波数|角频率|光速|相速|波长/)

    const uE = flat.find((n) => n.id === 'em-compose-u-electric')
    expect(uE?.formula?.expr).toMatch(/eps|E/)
    expect(uE?.formula?.expected).toBeCloseTo(1, 10)
    expect(uE?.formula?.plainZh).toMatch(/电场|能量|介电/)

    const omF = flat.find((n) => n.id === 'em-compose-omega-from-f')
    expect(omF?.formula?.expr).toMatch(/pi|f|omega/)
    expect(omF?.formula?.expected).toBeCloseTo(2 * Math.PI * 1e9, 6)
    expect(omF?.formula?.plainZh).toMatch(/角频率|频率|波数|相速/)

    // S27ci nona-dense CFL residual (wave35 residual compose expand)
    const cNonaSpan = flat.find((n) => n.id === 'em-compose-nona-dense-cfl-span')
    expect(cNonaSpan?.formula?.expr).toMatch(/cfl_hi|cfl_lo|span/)
    expect(cNonaSpan?.formula?.expected).toBeCloseTo(0.3, 10)
    expect(cNonaSpan?.formula?.plainZh).toMatch(/nona|CFL|跨度/)

    const cNonaRank = flat.find(
      (n) => n.id === 'em-compose-nona-dense-ranking-honesty',
    )
    expect(cNonaRank?.formula?.expr).toMatch(/rank_ok/)
    expect(cNonaRank?.formula?.expected).toBeCloseTo(0, 10)
    expect(cNonaRank?.formula?.plainZh).toMatch(/nona|ranking|诚实/)

    const cNonaDual = flat.find((n) => n.id === 'em-compose-nona-long-min-dual')
    expect(cNonaDual?.formula?.expr).toMatch(/dual_ok/)
    expect(cNonaDual?.formula?.expected).toBeCloseTo(0, 10)
    expect(cNonaDual?.formula?.plainZh).toMatch(/nona-long|MIN dual|诚实/)

    const cNonaPlat = flat.find(
      (n) => n.id === 'em-compose-nona-dense-plateau-honesty',
    )
    expect(cNonaPlat?.formula?.expr).toMatch(/plateau_ok/)
    expect(cNonaPlat?.formula?.expected).toBeCloseTo(0, 10)
    expect(cNonaPlat?.formula?.plainZh).toMatch(/nona|plateau|诚实/)

    const cNonag = flat.find((n) => n.id === 'em-compose-nona-dense-honesty-gate')
    expect(cNonag?.formula?.expr).toMatch(/gate|c_rank|c_dual/)
    expect(cNonag?.formula?.expected).toBeCloseTo(1, 10)
    expect(cNonag?.formula?.plainZh).toMatch(/nona-dense|包装|诚实|门/)

    // S27cj deca-dense CFL residual (wave36 residual compose expand; bridges wave35)
    const cDecaSpan = flat.find((n) => n.id === 'em-compose-deca-dense-cfl-span')
    expect(cDecaSpan?.formula?.expr).toMatch(/cfl_hi|cfl_lo|span/)
    expect(cDecaSpan?.formula?.expected).toBeCloseTo(0.3, 10)
    expect(cDecaSpan?.formula?.plainZh).toMatch(/deca|CFL|跨度/)

    const cDecaRank = flat.find(
      (n) => n.id === 'em-compose-deca-dense-ranking-honesty',
    )
    expect(cDecaRank?.formula?.expr).toMatch(/rank_ok/)
    expect(cDecaRank?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDecaRank?.formula?.plainZh).toMatch(/deca|ranking|诚实/)

    const cDecaDual = flat.find((n) => n.id === 'em-compose-deca-long-min-dual')
    expect(cDecaDual?.formula?.expr).toMatch(/dual_ok/)
    expect(cDecaDual?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDecaDual?.formula?.plainZh).toMatch(/deca-long|MIN dual|诚实/)

    const cDecaPlat = flat.find(
      (n) => n.id === 'em-compose-deca-dense-plateau-honesty',
    )
    expect(cDecaPlat?.formula?.expr).toMatch(/plateau_ok/)
    expect(cDecaPlat?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDecaPlat?.formula?.plainZh).toMatch(/deca|plateau|诚实/)

    const cDecag = flat.find((n) => n.id === 'em-compose-deca-dense-honesty-gate')
    expect(cDecag?.formula?.expr).toMatch(/gate|c_rank|c_dual/)
    expect(cDecag?.formula?.expected).toBeCloseTo(1, 10)
    expect(cDecag?.formula?.plainZh).toMatch(/deca-dense|包装|诚实|门/)

    const composeWithFormula = flat.filter(
      (n) => n.id.startsWith('em-compose-') && n.formula,
    )
    expect(composeWithFormula.length).toBeGreaterThanOrEqual(28)
    for (const n of composeWithFormula) {
      expect(n.formula?.plainZh && n.formula.plainZh.length).toBeGreaterThan(4)
      expect(n.formula?.plainEn && n.formula.plainEn.length).toBeGreaterThan(4)
      expect(n.formula?.expected).toEqual(expect.any(Number))
      expect(Number.isFinite(n.formula!.expected as number)).toBe(true)
    }
  })

  it('em-fdtd-3d enrichWithFormulaViews attaches plainZh on compose formulas', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-em-fdtd-3d'],
      layers: 'all',
    })
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const plane = enriched.find(
      (n) => n.id === 'em-compose-plane-wave-zh' && n.formulaView,
    )
    expect(plane?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(plane?.formulaView?.expr).toMatch(/E|H/)
    const refl = enriched.find(
      (n) => n.id === 'em-compose-reflection' && n.formulaView,
    )
    expect(refl?.formulaView?.plainZh).toMatch(/反射|PEC|阻抗/)
    const cfl = enriched.find(
      (n) => n.id === 'em-compose-cfl-ratio' && n.formulaView,
    )
    expect(cfl?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const poynt = enriched.find(
      (n) => n.id === 'em-compose-poynting' && n.formulaView,
    )
    expect(poynt?.formulaView?.plainZh).toMatch(/坡印廷|能流/)
    const lam = enriched.find(
      (n) => n.id === 'em-compose-wavelength' && n.formulaView,
    )
    expect(lam?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const dtMu = enriched.find(
      (n) => n.id === 'em-compose-dt-max-from-mu-eps' && n.formulaView,
    )
    expect(dtMu?.formulaView?.plainZh).toMatch(/时间步|Yee|网格|μ|ε|介质/)
    const cMu = enriched.find(
      (n) => n.id === 'em-compose-c-from-mu-eps' && n.formulaView,
    )
    expect(cMu?.formulaView?.plainZh).toMatch(/光速|磁导|介电/)
    const Tp = enriched.find(
      (n) => n.id === 'em-compose-transmission' && n.formulaView,
    )
    expect(Tp?.formulaView?.plainZh).toMatch(/透射|阻抗/)
    const ppw = enriched.find(
      (n) => n.id === 'em-compose-ppw' && n.formulaView,
    )
    expect(ppw?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const sRes = enriched.find(
      (n) => n.id === 'em-compose-S-match-residual' && n.formulaView,
    )
    expect(sRes?.formulaView?.plainZh).toMatch(/坡印廷|能流|残差/)
    const phase = enriched.find(
      (n) => n.id === 'em-compose-phase-speed' && n.formulaView,
    )
    expect(phase?.formulaView?.plainZh).toMatch(/相速|角频率|波数|光速/)
    const fLam = enriched.find(
      (n) => n.id === 'em-compose-freq-from-lambda' && n.formulaView,
    )
    expect(fLam?.formulaView?.plainZh).toMatch(/频率|光速|波长/)
    const dtC = enriched.find(
      (n) => n.id === 'em-compose-dt-max-from-c' && n.formulaView,
    )
    expect(dtC?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(dtC?.formulaView?.expr).toMatch(/dx|c/)
    const kOm = enriched.find(
      (n) => n.id === 'em-compose-k-from-omega' && n.formulaView,
    )
    expect(kOm?.formulaView?.plainZh).toMatch(/波数|角频率|光速/)
    const uE = enriched.find(
      (n) => n.id === 'em-compose-u-electric' && n.formulaView,
    )
    expect(uE?.formulaView?.plainZh).toMatch(/电场|能量|介电/)
    const omF = enriched.find(
      (n) => n.id === 'em-compose-omega-from-f' && n.formulaView,
    )
    expect(omF?.formulaView?.plainZh).toMatch(/角频率|频率/)
    const nonaSpan = enriched.find(
      (n) => n.id === 'em-compose-nona-dense-cfl-span' && n.formulaView,
    )
    expect(nonaSpan?.formulaView?.plainZh).toMatch(/nona|CFL|跨度/)
    const nonag = enriched.find(
      (n) => n.id === 'em-compose-nona-dense-honesty-gate' && n.formulaView,
    )
    expect(nonag?.formulaView?.plainZh).toMatch(/nona-dense|包装|诚实|门/)
  })

  it('findMethodsByLink jobKind em-fdtd-3d', () => {
    const hit = findMethodsByLink({ jobKind: 'em-fdtd-3d' })
    expect(hit.some((m) => m.id === 'kind-em-fdtd-3d')).toBe(true)
  })

  it('parallel session walks all children across md + em + acoustics', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-md-lj', 'kind-em-fdtd-3d', 'kind-acoustics-3d'],
      layers: 'all',
    })
    expect(session.methods).toHaveLength(3)
    expect(session.allSubExplains.length).toBeGreaterThan(20)
    expect(
      session.allSubExplains.some((n) => n.id === 'md-foundation-lj-u'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'em-foundation-cfl'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'acoustics-foundation-c'),
    ).toBe(true)
    // every registered method tree lists nested children under walk
    for (const m of session.methods) {
      expect(m.allExplains.some((n) => n.depth > 0)).toBe(true)
      expect(m.allExplains.some((n) => n.layer === 'foundation')).toBe(true)
    }
  })

  it('structural-mindlin drills method → principle → foundation with FOSD formulas', () => {
    const tree = getMethodExplainTree('kind-structural-mindlin')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    const layers = new Set(flat.map((n) => n.layer))
    expect(layers.has('method')).toBe(true)
    expect(layers.has('principle')).toBe(true)
    expect(layers.has('foundation')).toBe(true)
    expect(layers.has('engineering')).toBe(true)
    expect(layers.has('compose')).toBe(true)
    expect(layers.has('L0')).toBe(true)

    const D = flat.find((n) => n.id === 'mindlin-foundation-D')
    expect(D?.formula?.expr).toMatch(/E \* t\^3|t\^3/)
    expect(D?.formula?.expected).toBeCloseTo(
      (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
      6,
    )
    expect(D?.formula?.plainZh).toMatch(/弯曲|刚度/)

    const G = flat.find((n) => n.id === 'mindlin-foundation-G')
    expect(G?.formula?.expr).toBe('G = E / (2 * (1 + nu))')
    expect(G?.formula?.expected).toBeCloseTo(2.1e11 / (2 * 1.3), 3)

    const S = flat.find((n) => n.id === 'mindlin-foundation-S')
    expect(S?.formula?.expr).toBe('S = kappa * G * t')
    expect(S?.formula?.expected).toBeCloseTo(
      (5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01,
      3,
    )
    expect(S?.formula?.plainZh).toMatch(/剪切/)

    const f = flat.find((n) => n.id === 'mindlin-foundation-shear-factor')
    expect(f?.formula?.expr).toMatch(/pi\^2|D/)
    expect(f?.formula?.expected).toBeGreaterThan(1)
    expect(f?.formula?.plainZh).toMatch(/Mindlin|剪切|Kirchhoff/)

    const w = flat.find((n) => n.id === 'mindlin-foundation-circ-w')
    expect(w?.formula?.expr).toMatch(/R\^4|64/)
    expect(w?.formula?.expected).toBeGreaterThan(0)
    expect(w?.formula?.plainZh).toMatch(/圆板|挠度/)

    const kappa = flat.find((n) => n.id === 'mindlin-foundation-kappa')
    expect(kappa?.formula?.expected).toBeCloseTo(5 / 6, 10)

    const wM = flat.find((n) => n.id === 'mindlin-compose-wM-shear')
    expect(wM?.formula?.expr).toMatch(/w_M|w_K|D|S/)
    expect(wM?.formula?.expected).toBeCloseTo(
      1e-5 *
        (1 +
          (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
            Math.PI *
            Math.PI *
            2) /
            ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01)),
      12,
    )
    expect(wM?.formula?.plainZh).toMatch(/Mindlin|Kirchhoff|剪切|挠度/)

    const cD = flat.find((n) => n.id === 'mindlin-compose-D')
    expect(cD?.formula?.expr).toMatch(/E \* t\^3|t\^3/)
    expect(cD?.formula?.expected).toBeCloseTo(
      (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
      6,
    )
    expect(cD?.formula?.plainZh).toMatch(/弯曲|刚度/)

    const cS = flat.find((n) => n.id === 'mindlin-compose-S')
    expect(cS?.formula?.expr).toMatch(/kappa|E|nu|t/)
    expect(cS?.formula?.expected).toBeCloseTo(
      (5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01,
      3,
    )
    expect(cS?.formula?.plainZh).toMatch(/剪切|刚度/)

    const thin = flat.find((n) => n.id === 'mindlin-compose-thin-limit')
    expect(thin?.formula?.expr).toMatch(/D|S|pi|k/)
    expect(thin?.formula?.expected).toBeLessThan(1e-6)
    expect(thin?.formula?.expected).toBeCloseTo(
      Math.abs(
        (((2.1e11 * Math.pow(1e-4, 3)) / (12 * (1 - 0.3 * 0.3))) *
          Math.PI *
          Math.PI *
          2) /
          ((5 / 6) * (2.1e11 / (2 * 1.3)) * 1e-4),
      ),
      12,
    )
    expect(thin?.formula?.plainZh).toMatch(/薄|残差|Mindlin|Kirchhoff/)

    const om = flat.find((n) => n.id === 'mindlin-compose-omega')
    expect(om?.formula?.expr).toMatch(/omega|pi|D|rho/)
    expect(om?.formula?.expected).toBeCloseTo(
      Math.PI *
        Math.PI *
        Math.sqrt(
          ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
            (7850 * 0.01),
        ) *
        2,
      6,
    )
    expect(om?.formula?.plainZh).toMatch(/固有|频率|弯曲|板/)

    const circ = flat.find((n) => n.id === 'mindlin-compose-circ-w')
    expect(circ?.formula?.expr).toMatch(/R\^4|64|S/)
    expect(circ?.formula?.expected).toBeCloseTo(
      (1000 * Math.pow(0.5, 4)) /
        (64 * ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)))) +
        (1000 * Math.pow(0.5, 2)) /
          (4 * ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01)),
      12,
    )
    expect(circ?.formula?.plainZh).toMatch(/圆板|挠度|弯曲|剪切/)

    const frac = flat.find((n) => n.id === 'mindlin-compose-shear-fraction')
    expect(frac?.formula?.expr).toMatch(/w_s|w_max/)
    expect(frac?.formula?.expected).toBeGreaterThan(0)
    expect(frac?.formula?.expected).toBeLessThan(0.1)
    expect(frac?.formula?.plainZh).toMatch(/剪切|挠度|占比|Mindlin|Kirchhoff/)

    const thick = flat.find((n) => n.id === 'mindlin-compose-thick-residual')
    expect(thick?.formula?.expr).toMatch(/D|S|pi|k/)
    expect(thick?.formula?.expected).toBeGreaterThan(1e-4)
    expect(thick?.formula?.expected).toBeCloseTo(
      Math.abs(
        (((2.1e11 * Math.pow(0.1, 3)) / (12 * (1 - 0.3 * 0.3))) *
          Math.PI *
          Math.PI *
          2) /
          ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.1),
      ),
      12,
    )
    expect(thick?.formula?.plainZh).toMatch(/厚|剪切|超差|Mindlin|Kirchhoff/)

    const cG = flat.find((n) => n.id === 'mindlin-compose-G-from-E')
    expect(cG?.formula?.expr).toBe('G = E / (2 * (1 + nu))')
    expect(cG?.formula?.expected).toBeCloseTo(2.1e11 / (2 * 1.3), 3)
    expect(cG?.formula?.plainZh).toMatch(/剪切|模量|弹性|泊松/)

    const kappaC = flat.find((n) => n.id === 'mindlin-compose-kappa')
    expect(kappaC?.formula?.expr).toMatch(/5\s*\/\s*6|kappa/)
    expect(kappaC?.formula?.expected).toBeCloseTo(5 / 6, 10)
    expect(kappaC?.formula?.plainZh).toMatch(/剪切|修正|5\/6|矩形/)

    const fShear = flat.find((n) => n.id === 'mindlin-compose-f-shear')
    expect(fShear?.formula?.expr).toMatch(/D|S|pi|k/)
    expect(fShear?.formula?.expected).toBeCloseTo(
      1 +
        (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
          Math.PI *
          Math.PI *
          2) /
          ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01),
      12,
    )
    expect(fShear?.formula?.expected).toBeGreaterThan(1)
    expect(fShear?.formula?.plainZh).toMatch(/剪切|放大|弯曲|刚度/)

    const mu = flat.find((n) => n.id === 'mindlin-compose-areal-mu')
    expect(mu?.formula?.expr).toMatch(/rho|t/)
    expect(mu?.formula?.expected).toBeCloseTo(78.5, 10)
    expect(mu?.formula?.plainZh).toMatch(/面密度|密度|厚度|频率/)

    const omM = flat.find((n) => n.id === 'mindlin-compose-omega-mindlin')
    const omegaK =
      Math.PI *
      Math.PI *
      Math.sqrt(
        ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
          (7850 * 0.01),
      ) *
      2
    const fVal =
      1 +
      (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
        Math.PI *
        Math.PI *
        2) /
        ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01)
    expect(omM?.formula?.expr).toMatch(/omega_M|omega_K|sqrt/)
    expect(omM?.formula?.expected).toBeCloseTo(omegaK / Math.sqrt(fVal), 6)
    expect(omM?.formula?.expected).toBeLessThan(omegaK)
    expect(omM?.formula?.plainZh).toMatch(/Mindlin|Kirchhoff|频率|剪切/)

    const omRes = flat.find((n) => n.id === 'mindlin-compose-omega-residual')
    expect(omRes?.formula?.expr).toMatch(/omega_K|omega_M/)
    expect(omRes?.formula?.expected).toBeCloseTo(1 - 1 / Math.sqrt(fVal), 12)
    expect(omRes?.formula?.expected).toBeGreaterThan(0)
    expect(omRes?.formula?.expected).toBeLessThan(1e-3)
    expect(omRes?.formula?.plainZh).toMatch(/频散|残差|Mindlin|Kirchhoff|剪切/)

    const zetaQ = flat.find((n) => n.id === 'mindlin-compose-zeta-peak')
    expect(zetaQ?.formula?.expr).toMatch(/zeta|Q/)
    expect(zetaQ?.formula?.expected).toBeCloseTo(10, 10)
    expect(zetaQ?.formula?.plainZh).toMatch(/阻尼|共振|放大|峰/)

    const aspect = flat.find((n) => n.id === 'mindlin-compose-aspect')
    expect(aspect?.formula?.expr).toMatch(/a\s*\/\s*t|AR/)
    expect(aspect?.formula?.expected).toBeCloseTo(100, 10)
    expect(aspect?.formula?.plainZh).toMatch(/长细|厚度|薄|剪切|Mindlin/)

    const ell = flat.find((n) => n.id === 'mindlin-compose-char-length')
    expect(ell?.formula?.expr).toMatch(/sqrt|D|S/)
    expect(ell?.formula?.expected).toBeCloseTo(
      Math.sqrt(
        ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
          ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01),
      ),
      12,
    )
    expect(ell?.formula?.plainZh).toMatch(/特征|长度|弯曲|剪切|板厚/)

    const kModal = flat.find((n) => n.id === 'mindlin-compose-k-modal')
    expect(kModal?.formula?.expr).toMatch(/m\^2|a\^2|n\^2/)
    expect(kModal?.formula?.expected).toBeCloseTo(2, 10)
    expect(kModal?.formula?.plainZh).toMatch(/波数|半波|边长/)

    const dsRatio = flat.find((n) => n.id === 'mindlin-compose-DS-ratio')
    expect(dsRatio?.formula?.expr).toMatch(/D\s*\/\s*S|ratio/)
    expect(dsRatio?.formula?.expected).toBeCloseTo(
      ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
        ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01),
      12,
    )
    expect(dsRatio?.formula?.plainZh).toMatch(/弯曲|剪切|特征|刚度/)

    const fEll = flat.find((n) => n.id === 'mindlin-compose-f-from-ell')
    const ellVal = Math.sqrt(
      ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
        ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01),
    )
    expect(fEll?.formula?.expr).toMatch(/ell|pi|k/)
    expect(fEll?.formula?.expected).toBeCloseTo(
      1 + Math.PI * Math.PI * 2 * ellVal * ellVal,
      12,
    )
    expect(fEll?.formula?.expected).toBeCloseTo(fVal, 10)
    expect(fEll?.formula?.plainZh).toMatch(/剪切|放大|特征|波数/)

    const ellR = flat.find((n) => n.id === 'mindlin-compose-ell-ratio')
    expect(ellR?.formula?.expr).toMatch(/ell|a/)
    expect(ellR?.formula?.expected).toBeCloseTo(ellVal, 12)
    expect(ellR?.formula?.plainZh).toMatch(/特征|边长|剪切|Mindlin/)

    const rotI = flat.find((n) => n.id === 'mindlin-compose-rotary-I')
    expect(rotI?.formula?.expr).toMatch(/rho|t\^3|12/)
    expect(rotI?.formula?.expected).toBeCloseTo((7850 * Math.pow(0.01, 3)) / 12, 12)
    expect(rotI?.formula?.plainZh).toMatch(/转动|惯量|密度|厚度/)

    const hp = flat.find((n) => n.id === 'mindlin-compose-half-power')
    expect(hp?.formula?.expr).toMatch(/zeta|omega/)
    expect(hp?.formula?.expected).toBeCloseTo(10, 10)
    expect(hp?.formula?.plainZh).toMatch(/半功率|带宽|阻尼|频率/)

    const relBw = flat.find((n) => n.id === 'mindlin-compose-rel-bandwidth')
    expect(relBw?.formula?.expr).toMatch(/Q|rel/)
    expect(relBw?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(relBw?.formula?.plainZh).toMatch(/半功率|带宽|放大|阻尼/)

    const qBw = flat.find((n) => n.id === 'mindlin-compose-Q-from-bandwidth')
    expect(qBw?.formula?.expr).toMatch(/omega|dOmega|Q/)
    expect(qBw?.formula?.expected).toBeCloseTo(10, 10)
    expect(qBw?.formula?.plainZh).toMatch(/共振|放大|半功率|带宽/)

    const qMatch = flat.find((n) => n.id === 'mindlin-compose-Q-match')
    expect(qMatch?.formula?.expr).toMatch(/Q|zeta/)
    expect(qMatch?.formula?.expected).toBeCloseTo(0, 10)
    expect(qMatch?.formula?.plainZh).toMatch(/半功率|匹配|残差|峰/)

    const wBend = flat.find((n) => n.id === 'mindlin-compose-w-bend')
    expect(wBend?.formula?.expr).toMatch(/R\^4|64|D/)
    expect(wBend?.formula?.expected).toBeCloseTo(
      (1000 * Math.pow(0.5, 4)) /
        (64 * ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)))),
      12,
    )
    expect(wBend?.formula?.plainZh).toMatch(/弯曲|圆板|挠度|面压/)

    const wShear = flat.find((n) => n.id === 'mindlin-compose-w-shear')
    expect(wShear?.formula?.expr).toMatch(/R\^2|S/)
    expect(wShear?.formula?.expected).toBeCloseTo(
      (1000 * Math.pow(0.5, 2)) /
        (4 * ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01)),
      12,
    )
    expect(wShear?.formula?.plainZh).toMatch(/剪切|圆板|挠度|面压/)

    const kappaS = flat.find((n) => n.id === 'mindlin-compose-kappa-S-ratio')
    expect(kappaS?.formula?.expr).toMatch(/kappa/)
    expect(kappaS?.formula?.expected).toBeCloseTo(1 / (5 / 6), 10)
    expect(kappaS?.formula?.plainZh).toMatch(/剪切|修正|刚度|扫描/)

    const thickAr = flat.find((n) => n.id === 'mindlin-compose-thick-aspect')
    expect(thickAr?.formula?.expr).toMatch(/a\s*\/\s*t|AR/)
    expect(thickAr?.formula?.expected).toBeCloseTo(10, 10)
    expect(thickAr?.formula?.plainZh).toMatch(/厚|长细|剪切|Mindlin|Kirchhoff/)

    const peakC = flat.find((n) => n.id === 'mindlin-compose-peak-consistency')
    expect(peakC?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(peakC?.formula?.expected).toBeCloseTo(0, 10)
    expect(peakC?.formula?.plainZh).toMatch(/峰|一致性|残差|位移|能量/)

    const omMu = flat.find((n) => n.id === 'mindlin-compose-omega-from-mu')
    expect(omMu?.formula?.expr).toMatch(/mu|D|pi|k/)
    expect(omMu?.formula?.expected).toBeCloseTo(omegaK, 6)
    expect(omMu?.formula?.plainZh).toMatch(/固有|频率|面密度|弯曲|波数/)

    // S26bu energy↔peak dual residual packaging (wave26 residual compose expand)
    const cPf = flat.find((n) => n.id === 'mindlin-compose-peak-factor')
    expect(cPf?.formula?.expr).toMatch(/amp|zeta|p/)
    expect(cPf?.formula?.expected).toBeCloseTo(1, 10)
    expect(cPf?.formula?.plainZh).toMatch(/峰|因子|阻尼|放大/)

    const cPe = flat.find((n) => n.id === 'mindlin-compose-energy-peak-factor')
    expect(cPe?.formula?.expr).toMatch(/amp_E|zeta|p_E/)
    expect(cPe?.formula?.expected).toBeCloseTo(1, 10)
    expect(cPe?.formula?.plainZh).toMatch(/能量|峰|因子|阻尼/)

    const cPfc = flat.find(
      (n) => n.id === 'mindlin-compose-peak-factor-consistency',
    )
    expect(cPfc?.formula?.expr).toMatch(/p_w|p_E/)
    expect(cPfc?.formula?.expected).toBeCloseTo(0, 10)
    expect(cPfc?.formula?.plainZh).toMatch(/峰|因子|一致|残差|位移|能量/)

    const cQe = flat.find((n) => n.id === 'mindlin-compose-Q-energy')
    expect(cQe?.formula?.expr).toMatch(/Q_E|zeta/)
    expect(cQe?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQe?.formula?.plainZh).toMatch(/能量|半功率|品质|阻尼/)

    const cWp = flat.find((n) => n.id === 'mindlin-compose-peak-omega-sdof')
    expect(cWp?.formula?.expr).toMatch(/omega_p|omega_n|zeta|sqrt/)
    expect(cWp?.formula?.expected).toBeCloseTo(
      100 * Math.sqrt(1 - 2 * 0.05 * 0.05),
      10,
    )
    expect(cWp?.formula?.plainZh).toMatch(/SDOF|峰|角频率|阻尼|固有/)

    const cWpR = flat.find((n) => n.id === 'mindlin-compose-peak-omega-residual')
    expect(cWpR?.formula?.expr).toMatch(/omega_p|omega_sdof|omega_n/)
    expect(cWpR?.formula?.expected).toBeCloseTo(0, 10)
    expect(cWpR?.formula?.plainZh).toMatch(/峰频|残差|SDOF|诚实/)

    const cDw = flat.find((n) => n.id === 'mindlin-compose-dual-path-abs-diff-w')
    expect(cDw?.formula?.expr).toMatch(/d_w|dualPathMaxPeakFactorAbsDiff/)
    expect(cDw?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDw?.formula?.plainZh).toMatch(/双路径|峰因子|绝对差/)

    const cDe = flat.find((n) => n.id === 'mindlin-compose-dual-path-abs-diff-E')
    expect(cDe?.formula?.expr).toMatch(/d_E|dualPathMaxPeakFactorAbsDiff/)
    expect(cDe?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDe?.formula?.plainZh).toMatch(/能量|双路径|峰因子|绝对差/)

    const cJmax = flat.find((n) => n.id === 'mindlin-compose-joint-max-abs-diff')
    expect(cJmax?.formula?.expr).toMatch(/joint_max|max|d_w|d_E/)
    expect(cJmax?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cJmax?.formula?.plainZh).toMatch(/联合|双路径|上确界|最大/)

    const cJmean = flat.find(
      (n) => n.id === 'mindlin-compose-joint-mean-abs-diff',
    )
    expect(cJmean?.formula?.expr).toMatch(/joint_mean|d_w|d_E/)
    expect(cJmean?.formula?.expected).toBeCloseTo(0.015, 10)
    expect(cJmean?.formula?.plainZh).toMatch(/联合|平均|双路径|一半/)

    const cPar = flat.find((n) => n.id === 'mindlin-compose-expand-path-parity')
    expect(cPar?.formula?.expr).toMatch(/parity|d_w|d_E/)
    expect(cPar?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(cPar?.formula?.plainZh).toMatch(/expand|对偶|双路径|绝对差/)

    const cParR = flat.find(
      (n) => n.id === 'mindlin-compose-expand-path-parity-residual',
    )
    expect(cParR?.formula?.expr).toMatch(/parity|tol/)
    expect(cParR?.formula?.expected).toBeCloseTo(0, 10)
    expect(cParR?.formula?.plainZh).toMatch(/expand|对偶|残差|容差/)

    const cRotD = flat.find((n) => n.id === 'mindlin-compose-rotary-omega-drop')
    expect(cRotD?.formula?.expr).toMatch(/delta_omega|omega_no|omega_rot/)
    expect(cRotD?.formula?.expected).toBeCloseTo(2, 10)
    expect(cRotD?.formula?.plainZh).toMatch(/转动|降频|基频/)

    const cRotR = flat.find(
      (n) => n.id === 'mindlin-compose-rotary-omega-residual',
    )
    expect(cRotR?.formula?.expr).toMatch(/omega_rot|omega_no|max/)
    expect(cRotR?.formula?.expected).toBeCloseTo(0, 10)
    expect(cRotR?.formula?.plainZh).toMatch(/转动|降频|诚实|残差/)

    const cGate = flat.find(
      (n) => n.id === 'mindlin-compose-packaging-honest-gate',
    )
    expect(cGate?.formula?.expr).toMatch(/gate|c_dp|c_pf/)
    expect(cGate?.formula?.expected).toBeCloseTo(1, 10)
    expect(cGate?.formula?.plainZh).toMatch(/包装|诚实|门|子诚实/)

    // S26bw half-power / energy Q × κ residual packaging (wave28 residual compose expand)
    const cQwK = flat.find((n) => n.id === 'mindlin-compose-Qw-at-kappa')
    expect(cQwK?.formula?.expr).toMatch(/Q_w|zeta/)
    expect(cQwK?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQwK?.formula?.plainZh).toMatch(/半功率|品质|阻尼|κ|诚实/)

    const cQeK = flat.find((n) => n.id === 'mindlin-compose-QE-at-kappa')
    expect(cQeK?.formula?.expr).toMatch(/Q_E|zeta/)
    expect(cQeK?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQeK?.formula?.plainZh).toMatch(/能量|半功率|品质|κ/)

    const cQconsK = flat.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-kappa',
    )
    expect(cQconsK?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(cQconsK?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQconsK?.formula?.plainZh).toMatch(/一致性|残差|半功率|κ/)

    const cSk = flat.find((n) => n.id === 'mindlin-compose-S-kappa')
    expect(cSk?.formula?.expr).toMatch(/kappa|G|t/)
    expect(cSk?.formula?.expected).toBeCloseTo(
      (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.2,
      6,
    )
    expect(cSk?.formula?.plainZh).toMatch(/剪切|刚度|修正|厚度/)

    const cOmK = flat.find(
      (n) => n.id === 'mindlin-compose-omega-kappa-monotone',
    )
    expect(cOmK?.formula?.expr).toMatch(/omega_hi|omega_lo/)
    expect(cOmK?.formula?.expected).toBeCloseTo(2, 10)
    expect(cOmK?.formula?.plainZh).toMatch(/剪切修正|基频|升/)

    const cOmKR = flat.find(
      (n) => n.id === 'mindlin-compose-omega-kappa-residual',
    )
    expect(cOmKR?.formula?.expr).toMatch(/omega_lo|omega_hi|max/)
    expect(cOmKR?.formula?.expected).toBeCloseTo(0, 10)
    expect(cOmKR?.formula?.plainZh).toMatch(/单调|诚实|残差/)

    const cQspan = flat.find((n) => n.id === 'mindlin-compose-Q-kappa-dual-span')
    expect(cQspan?.formula?.expr).toMatch(/Q_span|Q_max|Q_min/)
    expect(cQspan?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQspan?.formula?.plainZh).toMatch(/跨度|半功率|κ|诚实/)

    const cFkappa = flat.find((n) => n.id === 'mindlin-compose-f-shear-kappa')
    expect(cFkappa?.formula?.expr).toMatch(/kappa|D|G|t/)
    expect(cFkappa?.formula?.expected).toEqual(expect.any(Number))
    expect(Number.isFinite(cFkappa!.formula!.expected as number)).toBe(true)
    expect(cFkappa?.formula?.plainZh).toMatch(/剪切|放大|弯曲|刚度/)

    const cQkg = flat.find(
      (n) => n.id === 'mindlin-compose-Q-kappa-honesty-gate',
    )
    expect(cQkg?.formula?.expr).toMatch(/gate|c_Qw|c_QE/)
    expect(cQkg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQkg?.formula?.plainZh).toMatch(/Q×κ|包装|诚实|门/)

    // S26bx half-power / energy Q × thickness residual packaging (wave29 residual compose expand)
    const cQwT = flat.find((n) => n.id === 'mindlin-compose-Qw-at-thickness')
    expect(cQwT?.formula?.expr).toMatch(/Q_w|zeta/)
    expect(cQwT?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQwT?.formula?.plainZh).toMatch(/半功率|品质|阻尼|厚度|诚实/)

    const cQeT = flat.find((n) => n.id === 'mindlin-compose-QE-at-thickness')
    expect(cQeT?.formula?.expr).toMatch(/Q_E|zeta/)
    expect(cQeT?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQeT?.formula?.plainZh).toMatch(/能量|半功率|品质|厚度/)

    const cQconsT = flat.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-thickness',
    )
    expect(cQconsT?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(cQconsT?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQconsT?.formula?.plainZh).toMatch(/一致性|残差|半功率|厚度/)

    const cSt = flat.find((n) => n.id === 'mindlin-compose-S-thickness')
    expect(cSt?.formula?.expr).toMatch(/kappa|G|t/)
    expect(cSt?.formula?.expected).toBeCloseTo(
      (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.1,
      6,
    )
    expect(cSt?.formula?.plainZh).toMatch(/剪切|刚度|厚度/)

    const cDt = flat.find((n) => n.id === 'mindlin-compose-D-thickness')
    expect(cDt?.formula?.expr).toMatch(/E|t|nu/)
    expect(cDt?.formula?.expected).toBeCloseTo(
      (2.1e11 * Math.pow(0.1, 3)) / (12 * (1 - 0.3 * 0.3)),
      6,
    )
    expect(cDt?.formula?.plainZh).toMatch(/弯曲|刚度|厚度/)

    const cOmTR = flat.find(
      (n) => n.id === 'mindlin-compose-omega-thickness-ratio',
    )
    expect(cOmTR?.formula?.expr).toMatch(/omega_thin|omega_thick/)
    expect(cOmTR?.formula?.expected).toBeCloseTo(1.2, 10)
    expect(cOmTR?.formula?.plainZh).toMatch(/薄|厚|基频|比/)

    const cOmTRes = flat.find(
      (n) => n.id === 'mindlin-compose-omega-thickness-residual',
    )
    expect(cOmTRes?.formula?.expr).toMatch(/omega_thick|omega_thin|max/)
    expect(cOmTRes?.formula?.expected).toBeCloseTo(0, 10)
    expect(cOmTRes?.formula?.plainZh).toMatch(/厚度|单调|诚实|残差/)

    const cQspanT = flat.find(
      (n) => n.id === 'mindlin-compose-Q-thickness-dual-span',
    )
    expect(cQspanT?.formula?.expr).toMatch(/Q_span_t|Q_max|Q_min/)
    expect(cQspanT?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQspanT?.formula?.plainZh).toMatch(/跨度|半功率|厚度|诚实/)

    const cPhiT = flat.find(
      (n) => n.id === 'mindlin-compose-shear-fraction-thickness',
    )
    expect(cPhiT?.formula?.expr).toMatch(/phi_s|w_s|w_b/)
    expect(cPhiT?.formula?.expected).toBeCloseTo(0.2, 10)
    expect(cPhiT?.formula?.plainZh).toMatch(/剪切|挠度|占比/)

    const cQtg = flat.find(
      (n) => n.id === 'mindlin-compose-Q-thickness-honesty-gate',
    )
    expect(cQtg?.formula?.expr).toMatch(/gate|c_Qw|c_QE/)
    expect(cQtg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQtg?.formula?.plainZh).toMatch(/Q×厚度|包装|诚实|门/)

    // S26by half-power / energy Q × thickness×κ residual packaging (wave30 residual compose expand)
    const cQwTk = flat.find(
      (n) => n.id === 'mindlin-compose-Qw-at-thickness-kappa',
    )
    expect(cQwTk?.formula?.expr).toMatch(/Q_w|zeta/)
    expect(cQwTk?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQwTk?.formula?.plainZh).toMatch(/半功率|品质|阻尼|厚度|κ|诚实/)

    const cQeTk = flat.find(
      (n) => n.id === 'mindlin-compose-QE-at-thickness-kappa',
    )
    expect(cQeTk?.formula?.expr).toMatch(/Q_E|zeta/)
    expect(cQeTk?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQeTk?.formula?.plainZh).toMatch(/能量|半功率|品质|厚度|κ/)

    const cQconsTk = flat.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-thickness-kappa',
    )
    expect(cQconsTk?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(cQconsTk?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQconsTk?.formula?.plainZh).toMatch(/一致性|残差|半功率|厚度|κ/)

    const cStk = flat.find((n) => n.id === 'mindlin-compose-S-thickness-kappa')
    expect(cStk?.formula?.expr).toMatch(/kappa|G|t/)
    expect(cStk?.formula?.expected).toBeCloseTo(
      (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.1,
      6,
    )
    expect(cStk?.formula?.plainZh).toMatch(/剪切|刚度|厚度|κ/)

    const cOmKT = flat.find(
      (n) => n.id === 'mindlin-compose-omega-kappa-at-thickness',
    )
    expect(cOmKT?.formula?.expr).toMatch(/omega_hi|omega_lo/)
    expect(cOmKT?.formula?.expected).toBeCloseTo(1.1, 10)
    expect(cOmKT?.formula?.plainZh).toMatch(/κ|基频|升|厚度/)

    const cQspanTk = flat.find(
      (n) => n.id === 'mindlin-compose-Q-thickness-kappa-dual-span',
    )
    expect(cQspanTk?.formula?.expr).toMatch(/Q_span_tk|Q_max|Q_min/)
    expect(cQspanTk?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQspanTk?.formula?.plainZh).toMatch(/跨度|半功率|厚度|κ|诚实/)

    const cQtkg = flat.find(
      (n) => n.id === 'mindlin-compose-Q-thickness-kappa-honesty-gate',
    )
    expect(cQtkg?.formula?.expr).toMatch(/gate|c_Qw|c_QE/)
    expect(cQtkg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQtkg?.formula?.plainZh).toMatch(/Q×厚度×κ|包装|诚实|门/)

    // S26bz half-power / energy Q × thickness×κ rotary dual + aspect×κ (wave31 residual compose expand)
    const cQwRot = flat.find(
      (n) => n.id === 'mindlin-compose-Qw-rotary-dual-thickness-kappa',
    )
    expect(cQwRot?.formula?.expr).toMatch(/Q_w|zeta/)
    expect(cQwRot?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQwRot?.formula?.plainZh).toMatch(/半功率|品质|阻尼|rotary/)

    const cQeRot = flat.find(
      (n) => n.id === 'mindlin-compose-QE-rotary-dual-thickness-kappa',
    )
    expect(cQeRot?.formula?.expr).toMatch(/Q_E|zeta/)
    expect(cQeRot?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQeRot?.formula?.plainZh).toMatch(/能量|半功率|品质/)

    const cQconsRot = flat.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-rotary-thickness-kappa',
    )
    expect(cQconsRot?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(cQconsRot?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQconsRot?.formula?.plainZh).toMatch(/转动|一致性|半功率/)

    const cOmDrop = flat.find((n) => n.id === 'mindlin-compose-omega-rotary-drop')
    expect(cOmDrop?.formula?.expr).toMatch(/omega_no|omega_rot/)
    expect(cOmDrop?.formula?.expected).toBeCloseTo(1.1, 10)
    expect(cOmDrop?.formula?.plainZh).toMatch(/rotary|降频|基频/)

    const cQwAk = flat.find((n) => n.id === 'mindlin-compose-Qw-at-aspect-kappa')
    expect(cQwAk?.formula?.expr).toMatch(/Q_w|zeta/)
    expect(cQwAk?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQwAk?.formula?.plainZh).toMatch(/aspect|半功率|品质/)

    const cQconsAk = flat.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-aspect-kappa',
    )
    expect(cQconsAk?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(cQconsAk?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQconsAk?.formula?.plainZh).toMatch(/aspect|一致性|半功率/)

    const cQrag = flat.find(
      (n) => n.id === 'mindlin-compose-Q-rotary-aspect-honesty-gate',
    )
    expect(cQrag?.formula?.expr).toMatch(/gate|c_Qw|c_rot/)
    expect(cQrag?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQrag?.formula?.plainZh).toMatch(/Q×rotary×aspect|包装|诚实|门/)

    // S26ca Q/energy × aspect/thickness/κ rotary dual residual (wave32 residual compose expand)
    const cQwRak = flat.find(
      (n) => n.id === 'mindlin-compose-Qw-rotary-dual-aspect-kappa',
    )
    expect(cQwRak?.formula?.expr).toMatch(/Q_w|zeta/)
    expect(cQwRak?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQwRak?.formula?.plainZh).toMatch(/aspect|半功率|品质|rotary/)

    const cQeRak = flat.find(
      (n) => n.id === 'mindlin-compose-QE-rotary-dual-aspect-kappa',
    )
    expect(cQeRak?.formula?.expr).toMatch(/Q_E|zeta/)
    expect(cQeRak?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQeRak?.formula?.plainZh).toMatch(/aspect|能量|半功率|品质/)

    const cQconsRak = flat.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-rotary-aspect-kappa',
    )
    expect(cQconsRak?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(cQconsRak?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQconsRak?.formula?.plainZh).toMatch(/aspect|转动|一致性|半功率/)

    const cQwRat = flat.find(
      (n) => n.id === 'mindlin-compose-Qw-rotary-dual-aspect-thickness',
    )
    expect(cQwRat?.formula?.expr).toMatch(/Q_w|zeta/)
    expect(cQwRat?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQwRat?.formula?.plainZh).toMatch(/aspect|thickness|半功率|品质/)

    const cQeRat = flat.find(
      (n) => n.id === 'mindlin-compose-QE-rotary-dual-aspect-thickness',
    )
    expect(cQeRat?.formula?.expr).toMatch(/Q_E|zeta/)
    expect(cQeRat?.formula?.expected).toBeCloseTo(10, 10)
    expect(cQeRat?.formula?.plainZh).toMatch(/aspect|thickness|能量|半功率/)

    const cQconsRat = flat.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-rotary-aspect-thickness',
    )
    expect(cQconsRat?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(cQconsRat?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQconsRat?.formula?.plainZh).toMatch(/aspect|thickness|一致性|半功率/)

    const cQratg = flat.find(
      (n) => n.id === 'mindlin-compose-Q-rotary-aspect-thickness-honesty-gate',
    )
    expect(cQratg?.formula?.expr).toMatch(/gate|c_Qw_ak|c_cons_at/)
    expect(cQratg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQratg?.formula?.plainZh).toMatch(
      /Q×rotary×aspect×thickness|包装|诚实|门/,
    )

    // S26cb half-power/energy Q×aspect×thickness rotary dual-path honesty (wave33 residual compose expand)
    const cQwDp = flat.find(
      (n) => n.id === 'mindlin-compose-Qw-dual-path-parity-aspect-thickness',
    )
    expect(cQwDp?.formula?.expr).toMatch(/Q_w_no|Q_w_rot/)
    expect(cQwDp?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQwDp?.formula?.plainZh).toMatch(/aspect|thickness|dual-path|parity/)

    const cQeDp = flat.find(
      (n) => n.id === 'mindlin-compose-QE-dual-path-parity-aspect-thickness',
    )
    expect(cQeDp?.formula?.expr).toMatch(/Q_E_no|Q_E_rot/)
    expect(cQeDp?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQeDp?.formula?.plainZh).toMatch(/aspect|thickness|dual-path|parity/)

    const cQjDp = flat.find(
      (n) => n.id === 'mindlin-compose-Q-dual-path-joint-max-aspect-thickness',
    )
    expect(cQjDp?.formula?.expr).toMatch(/joint_max|d_Qw|d_QE/)
    expect(cQjDp?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cQjDp?.formula?.plainZh).toMatch(/dual-path|joint|上确界/)

    const cQpDp = flat.find(
      (n) => n.id === 'mindlin-compose-Q-dual-path-parity-w-E-aspect-thickness',
    )
    expect(cQpDp?.formula?.expr).toMatch(/parity|d_Qw|d_QE/)
    expect(cQpDp?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQpDp?.formula?.plainZh).toMatch(/dual-path|parity|诚实/)

    const cQcBp = flat.find(
      (n) =>
        n.id === 'mindlin-compose-Q-consistency-both-paths-aspect-thickness',
    )
    expect(cQcBp?.formula?.expr).toMatch(/Q_w|Q_E/)
    expect(cQcBp?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQcBp?.formula?.plainZh).toMatch(/双路径|一致性|半功率/)

    const cQdpg = flat.find(
      (n) =>
        n.id === 'mindlin-compose-Q-aspect-thickness-dual-path-honesty-gate',
    )
    expect(cQdpg?.formula?.expr).toMatch(/gate|c_Qw_dp|c_parity/)
    expect(cQdpg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQdpg?.formula?.plainZh).toMatch(
      /Q×aspect×thickness dual-path|包装|诚实|门/,
    )

    // S26cc half-power/energy Q×aspect×thickness rotary dual-path expand (wave34 residual compose expand)
    const cQjm = flat.find(
      (n) => n.id === 'mindlin-compose-Q-dual-path-joint-mean-aspect-thickness',
    )
    expect(cQjm?.formula?.expr).toMatch(/joint_mean|d_Qw|d_QE/)
    expect(cQjm?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cQjm?.formula?.plainZh).toMatch(/dual-path|joint|均值/)

    const cQwRel = flat.find(
      (n) => n.id === 'mindlin-compose-Qw-dual-path-relative-aspect-thickness',
    )
    expect(cQwRel?.formula?.expr).toMatch(/Q_w_no|Q_w_rot/)
    expect(cQwRel?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQwRel?.formula?.plainZh).toMatch(/aspect|thickness|dual-path|相对/)

    const cQeRel = flat.find(
      (n) => n.id === 'mindlin-compose-QE-dual-path-relative-aspect-thickness',
    )
    expect(cQeRel?.formula?.expr).toMatch(/Q_E_no|Q_E_rot/)
    expect(cQeRel?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQeRel?.formula?.plainZh).toMatch(/aspect|thickness|dual-path|相对/)

    const cQrp = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-dual-path-w-E-relative-parity-aspect-thickness',
    )
    expect(cQrp?.formula?.expr).toMatch(/parity|rel_w|rel_E/)
    expect(cQrp?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQrp?.formula?.plainZh).toMatch(/dual-path|parity|相对|诚实/)

    const cQpack = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-dual-path-w-E-packaging-residual-aspect-thickness',
    )
    expect(cQpack?.formula?.expr).toMatch(/pack|joint_mean|parity/)
    expect(cQpack?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cQpack?.formula?.plainZh).toMatch(/packaging|dual-path|残差/)

    const cQdpeg = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-aspect-thickness-dual-path-expand-honesty-gate',
    )
    expect(cQdpeg?.formula?.expr).toMatch(/gate|c_mean|c_parity/)
    expect(cQdpeg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQdpeg?.formula?.plainZh).toMatch(
      /Q×aspect×thickness dual-path expand|包装|诚实|门/,
    )

    // S26cd half-power/energy Q×thickness×κ rotary dual-path honesty (wave35 residual compose expand)
    const cQtkW = flat.find(
      (n) => n.id === 'mindlin-compose-Qw-thickness-kappa-dual-path-honesty',
    )
    expect(cQtkW?.formula?.expr).toMatch(/Q_w_no|Q_w_rot/)
    expect(cQtkW?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQtkW?.formula?.plainZh).toMatch(/thickness|κ|dual-path|相对/)

    const cQtkE = flat.find(
      (n) => n.id === 'mindlin-compose-QE-thickness-kappa-dual-path-honesty',
    )
    expect(cQtkE?.formula?.expr).toMatch(/Q_E_no|Q_E_rot/)
    expect(cQtkE?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQtkE?.formula?.plainZh).toMatch(/thickness|κ|dual-path|相对/)

    const cQtkJ = flat.find(
      (n) => n.id === 'mindlin-compose-Q-thickness-kappa-dual-path-joint-max',
    )
    expect(cQtkJ?.formula?.expr).toMatch(/joint_max|d_Qw|d_QE/)
    expect(cQtkJ?.formula?.expected).toBeCloseTo(0.03, 10)
    expect(cQtkJ?.formula?.plainZh).toMatch(/dual-path|joint|上确界/)

    const cQtkP = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-thickness-kappa-dual-path-consistency-parity',
    )
    expect(cQtkP?.formula?.expr).toMatch(/parity|d_Qw|d_QE/)
    expect(cQtkP?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQtkP?.formula?.plainZh).toMatch(/parity|consistency|诚实/)

    const cQtkPack = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-thickness-kappa-dual-path-packaging-residual',
    )
    expect(cQtkPack?.formula?.expr).toMatch(/pack|joint_max|parity/)
    expect(cQtkPack?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cQtkPack?.formula?.plainZh).toMatch(/packaging|dual-path|残差/)

    const cQtkGate = flat.find(
      (n) =>
        n.id === 'mindlin-compose-Q-thickness-kappa-dual-path-honesty-gate',
    )
    expect(cQtkGate?.formula?.expr).toMatch(/gate|c_Qw|c_QE/)
    expect(cQtkGate?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQtkGate?.formula?.plainZh).toMatch(
      /Q×thickness×κ dual-path|包装|诚实|门/,
    )

    // S26ce half-power/energy Q×thickness×κ dual-path expand (wave36 residual compose expand; bridges wave35)
    const cQtkeW = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Qw-thickness-kappa-dual-path-expand-consistency',
    )
    expect(cQtkeW?.formula?.expr).toMatch(/d_w_no|d_w_rot/)
    expect(cQtkeW?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQtkeW?.formula?.plainZh).toMatch(/thickness|κ|expand|consistency/)

    const cQtkeE = flat.find(
      (n) =>
        n.id === 'mindlin-compose-QE-thickness-kappa-dual-path-expand-parity',
    )
    expect(cQtkeE?.formula?.expr).toMatch(/d_E_no|d_E_rot/)
    expect(cQtkeE?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQtkeE?.formula?.plainZh).toMatch(/thickness|κ|expand|parity/)

    const cQtkeJ = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-thickness-kappa-dual-path-expand-joint-mean',
    )
    expect(cQtkeJ?.formula?.expr).toMatch(/joint_mean|d_w|d_E/)
    expect(cQtkeJ?.formula?.expected).toBeCloseTo(0.03, 10)
    expect(cQtkeJ?.formula?.plainZh).toMatch(/dual-path expand|joint|均值/)

    const cQtkeP = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-thickness-kappa-dual-path-expand-path-parity',
    )
    expect(cQtkeP?.formula?.expr).toMatch(/parity|d_w|d_E/)
    expect(cQtkeP?.formula?.expected).toBeCloseTo(0, 10)
    expect(cQtkeP?.formula?.plainZh).toMatch(/expand-path|parity|诚实/)

    const cQtkePack = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-thickness-kappa-dual-path-expand-packaging-residual',
    )
    expect(cQtkePack?.formula?.expr).toMatch(/pack|joint_mean|parity/)
    expect(cQtkePack?.formula?.expected).toBeCloseTo(0.03, 10)
    expect(cQtkePack?.formula?.plainZh).toMatch(/packaging|expand|残差/)

    const cQtkeGate = flat.find(
      (n) =>
        n.id ===
        'mindlin-compose-Q-thickness-kappa-dual-path-expand-honesty-gate',
    )
    expect(cQtkeGate?.formula?.expr).toMatch(/gate|c_w|c_E|c_mean/)
    expect(cQtkeGate?.formula?.expected).toBeCloseTo(1, 10)
    expect(cQtkeGate?.formula?.plainZh).toMatch(
      /Q×thickness×κ dual-path expand|包装|诚实|门/,
    )


    const composeWithFormula = flat.filter(
      (n) => n.id.startsWith('mindlin-compose-') && n.formula,
    )
    expect(composeWithFormula.length).toBeGreaterThanOrEqual(108)
    for (const n of composeWithFormula) {
      expect(n.formula?.plainZh && n.formula.plainZh.length).toBeGreaterThan(4)
      expect(n.formula?.plainEn && n.formula.plainEn.length).toBeGreaterThan(4)
      expect(n.formula?.expected).toEqual(expect.any(Number))
      expect(Number.isFinite(n.formula!.expected as number)).toBe(true)
    }
  })

  it('mindlin enrichWithFormulaViews attaches plainZh on compose formulas', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-structural-mindlin'],
      layers: 'all',
    })
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const wM = enriched.find(
      (n) => n.id === 'mindlin-compose-wM-shear' && n.formulaView,
    )
    expect(wM?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(wM?.formulaView?.expr).toMatch(/w_M|w_K/)
    const thin = enriched.find(
      (n) => n.id === 'mindlin-compose-thin-limit' && n.formulaView,
    )
    expect(thin?.formulaView?.plainZh).toMatch(/薄|残差|Mindlin|Kirchhoff/)
    const cS = enriched.find(
      (n) => n.id === 'mindlin-compose-S' && n.formulaView,
    )
    expect(cS?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(cS?.formulaView?.expr).toMatch(/kappa|E/)
    const om = enriched.find(
      (n) => n.id === 'mindlin-compose-omega' && n.formulaView,
    )
    expect(om?.formulaView?.plainZh).toMatch(/固有|频率|弯曲|板/)
    const circ = enriched.find(
      (n) => n.id === 'mindlin-compose-circ-w' && n.formulaView,
    )
    expect(circ?.formulaView?.plainZh).toMatch(/圆板|挠度/)
    const thick = enriched.find(
      (n) => n.id === 'mindlin-compose-thick-residual' && n.formulaView,
    )
    expect(thick?.formulaView?.plainZh).toMatch(/厚|剪切|超差/)
    const fShear = enriched.find(
      (n) => n.id === 'mindlin-compose-f-shear' && n.formulaView,
    )
    expect(fShear?.formulaView?.plainZh).toMatch(/剪切|放大|弯曲|刚度/)
    const omRes = enriched.find(
      (n) => n.id === 'mindlin-compose-omega-residual' && n.formulaView,
    )
    expect(omRes?.formulaView?.plainZh).toMatch(/频散|残差|Mindlin|Kirchhoff/)
    const zetaQ = enriched.find(
      (n) => n.id === 'mindlin-compose-zeta-peak' && n.formulaView,
    )
    expect(zetaQ?.formulaView?.plainZh).toMatch(/阻尼|共振|放大|峰/)
    const aspect = enriched.find(
      (n) => n.id === 'mindlin-compose-aspect' && n.formulaView,
    )
    expect(aspect?.formulaView?.plainZh).toMatch(/长细|厚度|薄|剪切/)
    const kappaC = enriched.find(
      (n) => n.id === 'mindlin-compose-kappa' && n.formulaView,
    )
    expect(kappaC?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const halfP = enriched.find(
      (n) => n.id === 'mindlin-compose-half-power' && n.formulaView,
    )
    expect(halfP?.formulaView?.plainZh).toMatch(/半功率|带宽|阻尼/)
    const rotI = enriched.find(
      (n) => n.id === 'mindlin-compose-rotary-I' && n.formulaView,
    )
    expect(rotI?.formulaView?.plainZh).toMatch(/转动|惯量/)
    const peakC = enriched.find(
      (n) => n.id === 'mindlin-compose-peak-consistency' && n.formulaView,
    )
    expect(peakC?.formulaView?.plainZh).toMatch(/峰|一致性|残差/)
    const qMatch = enriched.find(
      (n) => n.id === 'mindlin-compose-Q-match' && n.formulaView,
    )
    expect(qMatch?.formulaView?.plainZh).toMatch(/半功率|匹配|残差/)
    const pf = enriched.find(
      (n) => n.id === 'mindlin-compose-peak-factor' && n.formulaView,
    )
    expect(pf?.formulaView?.plainZh).toMatch(/峰|因子/)
    const pe = enriched.find(
      (n) => n.id === 'mindlin-compose-energy-peak-factor' && n.formulaView,
    )
    expect(pe?.formulaView?.plainZh).toMatch(/能量|峰|因子/)
    const jmax = enriched.find(
      (n) => n.id === 'mindlin-compose-joint-max-abs-diff' && n.formulaView,
    )
    expect(jmax?.formulaView?.plainZh).toMatch(/联合|双路径|上确界|最大/)
    const qwK = enriched.find(
      (n) => n.id === 'mindlin-compose-Qw-at-kappa' && n.formulaView,
    )
    expect(qwK?.formulaView?.plainZh).toMatch(/半功率|品质|阻尼|κ/)
    const qConsK = enriched.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-kappa' && n.formulaView,
    )
    expect(qConsK?.formulaView?.plainZh).toMatch(/一致性|残差|半功率/)
    const omK = enriched.find(
      (n) => n.id === 'mindlin-compose-omega-kappa-monotone' && n.formulaView,
    )
    expect(omK?.formulaView?.plainZh).toMatch(/剪切修正|基频|升/)
    const qkg = enriched.find(
      (n) => n.id === 'mindlin-compose-Q-kappa-honesty-gate' && n.formulaView,
    )
    expect(qkg?.formulaView?.plainZh).toMatch(/Q×κ|包装|诚实|门/)
    const qwT = enriched.find(
      (n) => n.id === 'mindlin-compose-Qw-at-thickness' && n.formulaView,
    )
    expect(qwT?.formulaView?.plainZh).toMatch(/半功率|品质|阻尼|厚度/)
    const qConsT = enriched.find(
      (n) => n.id === 'mindlin-compose-Q-consistency-thickness' && n.formulaView,
    )
    expect(qConsT?.formulaView?.plainZh).toMatch(/一致性|残差|半功率|厚度/)
    const qtg = enriched.find(
      (n) => n.id === 'mindlin-compose-Q-thickness-honesty-gate' && n.formulaView,
    )
    expect(qtg?.formulaView?.plainZh).toMatch(/Q×厚度|包装|诚实|门/)
    const qwTk = enriched.find(
      (n) => n.id === 'mindlin-compose-Qw-at-thickness-kappa' && n.formulaView,
    )
    expect(qwTk?.formulaView?.plainZh).toMatch(/半功率|品质|阻尼|厚度|κ/)
    const qConsTk = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Q-consistency-thickness-kappa' &&
        n.formulaView,
    )
    expect(qConsTk?.formulaView?.plainZh).toMatch(/一致性|残差|半功率|厚度|κ/)
    const qtkg = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Q-thickness-kappa-honesty-gate' &&
        n.formulaView,
    )
    expect(qtkg?.formulaView?.plainZh).toMatch(/Q×厚度×κ|包装|诚实|门/)
    const qwRot = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Qw-rotary-dual-thickness-kappa' &&
        n.formulaView,
    )
    expect(qwRot?.formulaView?.plainZh).toMatch(/半功率|品质|阻尼|rotary/)
    const qrag = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Q-rotary-aspect-honesty-gate' && n.formulaView,
    )
    expect(qrag?.formulaView?.plainZh).toMatch(/Q×rotary×aspect|包装|诚实|门/)
    const qwRak = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Qw-rotary-dual-aspect-kappa' && n.formulaView,
    )
    expect(qwRak?.formulaView?.plainZh).toMatch(/aspect|半功率|品质|rotary/)
    const qratg = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Q-rotary-aspect-thickness-honesty-gate' &&
        n.formulaView,
    )
    expect(qratg?.formulaView?.plainZh).toMatch(
      /Q×rotary×aspect×thickness|包装|诚实|门/,
    )
    const qwDp = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Qw-dual-path-parity-aspect-thickness' &&
        n.formulaView,
    )
    expect(qwDp?.formulaView?.plainZh).toMatch(
      /aspect|thickness|dual-path|parity/,
    )
    const qdpg = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Q-aspect-thickness-dual-path-honesty-gate' &&
        n.formulaView,
    )
    expect(qdpg?.formulaView?.plainZh).toMatch(
      /Q×aspect×thickness dual-path|包装|诚实|门/,
    )
    const qwRel = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Qw-dual-path-relative-aspect-thickness' &&
        n.formulaView,
    )
    expect(qwRel?.formulaView?.plainZh).toMatch(
      /aspect|thickness|dual-path|相对/,
    )
    const qdpeg = enriched.find(
      (n) =>
        n.id ===
          'mindlin-compose-Q-aspect-thickness-dual-path-expand-honesty-gate' &&
        n.formulaView,
    )
    expect(qdpeg?.formulaView?.plainZh).toMatch(
      /Q×aspect×thickness dual-path expand|包装|诚实|门/,
    )
    const qtkW = enriched.find(
      (n) =>
        n.id === 'mindlin-compose-Qw-thickness-kappa-dual-path-honesty' &&
        n.formulaView,
    )
    expect(qtkW?.formulaView?.plainZh).toMatch(/thickness|κ|dual-path|相对/)
    const qtkGate = enriched.find(
      (n) =>
        n.id ===
          'mindlin-compose-Q-thickness-kappa-dual-path-honesty-gate' &&
        n.formulaView,
    )
    expect(qtkGate?.formulaView?.plainZh).toMatch(
      /Q×thickness×κ dual-path|包装|诚实|门/,
    )
    const parity = enriched.find(
      (n) => n.id === 'mindlin-compose-expand-path-parity' && n.formulaView,
    )
    expect(parity?.formulaView?.plainZh).toMatch(/expand|对偶|双路径/)
    const gate = enriched.find(
      (n) => n.id === 'mindlin-compose-packaging-honest-gate' && n.formulaView,
    )
    expect(gate?.formulaView?.plainZh).toMatch(/包装|诚实|门/)
    const wp = enriched.find(
      (n) => n.id === 'mindlin-compose-peak-omega-sdof' && n.formulaView,
    )
    expect(wp?.formulaView?.plainZh).toMatch(/SDOF|峰|角频率|阻尼/)
  })

  it('findMethodsByLink jobKind structural-static', () => {
    const hit = findMethodsByLink({ jobKind: 'structural-static' })
    expect(hit.some((m) => m.id === 'kind-structural-mindlin')).toBe(true)
  })

  it('parallel session includes Mindlin with em and igbt', () => {
    const session = buildParallelExplainSession({
      methodIds: [
        'kind-structural-mindlin',
        'kind-em-fdtd-3d',
        'kind-electro-thermal-igbt',
      ],
      layers: 'all',
    })
    expect(session.methods).toHaveLength(3)
    expect(
      session.allSubExplains.some((n) => n.id === 'mindlin-foundation-D'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'mindlin-foundation-shear-factor'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'mindlin-compose-wM-shear'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'mindlin-compose-thin-limit'),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'mindlin-compose-joint-max-abs-diff',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'mindlin-compose-packaging-honest-gate',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'mindlin-compose-Q-consistency-kappa',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'mindlin-compose-Q-kappa-honesty-gate',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'mindlin-compose-Q-consistency-thickness',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'mindlin-compose-Q-thickness-honesty-gate',
      ),
    ).toBe(true)
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const mindlin = enriched.find(
      (n) => n.id === 'mindlin-foundation-S' && n.formulaView,
    )
    expect(mindlin?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(mindlin?.formulaView?.expr).toContain('kappa')
    const compose = enriched.find(
      (n) => n.id === 'mindlin-compose-D' && n.formulaView,
    )
    expect(compose?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const s26bu = enriched.find(
      (n) => n.id === 'mindlin-compose-expand-path-parity' && n.formulaView,
    )
    expect(s26bu?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const s26bw = enriched.find(
      (n) => n.id === 'mindlin-compose-Qw-at-kappa' && n.formulaView,
    )
    expect(s26bw?.formulaView?.plainZh.length).toBeGreaterThan(4)
  })

  it('lbm-d3q19 drills method → principle → foundation with BGK/cavity formulas', () => {
    const tree = getMethodExplainTree('kind-lbm-d3q19')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    const layers = new Set(flat.map((n) => n.layer))
    expect(layers.has('method')).toBe(true)
    expect(layers.has('principle')).toBe(true)
    expect(layers.has('foundation')).toBe(true)
    expect(layers.has('engineering')).toBe(true)
    expect(layers.has('compose')).toBe(true)
    expect(layers.has('L0')).toBe(true)

    const nu = flat.find((n) => n.id === 'lbm-foundation-viscosity')
    expect(nu?.formula?.expr).toMatch(/cs2|tau/)
    expect(nu?.formula?.expected).toBeCloseTo(1 / 6, 10)
    expect(nu?.formula?.plainZh).toMatch(/粘度|松弛/)

    const cs2 = flat.find((n) => n.id === 'lbm-foundation-cs2')
    expect(cs2?.formula?.expected).toBeCloseTo(1 / 3, 10)

    const bgk = flat.find((n) => n.id === 'lbm-foundation-bgk-update')
    expect(bgk?.formula?.expr).toMatch(/f_eq|tau/)
    expect(bgk?.formula?.expected).toBeCloseTo(0.25, 10)

    const rho = flat.find((n) => n.id === 'lbm-foundation-rho')
    expect(rho?.formula?.expected).toBeCloseTo(1, 10)
    expect(rho?.formula?.plainZh).toMatch(/密度|分布/)

    const w = flat.find((n) => n.id === 'lbm-foundation-weights')
    expect(w?.formula?.expected).toBeCloseTo(1, 10)
    expect(w?.formula?.plainZh).toMatch(/D2Q9|权/)

    const re = flat.find((n) => n.id === 'lbm-foundation-re')
    expect(re?.formula?.expr).toMatch(/Re|U \* L/)
    expect(re?.formula?.expected).toBeCloseTo(60, 10)
    expect(re?.formula?.plainZh).toMatch(/雷诺|方腔|顶盖/)

    const tau = flat.find((n) => n.id === 'lbm-foundation-tau-from-re')
    expect(tau?.formula?.expected).toBeCloseTo(1, 10)
    expect(tau?.formula?.plainZh).toMatch(/松弛|粘度/)

    const cNu = flat.find((n) => n.id === 'lbm-compose-nu-tau')
    expect(cNu?.formula?.expected).toBeCloseTo(1 / 6, 10)
    expect(cNu?.formula?.plainZh).toMatch(/粘度|松弛|声速/)

    const cReTau = flat.find((n) => n.id === 'lbm-compose-re-tau')
    expect(cReTau?.formula?.expr).toMatch(/Re|cs2|tau/)
    expect(cReTau?.formula?.expected).toBeCloseTo(1, 10)
    expect(cReTau?.formula?.plainZh).toMatch(/雷诺|松弛/)

    const cMass = flat.find((n) => n.id === 'lbm-compose-mass')
    expect(cMass?.formula?.expected).toBeCloseTo(0, 10)
    expect(cMass?.formula?.plainZh).toMatch(/质量|残差|密度/)

    const cW = flat.find((n) => n.id === 'lbm-compose-weights')
    expect(cW?.formula?.expected).toBeCloseTo(1, 10)
    expect(cW?.formula?.plainZh).toMatch(/权|D2Q9|归一/)

    const cMa = flat.find((n) => n.id === 'lbm-compose-mach')
    expect(cMa?.formula?.expected).toBeCloseTo(0.1 / Math.sqrt(1 / 3), 10)
    expect(cMa?.formula?.plainZh).toMatch(/Mach|声速|速度/)

    const cRe = flat.find((n) => n.id === 'lbm-compose-re-cavity')
    expect(cRe?.formula?.expected).toBeCloseTo(60, 10)
    expect(cRe?.formula?.plainZh).toMatch(/雷诺|方腔|顶盖/)

    const cP = flat.find((n) => n.id === 'lbm-compose-pressure')
    expect(cP?.formula?.expr).toMatch(/cs2|rho/)
    expect(cP?.formula?.expected).toBeCloseTo(1 / 3, 10)
    expect(cP?.formula?.plainZh).toMatch(/压|密度|声速/)

    const cBgk = flat.find((n) => n.id === 'lbm-compose-bgk-update')
    expect(cBgk?.formula?.expr).toMatch(/f_eq|tau|f_star/)
    expect(cBgk?.formula?.expected).toBeCloseTo(0.25, 10)
    expect(cBgk?.formula?.plainZh).toMatch(/BGK|碰撞|平衡|松弛/)

    const cNuRe = flat.find((n) => n.id === 'lbm-compose-nu-from-re')
    expect(cNuRe?.formula?.expr).toMatch(/U \* L|Re/)
    expect(cNuRe?.formula?.expected).toBeCloseTo(0.1 * 100 / 60, 10)
    expect(cNuRe?.formula?.plainZh).toMatch(/粘度|雷诺|顶盖/)

    const cRho = flat.find((n) => n.id === 'lbm-compose-rho-recover')
    expect(cRho?.formula?.expr).toMatch(/f0|f1|f2/)
    expect(cRho?.formula?.expected).toBeCloseTo(1, 10)
    expect(cRho?.formula?.plainZh).toMatch(/密度|分布|求和|合成/)

    const cTauMatch = flat.find((n) => n.id === 'lbm-compose-tau-match')
    expect(cTauMatch?.formula?.expected).toBeCloseTo(0, 10)
    expect(cTauMatch?.formula?.plainZh).toMatch(/松弛|粘度|残差|匹配/)

    const cCs2 = flat.find((n) => n.id === 'lbm-compose-cs2')
    expect(cCs2?.formula?.expected).toBeCloseTo(1 / 3, 10)
    expect(cCs2?.formula?.plainZh).toMatch(/声速|D2Q9|D3Q19|三分之一|1\/3/)

    const cG = flat.find((n) => n.id === 'lbm-compose-G-from-umax')
    expect(cG?.formula?.expr).toMatch(/G|nu|u_max|H/)
    expect(cG?.formula?.expected).toBeCloseTo((8 * (1 / 6) * 0.1) / (50 * 50), 12)
    expect(cG?.formula?.plainZh).toMatch(/力|通道|峰值|粘度|反演|合成/)

    const cUmax = flat.find((n) => n.id === 'lbm-compose-umax-poiseuille')
    expect(cUmax?.formula?.expr).toMatch(/u_max|G|H|nu/)
    expect(cUmax?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(cUmax?.formula?.plainZh).toMatch(/峰值|体力|通道|粘度|合成/)

    const cFRe = flat.find((n) => n.id === 'lbm-compose-f-re')
    expect(cFRe?.formula?.expr).toMatch(/f_Re|f \* Re/)
    expect(cFRe?.formula?.expected).toBeCloseTo(24, 10)
    expect(cFRe?.formula?.plainZh).toMatch(/摩阻|雷诺|24|通道/)

    const cMaNu = flat.find((n) => n.id === 'lbm-compose-mach-nu')
    expect(cMaNu?.formula?.expr).toMatch(/Ma|Re|nu|cs2/)
    expect(cMaNu?.formula?.expected).toBeCloseTo(
      (60 * (1 / 6)) / (100 * Math.sqrt(1 / 3)),
      10,
    )
    expect(cMaNu?.formula?.expected).toBeCloseTo(0.1 / Math.sqrt(1 / 3), 10)
    expect(cMaNu?.formula?.plainZh).toMatch(/Mach|雷诺|粘度|声速|合成/)

    const cGuo = flat.find((n) => n.id === 'lbm-compose-guo-pref')
    expect(cGuo?.formula?.expr).toMatch(/pref|tau/)
    expect(cGuo?.formula?.expected).toBeCloseTo(0.5, 10)
    expect(cGuo?.formula?.plainZh).toMatch(/Guo|预因子|松弛|动量|粘性/)

    const cGRes = flat.find((n) => n.id === 'lbm-compose-G-match-residual')
    expect(cGRes?.formula?.expr).toMatch(/res|G|u_max/)
    expect(cGRes?.formula?.expected).toBeCloseTo(0, 10)
    expect(cGRes?.formula?.plainZh).toMatch(/残差|力|通道|匹配|反演/)

    const cUmean = flat.find((n) => n.id === 'lbm-compose-umean-poiseuille')
    expect(cUmean?.formula?.expr).toMatch(/u_mean|u_max/)
    expect(cUmean?.formula?.expected).toBeCloseTo((2 / 3) * 0.1, 10)
    expect(cUmean?.formula?.plainZh).toMatch(/平均|峰值|三分之二|通道/)

    const cD3w = flat.find((n) => n.id === 'lbm-compose-d3q19-weights')
    expect(cD3w?.formula?.expr).toMatch(/w0|w1|w2/)
    expect(cD3w?.formula?.expected).toBeCloseTo(1, 10)
    expect(cD3w?.formula?.plainZh).toMatch(/D3Q19|权/)

    const cTauNu = flat.find((n) => n.id === 'lbm-compose-tau-from-nu')
    expect(cTauNu?.formula?.expr).toMatch(/tau|nu|cs2/)
    expect(cTauNu?.formula?.expected).toBeCloseTo(1, 10)
    expect(cTauNu?.formula?.plainZh).toMatch(/松弛|粘度|声速/)

    const cDh = flat.find((n) => n.id === 'lbm-compose-Dh')
    expect(cDh?.formula?.expr).toMatch(/Dh|H/)
    expect(cDh?.formula?.expected).toBeCloseTo(100, 10)
    expect(cDh?.formula?.plainZh).toMatch(/水力|直径|高度|两倍|通道/)

    const cReCh = flat.find((n) => n.id === 'lbm-compose-Re-channel')
    expect(cReCh?.formula?.expr).toMatch(/Re|u_mean|Dh|nu/)
    expect(cReCh?.formula?.expected).toBeCloseTo(
      ((2 / 3) * 0.1 * 100) / (1 / 6),
      10,
    )
    expect(cReCh?.formula?.plainZh).toMatch(/雷诺|平均|水力|通道/)

    const cTw = flat.find((n) => n.id === 'lbm-compose-wall-shear')
    expect(cTw?.formula?.expr).toMatch(/tau_w|rho|G|H/)
    expect(cTw?.formula?.expected).toBeCloseTo(
      (1 * ((8 * (1 / 6) * 0.1) / (50 * 50)) * 50) / 2,
      12,
    )
    expect(cTw?.formula?.plainZh).toMatch(/壁|剪|力|通道|密度|平衡/)

    const cDp = flat.find((n) => n.id === 'lbm-compose-dpdx')
    expect(cDp?.formula?.expr).toMatch(/dpdx|rho|G/)
    expect(cDp?.formula?.expected).toBeCloseTo(
      (8 * (1 / 6) * 0.1) / (50 * 50),
      12,
    )
    expect(cDp?.formula?.plainZh).toMatch(/压降|密度|体力|通道/)

    const cGuoU = flat.find((n) => n.id === 'lbm-compose-guo-u')
    expect(cGuoU?.formula?.expr).toMatch(/j|F|rho/)
    expect(cGuoU?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(cGuoU?.formula?.plainZh).toMatch(/Guo|速度|动量|半步|力/)

    const cCs = flat.find((n) => n.id === 'lbm-compose-cs')
    expect(cCs?.formula?.expr).toMatch(/cs|sqrt|cs2/)
    expect(cCs?.formula?.expected).toBeCloseTo(Math.sqrt(1 / 3), 10)
    expect(cCs?.formula?.plainZh).toMatch(/声速|平方根/)

    const cFreRes = flat.find((n) => n.id === 'lbm-compose-f-re-residual')
    expect(cFreRes?.formula?.expr).toMatch(/res|f|Re|24/)
    expect(cFreRes?.formula?.expected).toBeCloseTo(0, 10)
    expect(cFreRes?.formula?.plainZh).toMatch(/残差|摩阻|雷诺|24/)

    const cUmRes = flat.find((n) => n.id === 'lbm-compose-umean-residual')
    expect(cUmRes?.formula?.expr).toMatch(/res|u_mean|u_max/)
    expect(cUmRes?.formula?.expected).toBeCloseTo(0, 10)
    expect(cUmRes?.formula?.plainZh).toMatch(/残差|平均|峰值|三分之二/)

    const cFd = flat.find((n) => n.id === 'lbm-compose-f-darcy')
    expect(cFd?.formula?.expr).toMatch(/f|Re|24/)
    expect(cFd?.formula?.expected).toBeCloseTo(24 / 40, 10)
    expect(cFd?.formula?.plainZh).toMatch(/Darcy|摩阻|24|雷诺/)

    const cFden = flat.find((n) => n.id === 'lbm-compose-force-density')
    expect(cFden?.formula?.expr).toMatch(/F|rho|G/)
    expect(cFden?.formula?.expected).toBeCloseTo(
      (8 * (1 / 6) * 0.1) / (50 * 50),
      12,
    )
    expect(cFden?.formula?.plainZh).toMatch(/体力|密度/)

    const cQ19 = flat.find((n) => n.id === 'lbm-compose-Q19')
    expect(cQ19?.formula?.expr).toMatch(/Q|1 \+ 6 \+ 12/)
    expect(cQ19?.formula?.expected).toBeCloseTo(19, 10)
    expect(cQ19?.formula?.plainZh).toMatch(/D3Q19|19|离散/)

    const cTauHalf = flat.find((n) => n.id === 'lbm-compose-tau-half-residual')
    expect(cTauHalf?.formula?.expr).toMatch(/res|tau|0\.5|max/)
    expect(cTauHalf?.formula?.expected).toBeCloseTo(0, 10)
    expect(cTauHalf?.formula?.plainZh).toMatch(/松弛|二分之一|残差|粘/)

    const cGDp = flat.find((n) => n.id === 'lbm-compose-G-from-dpdx')
    expect(cGDp?.formula?.expr).toMatch(/G|dpdx|rho/)
    expect(cGDp?.formula?.expected).toBeCloseTo(
      (8 * (1 / 6) * 0.1) / (50 * 50),
      12,
    )
    expect(cGDp?.formula?.plainZh).toMatch(/体力|压降|密度/)

    const cEq0 = flat.find((n) => n.id === 'lbm-compose-eq-rest')
    expect(cEq0?.formula?.expr).toMatch(/f_eq0|w0|rho/)
    expect(cEq0?.formula?.expected).toBeCloseTo(4 / 9, 10)
    expect(cEq0?.formula?.plainZh).toMatch(/静止|平衡|权|密度/)

    const cFi = flat.find((n) => n.id === 'lbm-compose-guo-Fi-cardinal')
    expect(cFi?.formula?.expr).toMatch(/Fi|pref|w|F|cs2/)
    expect(cFi?.formula?.expected).toBeCloseTo(
      (0.5 * (1 / 9) * 0.02) / (1 / 3),
      12,
    )
    expect(cFi?.formula?.plainZh).toMatch(/Guo|轴向|离散|预因子|权/)

    // S19bb AM/GM/HM honesty duals (wave25 residual compose expand)
    const cPbb = flat.find((n) => n.id === 'lbm-compose-f-re-product-bulk')
    expect(cPbb?.formula?.expr).toMatch(/p_bb|f_bulk|Re_bulk/)
    expect(cPbb?.formula?.expected).toBeCloseTo(12, 10)
    expect(cPbb?.formula?.plainZh).toMatch(/bulk|摩阻|雷诺|积/)

    const cPpp = flat.find((n) => n.id === 'lbm-compose-f-re-product-peak')
    expect(cPpp?.formula?.expr).toMatch(/p_pp|f_peak|Re_peak/)
    expect(cPpp?.formula?.expected).toBeCloseTo(12, 10)
    expect(cPpp?.formula?.plainZh).toMatch(/peak|摩阻|雷诺|积/)

    const cPbp = flat.find((n) => n.id === 'lbm-compose-f-re-product-cross-bp')
    expect(cPbp?.formula?.expected).toBeCloseTo(18, 10)
    expect(cPbp?.formula?.plainZh).toMatch(/交叉|bulk|peak|积/)

    const cPpb = flat.find((n) => n.id === 'lbm-compose-f-re-product-cross-pb')
    expect(cPpb?.formula?.expected).toBeCloseTo(8, 10)
    expect(cPpb?.formula?.plainZh).toMatch(/交叉|peak|bulk|积/)

    const cAM = flat.find((n) => n.id === 'lbm-compose-AM')
    expect(cAM?.formula?.expr).toMatch(/AM|a \+ b/)
    expect(cAM?.formula?.expected).toBeCloseTo(13, 10)
    expect(cAM?.formula?.plainZh).toMatch(/算术|均值|一半|积/)

    const cGM = flat.find((n) => n.id === 'lbm-compose-GM')
    expect(cGM?.formula?.expr).toMatch(/GM|sqrt/)
    expect(cGM?.formula?.expected).toBeCloseTo(12, 10)
    expect(cGM?.formula?.plainZh).toMatch(/几何|均值|平方根|积/)

    const cHM = flat.find((n) => n.id === 'lbm-compose-HM')
    expect(cHM?.formula?.expr).toMatch(/HM|a \* b|a \+ b/)
    expect(cHM?.formula?.expected).toBeCloseTo((2 * 18 * 8) / (18 + 8), 12)
    expect(cHM?.formula?.plainZh).toMatch(/调和|均值|两倍|积/)

    const cLadder = flat.find((n) => n.id === 'lbm-compose-AM-GM-HM-ladder')
    expect(cLadder?.formula?.expr).toMatch(/AM|HM|span/)
    expect(cLadder?.formula?.expected).toBeCloseTo(
      13 - (2 * 18 * 8) / (18 + 8),
      12,
    )
    expect(cLadder?.formula?.plainZh).toMatch(/算术|调和|梯|诚实/)

    const cCrossG = flat.find(
      (n) => n.id === 'lbm-compose-cross-geometric-residual',
    )
    expect(cCrossG?.formula?.expr).toMatch(/res|GM|12/)
    expect(cCrossG?.formula?.expected).toBeCloseTo(0, 10)
    expect(cCrossG?.formula?.plainZh).toMatch(/交叉|几何|残差|12/)

    const cCrossH = flat.find(
      (n) => n.id === 'lbm-compose-cross-harmonic-residual',
    )
    expect(cCrossH?.formula?.expr).toMatch(/res|HM|12/)
    expect(cCrossH?.formula?.expected).toBeCloseTo(
      Math.abs((2 * 18 * 8) / (18 + 8) - 12) / 12,
      12,
    )
    expect(cCrossH?.formula?.plainZh).toMatch(/交叉|调和|残差|12/)

    const cMatchH = flat.find(
      (n) => n.id === 'lbm-compose-matched-harmonic-residual',
    )
    expect(cMatchH?.formula?.expr).toMatch(/res|HM_m|12/)
    expect(cMatchH?.formula?.expected).toBeCloseTo(0, 10)
    expect(cMatchH?.formula?.plainZh).toMatch(/匹配|调和|残差/)

    const cCrossA = flat.find(
      (n) => n.id === 'lbm-compose-cross-arithmetic-residual',
    )
    expect(cCrossA?.formula?.expr).toMatch(/res|AM|12/)
    expect(cCrossA?.formula?.expected).toBeCloseTo(1 / 12, 12)
    expect(cCrossA?.formula?.plainZh).toMatch(/交叉|算术|残差|12/)

    const cGmId = flat.find((n) => n.id === 'lbm-compose-GM-identity-residual')
    expect(cGmId?.formula?.expr).toMatch(/GM_cross|GM_matched/)
    expect(cGmId?.formula?.expected).toBeCloseTo(0, 10)
    expect(cGmId?.formula?.plainZh).toMatch(/几何|恒等|交叉|匹配/)

    const cAMm = flat.find((n) => n.id === 'lbm-compose-matched-AM')
    expect(cAMm?.formula?.expr).toMatch(/AM_m|p_bb|p_pp/)
    expect(cAMm?.formula?.expected).toBeCloseTo(12, 10)
    expect(cAMm?.formula?.plainZh).toMatch(/匹配|算术|bulk|peak/)

    const cAmGm = flat.find((n) => n.id === 'lbm-compose-AM-GM-gap')
    expect(cAmGm?.formula?.expr).toMatch(/AM|GM|gap/)
    expect(cAmGm?.formula?.expected).toBeCloseTo(1, 10)
    expect(cAmGm?.formula?.plainZh).toMatch(/算术|几何|间隙|诚实/)

    const cGmHm = flat.find((n) => n.id === 'lbm-compose-GM-HM-gap')
    expect(cGmHm?.formula?.expr).toMatch(/GM|HM|gap/)
    expect(cGmHm?.formula?.expected).toBeCloseTo(
      12 - (2 * 18 * 8) / (18 + 8),
      12,
    )
    expect(cGmHm?.formula?.plainZh).toMatch(/几何|调和|间隙|诚实/)

    // S19bd/S19be force-channel means dual residual packaging (wave28 residual compose expand)
    const cMgm = flat.find((n) => n.id === 'lbm-compose-matched-GM')
    expect(cMgm?.formula?.expr).toMatch(/GM_m|p_bb|p_pp|sqrt/)
    expect(cMgm?.formula?.expected).toBeCloseTo(12, 10)
    expect(cMgm?.formula?.plainZh).toMatch(/匹配|几何|bulk|peak/)

    const cMhm = flat.find((n) => n.id === 'lbm-compose-matched-HM')
    expect(cMhm?.formula?.expr).toMatch(/HM_m|p_bb|p_pp/)
    expect(cMhm?.formula?.expected).toBeCloseTo(12, 10)
    expect(cMhm?.formula?.plainZh).toMatch(/匹配|调和|bulk|peak/)

    const cMamR = flat.find(
      (n) => n.id === 'lbm-compose-matched-means-AM-residual',
    )
    expect(cMamR?.formula?.expr).toMatch(/AM_m|12/)
    expect(cMamR?.formula?.expected).toBeCloseTo(0, 10)
    expect(cMamR?.formula?.plainZh).toMatch(/匹配|算术|残差|12/)

    const cDualAm = flat.find((n) => n.id === 'lbm-compose-means-dual-AM')
    expect(cDualAm?.formula?.expr).toMatch(/d_AM|AM_m|AM_c/)
    expect(cDualAm?.formula?.expected).toBeCloseTo(1 / 12, 12)
    expect(cDualAm?.formula?.plainZh).toMatch(/匹配|交叉|算术|dual|残差/)

    const cDualGm = flat.find((n) => n.id === 'lbm-compose-means-dual-GM')
    expect(cDualGm?.formula?.expr).toMatch(/d_GM|GM_m|GM_c/)
    expect(cDualGm?.formula?.expected).toBeCloseTo(0, 10)
    expect(cDualGm?.formula?.plainZh).toMatch(/几何|dual|矩形|零/)

    const cDualHm = flat.find((n) => n.id === 'lbm-compose-means-dual-HM')
    expect(cDualHm?.formula?.expr).toMatch(/d_HM|HM_m|HM_c/)
    expect(cDualHm?.formula?.expected).toBeCloseTo(
      Math.abs(12 - (2 * 18 * 8) / (18 + 8)) / 12,
      12,
    )
    expect(cDualHm?.formula?.plainZh).toMatch(/匹配|交叉|调和|dual/)

    const cDualMax = flat.find((n) => n.id === 'lbm-compose-means-dual-max')
    expect(cDualMax?.formula?.expr).toMatch(/d_max|max|abs_AM/)
    expect(cDualMax?.formula?.expected).toBeCloseTo(
      Math.max(1, 0, Math.abs(12 - (2 * 18 * 8) / (18 + 8))) / 12,
      12,
    )
    expect(cDualMax?.formula?.plainZh).toMatch(/means dual|最大|上确界|12/)

    const cDualMat = flat.find(
      (n) => n.id === 'lbm-compose-means-dual-matrix-offdiag',
    )
    expect(cDualMat?.formula?.expr).toMatch(/d_i|d_j|12/)
    expect(cDualMat?.formula?.expected).toBeCloseTo(1 / 12, 12)
    expect(cDualMat?.formula?.plainZh).toMatch(/means dual|矩阵|非对角|残差/)

    const cDualGate = flat.find(
      (n) => n.id === 'lbm-compose-means-dual-honesty-gate',
    )
    expect(cDualGate?.formula?.expr).toMatch(/gate|c_match|c_GM/)
    expect(cDualGate?.formula?.expected).toBeCloseTo(1, 10)
    expect(cDualGate?.formula?.plainZh).toMatch(/means dual|包装|诚实|门/)

    // S19bf means dual envelope min/RMS/max + residual matrix (wave29 residual compose expand)
    const cDmin = flat.find((n) => n.id === 'lbm-compose-means-dual-min')
    expect(cDmin?.formula?.expr).toMatch(/d_min|min|abs_AM/)
    expect(cDmin?.formula?.expected).toBeCloseTo(
      Math.min(1, 0, Math.abs(12 - (2 * 18 * 8) / (18 + 8))) / 12,
      12,
    )
    expect(cDmin?.formula?.plainZh).toMatch(/means dual|最小|下确界|12/)

    const cDrms = flat.find((n) => n.id === 'lbm-compose-means-dual-rms')
    expect(cDrms?.formula?.expr).toMatch(/d_rms|sqrt|abs_AM/)
    expect(cDrms?.formula?.expected).toBeCloseTo(
      Math.sqrt(
        (1 * 1 +
          0 * 0 +
          Math.pow(Math.abs(12 - (2 * 18 * 8) / (18 + 8)), 2)) /
          3,
      ) / 12,
      12,
    )
    expect(cDrms?.formula?.plainZh).toMatch(/means dual|RMS|均方根|12/)

    const cEsp = flat.find(
      (n) => n.id === 'lbm-compose-means-dual-envelope-span',
    )
    expect(cEsp?.formula?.expr).toMatch(/span|abs_max|abs_min/)
    expect(cEsp?.formula?.expected).toBeCloseTo(1 / 12, 12)
    expect(cEsp?.formula?.plainZh).toMatch(/包络|跨度|12/)

    const cEcrest = flat.find(
      (n) => n.id === 'lbm-compose-means-dual-envelope-crest',
    )
    expect(cEcrest?.formula?.expr).toMatch(/crest|abs_max|rms_abs/)
    expect(cEcrest?.formula?.expected).toEqual(expect.any(Number))
    expect(Number.isFinite(cEcrest!.formula!.expected as number)).toBe(true)
    expect(cEcrest?.formula?.plainZh).toMatch(/峰均|上确界|RMS/)

    const cEdiag = flat.find(
      (n) => n.id === 'lbm-compose-envelope-matrix-diag',
    )
    expect(cEdiag?.formula?.expr).toMatch(/e_i|e_i_ref|12/)
    expect(cEdiag?.formula?.expected).toBeCloseTo(0, 10)
    expect(cEdiag?.formula?.plainZh).toMatch(/envelope|矩阵|对角|残差/)

    const cEoff = flat.find(
      (n) => n.id === 'lbm-compose-envelope-matrix-offdiag',
    )
    expect(cEoff?.formula?.expr).toMatch(/e_i|e_j|12/)
    expect(cEoff?.formula?.expected).toBeCloseTo(1 / 12, 12)
    expect(cEoff?.formula?.plainZh).toMatch(/envelope|矩阵|非对角|残差/)

    const cEfill = flat.find(
      (n) => n.id === 'lbm-compose-envelope-rms-max-ratio',
    )
    expect(cEfill?.formula?.expr).toMatch(/ratio|rms_abs|abs_max/)
    expect(cEfill?.formula?.expected).toEqual(expect.any(Number))
    expect(Number.isFinite(cEfill!.formula!.expected as number)).toBe(true)
    expect(cEfill?.formula?.plainZh).toMatch(/填充|RMS|上确界/)

    const cEgate = flat.find(
      (n) => n.id === 'lbm-compose-dual-envelope-honesty-gate',
    )
    expect(cEgate?.formula?.expr).toMatch(/gate|c_min|c_rms/)
    expect(cEgate?.formula?.expected).toBeCloseTo(1, 10)
    expect(cEgate?.formula?.plainZh).toMatch(/dual envelope|包装|诚实|门/)

    // S19bg means dual L1 + envelope range + L1–envelope residual matrix (wave30 residual compose expand)
    const cDl1 = flat.find((n) => n.id === 'lbm-compose-means-dual-L1')
    expect(cDl1?.formula?.expr).toMatch(/d_L1|abs_AM/)
    expect(cDl1?.formula?.expected).toBeCloseTo(
      (1 + 0 + Math.abs(12 - (2 * 18 * 8) / (18 + 8))) / 3 / 12,
      12,
    )
    expect(cDl1?.formula?.plainZh).toMatch(/means dual|L1|算术|12/)

    const cDrange = flat.find(
      (n) => n.id === 'lbm-compose-means-dual-envelope-range',
    )
    expect(cDrange?.formula?.expr).toMatch(/range|abs_max|abs_min/)
    expect(cDrange?.formula?.expected).toBeCloseTo(1 / 12, 12)
    expect(cDrange?.formula?.plainZh).toMatch(/包络|跨度|L∞|12/)

    const cL1off = flat.find(
      (n) => n.id === 'lbm-compose-L1-envelope-matrix-offdiag',
    )
    expect(cL1off?.formula?.expr).toMatch(/v_i|v_j|12/)
    expect(cL1off?.formula?.expected).toBeCloseTo(0.5 / 12, 12)
    expect(cL1off?.formula?.plainZh).toMatch(/L1|envelope|矩阵|非对角/)

    const cLadderH = flat.find(
      (n) => n.id === 'lbm-compose-envelope-ladder-honesty',
    )
    expect(cLadderH?.formula?.expr).toMatch(/min_v|L1|RMS|max_v/)
    expect(cLadderH?.formula?.expected).toBeCloseTo(0, 10)
    expect(cLadderH?.formula?.plainZh).toMatch(/诚实梯|min|L1|RMS|max/)

    const cL1fill = flat.find((n) => n.id === 'lbm-compose-L1-fill-ratio')
    expect(cL1fill?.formula?.expr).toMatch(/ratio|L1_abs|abs_max/)
    expect(cL1fill?.formula?.expected).toBeCloseTo(0.5, 10)
    expect(cL1fill?.formula?.plainZh).toMatch(/L1|填充|上确界/)

    const cL1g = flat.find(
      (n) => n.id === 'lbm-compose-means-dual-L1-honesty-gate',
    )
    expect(cL1g?.formula?.expr).toMatch(/gate|c_L1|c_range/)
    expect(cL1g?.formula?.expected).toBeCloseTo(1, 10)
    expect(cL1g?.formula?.plainZh).toMatch(/means dual L1|包装|诚实|门/)

    // S19bh means dual L1↔RMS/max dual + min–L1 envelope residual matrix (wave31 residual compose expand)
    const cL1Rms = flat.find((n) => n.id === 'lbm-compose-L1-RMS-dual')
    expect(cL1Rms?.formula?.expr).toMatch(/dual_L1_RMS|L1_abs|RMS_abs/)
    expect(cL1Rms?.formula?.expected).toBeCloseTo(0.1 / 12, 12)
    expect(cL1Rms?.formula?.plainZh).toMatch(/means dual|L1|RMS|12/)

    const cL1Max = flat.find((n) => n.id === 'lbm-compose-L1-max-dual')
    expect(cL1Max?.formula?.expr).toMatch(/dual_L1_max|L1_abs|abs_max/)
    expect(cL1Max?.formula?.expected).toBeCloseTo(0.5 / 12, 12)
    expect(cL1Max?.formula?.plainZh).toMatch(/means dual|L1|上确界|12/)

    const cMinL1 = flat.find(
      (n) => n.id === 'lbm-compose-min-L1-envelope-matrix-offdiag',
    )
    expect(cMinL1?.formula?.expr).toMatch(/v_i|v_j|12/)
    expect(cMinL1?.formula?.expected).toBeCloseTo(0.5 / 12, 12)
    expect(cMinL1?.formula?.plainZh).toMatch(/min|L1|envelope|矩阵/)

    const cEnvCv = flat.find((n) => n.id === 'lbm-compose-dual-envelope-CV')
    expect(cEnvCv?.formula?.expr).toMatch(/CV|RMS_abs|L1_abs/)
    expect(cEnvCv?.formula?.expected).toBeCloseTo(1, 10)
    expect(cEnvCv?.formula?.plainZh).toMatch(/变异|envelope|L1|RMS/)

    const cMinLad = flat.find(
      (n) => n.id === 'lbm-compose-min-L1-RMS-ladder-honesty',
    )
    expect(cMinLad?.formula?.expr).toMatch(/min_v|L1|RMS/)
    expect(cMinLad?.formula?.expected).toBeCloseTo(0, 10)
    expect(cMinLad?.formula?.plainZh).toMatch(/下诚实梯|min|L1|RMS/)

    const cL1edg = flat.find(
      (n) => n.id === 'lbm-compose-L1-envelope-dual-honesty-gate',
    )
    expect(cL1edg?.formula?.expr).toMatch(/gate|c_L1R|c_L1M/)
    expect(cL1edg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cL1edg?.formula?.plainZh).toMatch(/L1 envelope dual|包装|诚实|门/)

    // S19bi means dual FullEnvelope / MinL1 dual residual matrix (wave32 residual compose expand)
    const cMinL1d = flat.find((n) => n.id === 'lbm-compose-min-L1-dual')
    expect(cMinL1d?.formula?.expr).toMatch(/dual_min_L1|min_v|L1_abs/)
    expect(cMinL1d?.formula?.expected).toBeCloseTo(0.5 / 12, 12)
    expect(cMinL1d?.formula?.plainZh).toMatch(/means dual|min|L1|12/)

    const cMinRms = flat.find((n) => n.id === 'lbm-compose-min-RMS-dual')
    expect(cMinRms?.formula?.expr).toMatch(/dual_min_RMS|min_v|RMS_abs/)
    expect(cMinRms?.formula?.expected).toBeCloseTo(0.6 / 12, 12)
    expect(cMinRms?.formula?.plainZh).toMatch(/means dual|min|RMS|12/)

    const cFullOff = flat.find(
      (n) => n.id === 'lbm-compose-full-envelope-matrix-offdiag',
    )
    expect(cFullOff?.formula?.expr).toMatch(/v_i|v_j|12/)
    expect(cFullOff?.formula?.expected).toBeCloseTo(1 / 12, 12)
    expect(cFullOff?.formula?.plainZh).toMatch(/FullEnvelope|矩阵|非对角/)

    const cFullLad = flat.find(
      (n) => n.id === 'lbm-compose-full-envelope-ladder-honesty',
    )
    expect(cFullLad?.formula?.expr).toMatch(/min_v|L1|RMS|max_v/)
    expect(cFullLad?.formula?.expected).toBeCloseTo(0, 10)
    expect(cFullLad?.formula?.plainZh).toMatch(/全诚实梯|min|L1|RMS|max/)

    const cFullg = flat.find(
      (n) => n.id === 'lbm-compose-full-envelope-honesty-gate',
    )
    expect(cFullg?.formula?.expr).toMatch(/gate|c_minL1|c_minR/)
    expect(cFullg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cFullg?.formula?.plainZh).toMatch(/FullEnvelope|包装|诚实|门/)

    // S19bj means dual FullEnvelope / adjacent dual residual matrix (wave33 residual compose expand)
    const cL1RmsAdj = flat.find(
      (n) => n.id === 'lbm-compose-L1-RMS-adjacent-dual',
    )
    expect(cL1RmsAdj?.formula?.expr).toMatch(/dual_L1_RMS|L1_abs|RMS_abs/)
    expect(cL1RmsAdj?.formula?.expected).toBeCloseTo(0.1 / 12, 12)
    expect(cL1RmsAdj?.formula?.plainZh).toMatch(/means dual|L1|RMS|12/)

    const cRmsMaxAdj = flat.find(
      (n) => n.id === 'lbm-compose-RMS-max-adjacent-dual',
    )
    expect(cRmsMaxAdj?.formula?.expr).toMatch(/dual_RMS_max|RMS_abs|max_v/)
    expect(cRmsMaxAdj?.formula?.expected).toBeCloseTo(0.4 / 12, 12)
    expect(cRmsMaxAdj?.formula?.plainZh).toMatch(/means dual|RMS|max|12/)

    const cAdjBand = flat.find(
      (n) => n.id === 'lbm-compose-adjacent-envelope-matrix-band',
    )
    expect(cAdjBand?.formula?.expr).toMatch(/band|min_v|L1|RMS|max_v/)
    expect(cAdjBand?.formula?.expected).toBeCloseTo(1 / 12, 12)
    expect(cAdjBand?.formula?.plainZh).toMatch(/adjacent|FullEnvelope|对角带/)

    const cAdjLad = flat.find(
      (n) => n.id === 'lbm-compose-adjacent-ladder-honesty',
    )
    expect(cAdjLad?.formula?.expr).toMatch(/min_v|L1|RMS|max_v/)
    expect(cAdjLad?.formula?.expected).toBeCloseTo(0, 10)
    expect(cAdjLad?.formula?.plainZh).toMatch(/adjacent|诚实梯|min|L1|RMS|max/)

    const cAdjg = flat.find(
      (n) => n.id === 'lbm-compose-adjacent-envelope-honesty-gate',
    )
    expect(cAdjg?.formula?.expr).toMatch(/gate|c_L1R|c_Rmax/)
    expect(cAdjg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cAdjg?.formula?.plainZh).toMatch(/AdjacentEnvelope|包装|诚实|门/)

    // S19bk means dual adjacent dual residual matrix + cross-norm residual ladder + triple-envelope telescoping (wave34 residual compose expand)
    const cMinL1Adj = flat.find(
      (n) => n.id === 'lbm-compose-min-L1-adjacent-dual',
    )
    expect(cMinL1Adj?.formula?.expr).toMatch(/dual_min_L1|min_v|L1/)
    expect(cMinL1Adj?.formula?.expected).toBeCloseTo(0.5 / 12, 12)
    expect(cMinL1Adj?.formula?.plainZh).toMatch(/means dual|min|L1|12/)

    const cL1MaxX = flat.find((n) => n.id === 'lbm-compose-L1-max-cross-norm')
    expect(cL1MaxX?.formula?.expr).toMatch(/cross_L1_max|L1|max/)
    expect(cL1MaxX?.formula?.expected).toBeCloseTo(0.5 / 12, 12)
    expect(cL1MaxX?.formula?.plainZh).toMatch(/cross-norm|L1|max|12/)

    const cMinRmsX = flat.find((n) => n.id === 'lbm-compose-min-RMS-cross-norm')
    expect(cMinRmsX?.formula?.expr).toMatch(/cross_min_RMS|min_v|RMS/)
    expect(cMinRmsX?.formula?.expected).toBeCloseTo(0.6 / 12, 12)
    expect(cMinRmsX?.formula?.plainZh).toMatch(/cross-norm|min|RMS|12/)

    const cXlad = flat.find(
      (n) => n.id === 'lbm-compose-cross-norm-ladder-honesty',
    )
    expect(cXlad?.formula?.expr).toMatch(/min_v|L1|RMS|max_v/)
    expect(cXlad?.formula?.expected).toBeCloseTo(0, 10)
    expect(cXlad?.formula?.plainZh).toMatch(/cross-norm|ladder|望远镜|诚实/)

    const cTel = flat.find(
      (n) => n.id === 'lbm-compose-triple-envelope-telescoping',
    )
    expect(cTel?.formula?.expr).toMatch(/tel|min_v|mid|max_v/)
    expect(cTel?.formula?.expected).toBeCloseTo(0, 10)
    expect(cTel?.formula?.plainZh).toMatch(/triple-envelope|望远镜/)

    const cTelg = flat.find(
      (n) => n.id === 'lbm-compose-triple-envelope-honesty-gate',
    )
    expect(cTelg?.formula?.expr).toMatch(/gate|c_minL1|c_tel/)
    expect(cTelg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cTelg?.formula?.plainZh).toMatch(/TripleEnvelope|包装|诚实|门/)

    // S19bl dualAdj triad + triangle-envelope honesty (wave35 residual compose expand)
    const cDab = flat.find((n) => n.id === 'lbm-compose-dualAdj-minL1-L1Rms')
    expect(cDab?.formula?.expr).toMatch(/dualAdj|adjMinL1|adjL1Rms/)
    expect(cDab?.formula?.expected).toBeCloseTo(0.4 / 12, 12)
    expect(cDab?.formula?.plainZh).toMatch(/dualAdj|minL1|L1Rms|12/)

    const cDbc = flat.find((n) => n.id === 'lbm-compose-dualAdj-L1Rms-RmsMax')
    expect(cDbc?.formula?.expr).toMatch(/dualAdj|adjL1Rms|adjRmsMax/)
    expect(cDbc?.formula?.expected).toBeCloseTo(0.3 / 12, 12)
    expect(cDbc?.formula?.plainZh).toMatch(/dualAdj|L1Rms|RmsMax|12/)

    const cDac = flat.find((n) => n.id === 'lbm-compose-dualAdj-minL1-RmsMax')
    expect(cDac?.formula?.expr).toMatch(/dualAdj|adjMinL1|adjRmsMax/)
    expect(cDac?.formula?.expected).toBeCloseTo(0.1 / 12, 12)
    expect(cDac?.formula?.plainZh).toMatch(/dualAdj|minL1|RmsMax|12/)

    const cSlack = flat.find((n) => n.id === 'lbm-compose-dualAdj-triangle-slack')
    expect(cSlack?.formula?.expr).toMatch(/slack|dualAdj/)
    expect(cSlack?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSlack?.formula?.plainZh).toMatch(/dualAdj|三角|slack/)

    const cSkip = flat.find(
      (n) => n.id === 'lbm-compose-cross-norm-dual-skip-extract',
    )
    expect(cSkip?.formula?.expr).toMatch(/skipMinRms|skipL1Max/)
    expect(cSkip?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSkip?.formula?.plainZh).toMatch(/cross-norm|skip|望远镜/)

    const cDtg = flat.find(
      (n) => n.id === 'lbm-compose-dualAdj-triangle-honesty-gate',
    )
    expect(cDtg?.formula?.expr).toMatch(/gate|c_ab|c_slack/)
    expect(cDtg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cDtg?.formula?.plainZh).toMatch(/DualAdjTriangle|包装|诚实|门/)

    // S19bm dual residual matrix dual-extracts + cross-norm dual residual matrix (wave36 residual compose expand; bridges wave35)
    const cDe01 = flat.find((n) => n.id === 'lbm-compose-dualAdj-dual-extract-01')
    expect(cDe01?.formula?.expr).toMatch(/dualAdj_de_01|dualAdj_ab|dualAdj_bc/)
    expect(cDe01?.formula?.expected).toBeCloseTo(0.1 / 12, 12)
    expect(cDe01?.formula?.plainZh).toMatch(/dualAdj|dual-extract|12/)

    const cDe12 = flat.find((n) => n.id === 'lbm-compose-dualAdj-dual-extract-12')
    expect(cDe12?.formula?.expr).toMatch(/dualAdj_de_12|dualAdj_bc|dualAdj_ac/)
    expect(cDe12?.formula?.expected).toBeCloseTo(0.2 / 12, 12)
    expect(cDe12?.formula?.plainZh).toMatch(/dualAdj|dual-extract|12/)

    const cCn01 = flat.find(
      (n) => n.id === 'lbm-compose-cross-norm-dual-matrix-minRms-L1Max',
    )
    expect(cCn01?.formula?.expr).toMatch(/skipMinRms|skipL1Max/)
    expect(cCn01?.formula?.expected).toBeCloseTo(0, 10)
    expect(cCn01?.formula?.plainZh).toMatch(/cross-norm dual residual matrix|minRms/)

    const cCn12 = flat.find(
      (n) => n.id === 'lbm-compose-cross-norm-dual-matrix-L1Max-minMax',
    )
    expect(cCn12?.formula?.expr).toMatch(/skipL1Max|skipMinMax/)
    expect(cCn12?.formula?.expected).toBeCloseTo(0, 10)
    expect(cCn12?.formula?.plainZh).toMatch(/cross-norm dual residual matrix|L1Max/)

    const cDmg = flat.find(
      (n) => n.id === 'lbm-compose-dualAdj-dual-matrix-honesty-gate',
    )
    expect(cDmg?.formula?.expr).toMatch(/gate|c_de01|c_de12/)
    expect(cDmg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cDmg?.formula?.plainZh).toMatch(/DualAdjDualMatrix|包装|诚实|门/)


    const composeWithFormula = flat.filter(
      (n) => n.id.startsWith('lbm-compose-') && n.formula,
    )
    expect(composeWithFormula.length).toBeGreaterThanOrEqual(106)
    for (const n of composeWithFormula) {
      expect(n.formula?.plainZh && n.formula.plainZh.length).toBeGreaterThan(4)
      expect(n.formula?.plainEn && n.formula.plainEn.length).toBeGreaterThan(4)
      expect(n.formula?.expected).toEqual(expect.any(Number))
      expect(Number.isFinite(n.formula!.expected as number)).toBe(true)
    }
  })

  it('lbm enrichWithFormulaViews attaches plainZh on compose formulas', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-lbm-d3q19'],
      layers: 'all',
    })
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const nu = enriched.find(
      (n) => n.id === 'lbm-compose-nu-tau' && n.formulaView,
    )
    expect(nu?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(nu?.formulaView?.expr).toMatch(/cs2|tau/)
    const mass = enriched.find(
      (n) => n.id === 'lbm-compose-mass' && n.formulaView,
    )
    expect(mass?.formulaView?.plainZh).toMatch(/质量|残差|密度/)
    const ma = enriched.find(
      (n) => n.id === 'lbm-compose-mach' && n.formulaView,
    )
    expect(ma?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const reTau = enriched.find(
      (n) => n.id === 'lbm-compose-re-tau' && n.formulaView,
    )
    expect(reTau?.formulaView?.plainZh).toMatch(/雷诺|松弛/)
    const pressure = enriched.find(
      (n) => n.id === 'lbm-compose-pressure' && n.formulaView,
    )
    expect(pressure?.formulaView?.plainZh).toMatch(/压|密度|声速/)
    const bgk = enriched.find(
      (n) => n.id === 'lbm-compose-bgk-update' && n.formulaView,
    )
    expect(bgk?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const tauMatch = enriched.find(
      (n) => n.id === 'lbm-compose-tau-match' && n.formulaView,
    )
    expect(tauMatch?.formulaView?.plainZh).toMatch(/松弛|粘度|残差|匹配/)
    const gRec = enriched.find(
      (n) => n.id === 'lbm-compose-G-from-umax' && n.formulaView,
    )
    expect(gRec?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(gRec?.formulaView?.expr).toMatch(/G|nu|u_max/)
    const fRe = enriched.find(
      (n) => n.id === 'lbm-compose-f-re' && n.formulaView,
    )
    expect(fRe?.formulaView?.plainZh).toMatch(/摩阻|雷诺|24|通道/)
    const maNu = enriched.find(
      (n) => n.id === 'lbm-compose-mach-nu' && n.formulaView,
    )
    expect(maNu?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const guo = enriched.find(
      (n) => n.id === 'lbm-compose-guo-pref' && n.formulaView,
    )
    expect(guo?.formulaView?.plainZh).toMatch(/Guo|预因子|松弛/)
    const gRes = enriched.find(
      (n) => n.id === 'lbm-compose-G-match-residual' && n.formulaView,
    )
    expect(gRes?.formulaView?.plainZh).toMatch(/残差|力|通道|匹配/)
    const d3w = enriched.find(
      (n) => n.id === 'lbm-compose-d3q19-weights' && n.formulaView,
    )
    expect(d3w?.formulaView?.plainZh).toMatch(/D3Q19|权/)
    const reCh = enriched.find(
      (n) => n.id === 'lbm-compose-Re-channel' && n.formulaView,
    )
    expect(reCh?.formulaView?.plainZh).toMatch(/雷诺|通道|平均|水力/)
    const guoU = enriched.find(
      (n) => n.id === 'lbm-compose-guo-u' && n.formulaView,
    )
    expect(guoU?.formulaView?.plainZh).toMatch(/Guo|速度|半步|动量/)
    const freRes = enriched.find(
      (n) => n.id === 'lbm-compose-f-re-residual' && n.formulaView,
    )
    expect(freRes?.formulaView?.plainZh).toMatch(/残差|摩阻|24/)
    const wall = enriched.find(
      (n) => n.id === 'lbm-compose-wall-shear' && n.formulaView,
    )
    expect(wall?.formulaView?.plainZh).toMatch(/壁|剪|力|通道/)
    const fi = enriched.find(
      (n) => n.id === 'lbm-compose-guo-Fi-cardinal' && n.formulaView,
    )
    expect(fi?.formulaView?.plainZh).toMatch(/Guo|轴向|离散|预因子/)
    const am = enriched.find((n) => n.id === 'lbm-compose-AM' && n.formulaView)
    expect(am?.formulaView?.plainZh).toMatch(/算术|均值/)
    const gm = enriched.find((n) => n.id === 'lbm-compose-GM' && n.formulaView)
    expect(gm?.formulaView?.plainZh).toMatch(/几何|均值/)
    const hm = enriched.find((n) => n.id === 'lbm-compose-HM' && n.formulaView)
    expect(hm?.formulaView?.plainZh).toMatch(/调和|均值/)
    const crossH = enriched.find(
      (n) => n.id === 'lbm-compose-cross-harmonic-residual' && n.formulaView,
    )
    expect(crossH?.formulaView?.plainZh).toMatch(/交叉|调和|残差/)
    const matchH = enriched.find(
      (n) => n.id === 'lbm-compose-matched-harmonic-residual' && n.formulaView,
    )
    expect(matchH?.formulaView?.plainZh).toMatch(/匹配|调和|残差/)
    const crossA = enriched.find(
      (n) => n.id === 'lbm-compose-cross-arithmetic-residual' && n.formulaView,
    )
    expect(crossA?.formulaView?.plainZh).toMatch(/交叉|算术|残差/)
    const dualAm = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-AM' && n.formulaView,
    )
    expect(dualAm?.formulaView?.plainZh).toMatch(/匹配|交叉|算术|dual|残差/)
    const dualGm = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-GM' && n.formulaView,
    )
    expect(dualGm?.formulaView?.plainZh).toMatch(/几何|dual|矩形|零/)
    const dualMax = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-max' && n.formulaView,
    )
    expect(dualMax?.formulaView?.plainZh).toMatch(/means dual|最大|上确界/)
    const dualGate = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-honesty-gate' && n.formulaView,
    )
    expect(dualGate?.formulaView?.plainZh).toMatch(/means dual|包装|诚实|门/)
    const dualMin = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-min' && n.formulaView,
    )
    expect(dualMin?.formulaView?.plainZh).toMatch(/means dual|最小|下确界/)
    const dualRms = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-rms' && n.formulaView,
    )
    expect(dualRms?.formulaView?.plainZh).toMatch(/means dual|RMS|均方根/)
    const envGate = enriched.find(
      (n) => n.id === 'lbm-compose-dual-envelope-honesty-gate' && n.formulaView,
    )
    expect(envGate?.formulaView?.plainZh).toMatch(/dual envelope|包装|诚实|门/)
    const dualL1 = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-L1' && n.formulaView,
    )
    expect(dualL1?.formulaView?.plainZh).toMatch(/means dual|L1|算术/)
    const l1Gate = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-L1-honesty-gate' && n.formulaView,
    )
    expect(l1Gate?.formulaView?.plainZh).toMatch(/means dual L1|包装|诚实|门/)
    const l1Rms = enriched.find(
      (n) => n.id === 'lbm-compose-L1-RMS-dual' && n.formulaView,
    )
    expect(l1Rms?.formulaView?.plainZh).toMatch(/means dual|L1|RMS/)
    const l1edg = enriched.find(
      (n) =>
        n.id === 'lbm-compose-L1-envelope-dual-honesty-gate' && n.formulaView,
    )
    expect(l1edg?.formulaView?.plainZh).toMatch(/L1 envelope dual|包装|诚实|门/)
    const minL1d = enriched.find(
      (n) => n.id === 'lbm-compose-min-L1-dual' && n.formulaView,
    )
    expect(minL1d?.formulaView?.plainZh).toMatch(/means dual|min|L1/)
    const fullg = enriched.find(
      (n) =>
        n.id === 'lbm-compose-full-envelope-honesty-gate' && n.formulaView,
    )
    expect(fullg?.formulaView?.plainZh).toMatch(/FullEnvelope|包装|诚实|门/)
    const l1RmsAdj = enriched.find(
      (n) => n.id === 'lbm-compose-L1-RMS-adjacent-dual' && n.formulaView,
    )
    expect(l1RmsAdj?.formulaView?.plainZh).toMatch(/means dual|L1|RMS/)
    const adjg = enriched.find(
      (n) =>
        n.id === 'lbm-compose-adjacent-envelope-honesty-gate' && n.formulaView,
    )
    expect(adjg?.formulaView?.plainZh).toMatch(/AdjacentEnvelope|包装|诚实|门/)
    const minL1Adj = enriched.find(
      (n) => n.id === 'lbm-compose-min-L1-adjacent-dual' && n.formulaView,
    )
    expect(minL1Adj?.formulaView?.plainZh).toMatch(/means dual|min|L1/)
    const telg = enriched.find(
      (n) =>
        n.id === 'lbm-compose-triple-envelope-honesty-gate' && n.formulaView,
    )
    expect(telg?.formulaView?.plainZh).toMatch(/TripleEnvelope|包装|诚实|门/)
    const dab = enriched.find(
      (n) => n.id === 'lbm-compose-dualAdj-minL1-L1Rms' && n.formulaView,
    )
    expect(dab?.formulaView?.plainZh).toMatch(/dualAdj|minL1|L1Rms/)
    const dtg = enriched.find(
      (n) =>
        n.id === 'lbm-compose-dualAdj-triangle-honesty-gate' && n.formulaView,
    )
    expect(dtg?.formulaView?.plainZh).toMatch(/DualAdjTriangle|包装|诚实|门/)
  })

  it('findMethodsByLink jobKind lbm-d3q19', () => {
    const hit = findMethodsByLink({ jobKind: 'lbm-d3q19' })
    expect(hit.some((m) => m.id === 'kind-lbm-d3q19')).toBe(true)
  })

  it('parallel session includes LBM with md and acoustics', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-lbm-d3q19', 'kind-md-lj', 'kind-acoustics-3d'],
      layers: 'all',
    })
    expect(session.methods).toHaveLength(3)
    expect(
      session.allSubExplains.some((n) => n.id === 'lbm-foundation-viscosity'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'lbm-foundation-re'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'lbm-compose-mach'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'lbm-compose-AM'),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'lbm-compose-cross-harmonic-residual',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'lbm-compose-means-dual-max',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'lbm-compose-means-dual-honesty-gate',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'lbm-compose-dual-envelope-honesty-gate',
      ),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'md-compose-force-closure'),
    ).toBe(true)
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const cavity = enriched.find(
      (n) => n.id === 'lbm-foundation-re' && n.formulaView,
    )
    expect(cavity?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(cavity?.formulaView?.expr).toMatch(/Re|U/)
    const lbmCompose = enriched.find(
      (n) => n.id === 'lbm-compose-re-tau' && n.formulaView,
    )
    expect(lbmCompose?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const amView = enriched.find(
      (n) => n.id === 'lbm-compose-HM' && n.formulaView,
    )
    expect(amView?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const meansDual = enriched.find(
      (n) => n.id === 'lbm-compose-means-dual-AM' && n.formulaView,
    )
    expect(meansDual?.formulaView?.plainZh.length).toBeGreaterThan(4)
  })

  it('path-experiment drills method → principle → foundation with photo/skill formulas', () => {
    const tree = getMethodExplainTree('kind-path-experiment')
    expect(tree).toBeTruthy()
    const flat = flattenExplainTree(tree!)
    const layers = new Set(flat.map((n) => n.layer))
    expect(layers.has('method')).toBe(true)
    expect(layers.has('principle')).toBe(true)
    expect(layers.has('foundation')).toBe(true)
    expect(layers.has('engineering')).toBe(true)
    expect(layers.has('compose')).toBe(true)
    expect(layers.has('L0')).toBe(true)

    const foundations = flat.filter((n) => n.layer === 'foundation')
    expect(foundations.length).toBeGreaterThanOrEqual(14)
    const withFormula = foundations.filter((n) => n.formula)
    expect(withFormula.length).toBeGreaterThanOrEqual(14)
    for (const n of withFormula) {
      expect(n.formula?.plainZh && n.formula.plainZh.length).toBeGreaterThan(4)
    }

    const kteff = flat.find((n) => n.id === 'path-foundation-kteff')
    expect(kteff?.formula?.expr).toMatch(/k_T|k_q/)
    expect(kteff?.formula?.expected).toBeCloseTo(2, 10)
    expect(kteff?.formula?.plainZh).toMatch(/失活|Type/)

    const a = flat.find((n) => n.id === 'path-foundation-a')
    expect(a?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(a?.formula?.plainZh).toMatch(/激发|S1/)

    const b = flat.find((n) => n.id === 'path-foundation-b')
    expect(b?.formula?.expected).toBeCloseTo(1.5, 10)

    const S0 = flat.find((n) => n.id === 'path-foundation-S0ss')
    expect(S0?.formula?.expected).toBeCloseTo(0.8, 10)
    expect(S0?.formula?.plainZh).toMatch(/基态|稳态/)

    const T1 = flat.find((n) => n.id === 'path-foundation-T1ss')
    expect(T1?.formula?.expected).toBeCloseTo(0.12, 10)
    expect(T1?.formula?.plainZh).toMatch(/T1|三线态|稳态/)

    const phi = flat.find((n) => n.id === 'path-foundation-phiT')
    expect(phi?.formula?.expected).toBeCloseTo(0.12, 10)
    expect(phi?.formula?.plainZh).toMatch(/三线态|占比/)

    const gen = flat.find((n) => n.id === 'path-foundation-gen')
    expect(gen?.formula?.expected).toBeCloseTo(0.18, 10)
    expect(gen?.formula?.plainZh).toMatch(/生成|氧|Type/)

    const O1 = flat.find((n) => n.id === 'path-foundation-O1ss')
    expect(O1?.formula?.expected).toBeCloseTo(0.036, 10)

    const cons = flat.find((n) => n.id === 'path-foundation-conservation')
    expect(cons?.formula?.expected).toBeCloseTo(1, 10)
    expect(cons?.formula?.plainZh).toMatch(/守恒|三/)

    const fII = flat.find((n) => n.id === 'path-foundation-typeII')
    expect(fII?.formula?.expected).toBeCloseTo(0.75, 10)
    expect(fII?.formula?.plainZh).toMatch(/Type II|分支/)

    const branchSum = flat.find((n) => n.id === 'path-foundation-branch-sum')
    expect(branchSum?.formula?.expected).toBeCloseTo(1, 10)

    const rk4 = flat.find((n) => n.id === 'path-foundation-rk4-step')
    expect(rk4?.formula?.expr).toMatch(/k1|dt/)
    expect(rk4?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(rk4?.formula?.plainZh).toMatch(/RK4/)

    const res = flat.find((n) => n.id === 'path-foundation-ss-residual')
    expect(res?.formula?.expected).toBeCloseTo(0.001, 10)
    expect(res?.formula?.plainZh).toMatch(/残差|稳态/)

    const skill = flat.find((n) => n.id === 'path-foundation-skill')
    expect(skill?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(skill?.formula?.plainZh).toMatch(/技能/)

    const crps = flat.find((n) => n.id === 'path-foundation-crps-skill')
    expect(crps?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(crps?.formula?.plainZh).toMatch(/CRPS|技能/)

    const composePhi = flat.find((n) => n.id === 'path-compose-phi-from-ab')
    expect(composePhi?.formula?.expected).toBeCloseTo(0.12, 10)
    expect(composePhi?.formula?.plainZh).toMatch(/三线态|a|b|合成/)

    const composeG = flat.find((n) => n.id === 'path-compose-G-from-T1')
    expect(composeG?.formula?.expected).toBeCloseTo(0.18, 10)

    const composeT1 = flat.find((n) => n.id === 'path-compose-T1ss-from-ab')
    expect(composeT1?.formula?.expr).toMatch(/a \* b|cTot/)
    expect(composeT1?.formula?.expected).toBeCloseTo(0.12, 10)
    expect(composeT1?.formula?.plainZh).toMatch(/三线态|稳态|a|b|合成/)

    const composeO1 = flat.find((n) => n.id === 'path-compose-O1ss-from-phi')
    expect(composeO1?.formula?.expr).toMatch(/k_q|phiT|k_d/)
    expect(composeO1?.formula?.expected).toBeCloseTo(0.036, 10)
    expect(composeO1?.formula?.plainZh).toMatch(/单线态氧|猝灭|占比|衰减/)

    const composePhiRates = flat.find((n) => n.id === 'path-compose-phi-from-rates')
    expect(composePhiRates?.formula?.expected).toBeCloseTo(0.12, 10)
    expect(composePhiRates?.formula?.plainZh).toMatch(/三线态|速率|a|b|合成/)

    const composeGfII = flat.find((n) => n.id === 'path-compose-G-from-fII')
    expect(composeGfII?.formula?.expr).toMatch(/f_II|kTeff|T1/)
    expect(composeGfII?.formula?.expected).toBeCloseTo(0.18, 10)
    expect(composeGfII?.formula?.plainZh).toMatch(/Type II|分支|生成|T1/)

    const composeCons = flat.find(
      (n) => n.id === 'path-compose-conservation-residual',
    )
    expect(composeCons?.formula?.expected).toBeCloseTo(0, 10)
    expect(composeCons?.formula?.plainZh).toMatch(/守恒|残差|三/)

    const composeBranch = flat.find((n) => n.id === 'path-compose-branch-residual')
    expect(composeBranch?.formula?.expected).toBeCloseTo(0, 10)
    expect(composeBranch?.formula?.plainZh).toMatch(/分支|残差|归一/)

    const composeAb = flat.find((n) => n.id === 'path-compose-ab-from-rates')
    expect(composeAb?.formula?.expected).toBeCloseTo(0.15, 10)
    expect(composeAb?.formula?.plainZh).toMatch(/a|b|乘积|三线态|分子/)

    const composeKteff = flat.find((n) => n.id === 'path-compose-kteff')
    expect(composeKteff?.formula?.expr).toMatch(/k_T|k_q/)
    expect(composeKteff?.formula?.expected).toBeCloseTo(2, 10)
    expect(composeKteff?.formula?.plainZh).toMatch(/失活|Type|合成/)

    const composeA = flat.find((n) => n.id === 'path-compose-a-from-rates')
    expect(composeA?.formula?.expr).toMatch(/k_exc|k_f|k_isc/)
    expect(composeA?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(composeA?.formula?.plainZh).toMatch(/激发|S1|合成|a/)

    const composeB = flat.find((n) => n.id === 'path-compose-b-from-rates')
    expect(composeB?.formula?.expr).toMatch(/k_isc|kTeff/)
    expect(composeB?.formula?.expected).toBeCloseTo(1.5, 10)
    expect(composeB?.formula?.plainZh).toMatch(/ISC|失活|合成|b/)

    const composeS0 = flat.find((n) => n.id === 'path-compose-S0ss-from-ab')
    expect(composeS0?.formula?.expr).toMatch(/cTot|a|b/)
    expect(composeS0?.formula?.expected).toBeCloseTo(0.8, 10)
    expect(composeS0?.formula?.plainZh).toMatch(/基态|稳态|合成/)

    const composeS1 = flat.find((n) => n.id === 'path-compose-S1ss-from-ab')
    expect(composeS1?.formula?.expr).toMatch(/a|cTot/)
    expect(composeS1?.formula?.expected).toBeCloseTo(0.08, 10)
    expect(composeS1?.formula?.plainZh).toMatch(/S1|稳态|合成/)

    const composeFII = flat.find((n) => n.id === 'path-compose-fII-from-rates')
    expect(composeFII?.formula?.expr).toMatch(/k_q|kTeff|f_II/)
    expect(composeFII?.formula?.expected).toBeCloseTo(0.75, 10)
    expect(composeFII?.formula?.plainZh).toMatch(/Type II|分支|合成/)

    const composeRk4 = flat.find((n) => n.id === 'path-compose-rk4-step')
    expect(composeRk4?.formula?.expr).toMatch(/k1|dt/)
    expect(composeRk4?.formula?.expected).toBeCloseTo(0.1, 10)
    expect(composeRk4?.formula?.plainZh).toMatch(/RK4|斜率|合成/)

    const composeRes = flat.find((n) => n.id === 'path-compose-ss-residual')
    expect(composeRes?.formula?.expected).toBeCloseTo(0.001, 10)
    expect(composeRes?.formula?.plainZh).toMatch(/残差|稳态|RK4/)

    const composeSkill = flat.find((n) => n.id === 'path-compose-skill')
    expect(composeSkill?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(composeSkill?.formula?.plainZh).toMatch(/技能|评分|合成/)

    const composeGDual = flat.find((n) => n.id === 'path-compose-G-dual-residual')
    expect(composeGDual?.formula?.expr).toMatch(/k_q|f_II|kTeff/)
    expect(composeGDual?.formula?.expected).toBeCloseTo(0, 10)
    expect(composeGDual?.formula?.plainZh).toMatch(/生成|两路|残差|闭合/)

    const composePhiMatch = flat.find(
      (n) => n.id === 'path-compose-phi-match-residual',
    )
    expect(composePhiMatch?.formula?.expected).toBeCloseTo(0, 10)
    expect(composePhiMatch?.formula?.plainZh).toMatch(/三线态|占比|残差|闭合/)

    const composeO1G = flat.find((n) => n.id === 'path-compose-O1-from-G')
    expect(composeO1G?.formula?.expr).toMatch(/G_ss|k_d/)
    expect(composeO1G?.formula?.expected).toBeCloseTo(0.036, 10)
    expect(composeO1G?.formula?.plainZh).toMatch(/单线态氧|生成|衰减|合成/)

    const composeCrps = flat.find((n) => n.id === 'path-compose-crps-skill')
    expect(composeCrps?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(composeCrps?.formula?.plainZh).toMatch(/CRPS|技能|合成/)

    // S20bh V-measure / AMI quinqueviguple skill residual packaging (wave28 residual compose expand)
    const cV = flat.find((n) => n.id === 'path-compose-v-measure')
    expect(cV?.formula?.expr).toMatch(/V|h|c/)
    expect(cV?.formula?.expected).toBeCloseTo((2 * 0.9 * 0.8) / (0.9 + 0.8), 12)
    expect(cV?.formula?.plainZh).toMatch(/V-measure|同质|完整/)

    const cVs = flat.find((n) => n.id === 'path-compose-v-measure-skill')
    expect(cVs?.formula?.expr).toMatch(/V_skill|V_ref/)
    expect(cVs?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(cVs?.formula?.plainZh).toMatch(/V-measure|技能|损失/)

    const cAmi = flat.find((n) => n.id === 'path-compose-ami-skill')
    expect(cAmi?.formula?.expr).toMatch(/ami_skill|score_AMI/)
    expect(cAmi?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(cAmi?.formula?.plainZh).toMatch(/AMI|技能/)

    const cNmi = flat.find((n) => n.id === 'path-compose-nmi-skill')
    expect(cNmi?.formula?.expr).toMatch(/nmi_skill|score_NMI/)
    expect(cNmi?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(cNmi?.formula?.plainZh).toMatch(/NMI|技能/)

    const cVa = flat.find((n) => n.id === 'path-compose-v-ami-dual-residual')
    expect(cVa?.formula?.expr).toMatch(/V_skill|ami_skill/)
    expect(cVa?.formula?.expected).toBeCloseTo(0, 10)
    expect(cVa?.formula?.plainZh).toMatch(/V-measure|AMI|dual|诚实/)

    const cNa = flat.find((n) => n.id === 'path-compose-nmi-ami-dual-residual')
    expect(cNa?.formula?.expr).toMatch(/nmi_skill|ami_skill/)
    expect(cNa?.formula?.expected).toBeCloseTo(0, 10)
    expect(cNa?.formula?.plainZh).toMatch(/NMI|AMI|dual|诚实/)

    const cQv = flat.find(
      (n) => n.id === 'path-compose-quinqueviguple-mean-skill',
    )
    expect(cQv?.formula?.expr).toMatch(/mean_skill|skill_sum|25/)
    expect(cQv?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(cQv?.formula?.plainZh).toMatch(/quinqueviguple|平均|技能/)

    const cSmax = flat.find(
      (n) => n.id === 'path-compose-skill-dual-max-residual',
    )
    expect(cSmax?.formula?.expr).toMatch(/max_ij|skill/)
    expect(cSmax?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSmax?.formula?.plainZh).toMatch(/技能|dual|上确界|最大/)

    const cVg = flat.find((n) => n.id === 'path-compose-v-measure-honesty-gate')
    expect(cVg?.formula?.expr).toMatch(/gate|c_V|c_AMI/)
    expect(cVg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cVg?.formula?.plainZh).toMatch(/V-measure|包装|诚实|门/)

    // S20bi V-measure sexviguple skill dual residual packaging (wave29 residual compose expand)
    const cAri = flat.find((n) => n.id === 'path-compose-ari-skill')
    expect(cAri?.formula?.expr).toMatch(/ari_skill|score_ARI/)
    expect(cAri?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(cAri?.formula?.plainZh).toMatch(/ARI|技能/)

    const cVar = flat.find((n) => n.id === 'path-compose-v-ari-dual-residual')
    expect(cVar?.formula?.expr).toMatch(/V_skill|ari_skill/)
    expect(cVar?.formula?.expected).toBeCloseTo(0, 10)
    expect(cVar?.formula?.plainZh).toMatch(/V-measure|ARI|dual|诚实/)

    const cAar = flat.find((n) => n.id === 'path-compose-ami-ari-dual-residual')
    expect(cAar?.formula?.expr).toMatch(/ami_skill|ari_skill/)
    expect(cAar?.formula?.expected).toBeCloseTo(0, 10)
    expect(cAar?.formula?.plainZh).toMatch(/AMI|ARI|dual|诚实/)

    const cNar = flat.find((n) => n.id === 'path-compose-nmi-ari-dual-residual')
    expect(cNar?.formula?.expr).toMatch(/nmi_skill|ari_skill/)
    expect(cNar?.formula?.expected).toBeCloseTo(0, 10)
    expect(cNar?.formula?.plainZh).toMatch(/NMI|ARI|dual|诚实/)

    const cSv = flat.find((n) => n.id === 'path-compose-sexviguple-mean-skill')
    expect(cSv?.formula?.expr).toMatch(/mean_skill|skill_sum|26/)
    expect(cSv?.formula?.expected).toBeCloseTo(0.6, 10)
    expect(cSv?.formula?.plainZh).toMatch(/sexviguple|平均|技能/)

    const cSvmax = flat.find(
      (n) => n.id === 'path-compose-sexviguple-skill-dual-max',
    )
    expect(cSvmax?.formula?.expr).toMatch(/max_ij|skill/)
    expect(cSvmax?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSvmax?.formula?.plainZh).toMatch(/sexviguple|技能|dual|上确界|最大/)

    const cSvrms = flat.find(
      (n) => n.id === 'path-compose-sexviguple-skill-rms-spread',
    )
    expect(cSvrms?.formula?.expr).toMatch(/rms_spread|mean_sq_dev/)
    expect(cSvrms?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSvrms?.formula?.plainZh).toMatch(/sexviguple|RMS|离散/)

    const cSvg = flat.find(
      (n) => n.id === 'path-compose-v-measure-sexviguple-honesty-gate',
    )
    expect(cSvg?.formula?.expr).toMatch(/gate|c_V|c_ARI/)
    expect(cSvg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cSvg?.formula?.plainZh).toMatch(/V-measure|sexviguple|包装|诚实|门/)

    // S20bj skill envelope min/RMS dual of max residual packaging (wave30 residual compose expand)
    const cSmin = flat.find((n) => n.id === 'path-compose-skill-min-abs-diff')
    expect(cSmin?.formula?.expr).toMatch(/min_abs|min_ij/)
    expect(cSmin?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSmin?.formula?.plainZh).toMatch(/sexviguple|技能|dual|最小/)

    const cSrms = flat.find((n) => n.id === 'path-compose-skill-rms-diff')
    expect(cSrms?.formula?.expr).toMatch(/rms_diff|mean_pair/)
    expect(cSrms?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSrms?.formula?.plainZh).toMatch(/sexviguple|技能|RMS|成对/)

    const cSord = flat.find(
      (n) => n.id === 'path-compose-skill-envelope-ordered',
    )
    expect(cSord?.formula?.expr).toMatch(/min_abs|rms_diff|max_abs/)
    expect(cSord?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSord?.formula?.plainZh).toMatch(/包络序|min|rms|max/)

    const cSspan = flat.find((n) => n.id === 'path-compose-skill-envelope-span')
    expect(cSspan?.formula?.expr).toMatch(/span|max_abs|min_abs/)
    expect(cSspan?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSspan?.formula?.plainZh).toMatch(/包络|跨度|技能/)

    const cScrest = flat.find(
      (n) => n.id === 'path-compose-skill-envelope-crest',
    )
    expect(cScrest?.formula?.expr).toMatch(/crest|max_abs|rms_diff/)
    expect(cScrest?.formula?.expected).toBeCloseTo(2, 10)
    expect(cScrest?.formula?.plainZh).toMatch(/峰均|上确界|RMS/)

    const cSenvg = flat.find(
      (n) => n.id === 'path-compose-skill-envelope-honesty-gate',
    )
    expect(cSenvg?.formula?.expr).toMatch(/gate|c_min|c_rms/)
    expect(cSenvg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cSenvg?.formula?.plainZh).toMatch(/skill envelope|包装|诚实|门/)

    // S20bk skill envelope CV/skew + rmsMinGap dual residual packaging (wave31 residual compose expand)
    const cSmean = flat.find((n) => n.id === 'path-compose-skill-mean-abs-diff')
    expect(cSmean?.formula?.expr).toMatch(/mean_abs|mean_pair/)
    expect(cSmean?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSmean?.formula?.plainZh).toMatch(/sexviguple|技能|平均|绝对/)

    const cScv = flat.find((n) => n.id === 'path-compose-skill-cv-diff')
    expect(cScv?.formula?.expr).toMatch(/cv_diff|std_abs|mean_abs/)
    expect(cScv?.formula?.expected).toBeCloseTo(2, 10)
    expect(cScv?.formula?.plainZh).toMatch(/变异|标准差|均值/)

    const cSskew = flat.find((n) => n.id === 'path-compose-skill-skew-diff')
    expect(cSskew?.formula?.expr).toMatch(/skew_diff|mean_cubed|std_abs/)
    expect(cSskew?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSskew?.formula?.plainZh).toMatch(/偏度|三阶|标准差/)

    const cSrmin = flat.find((n) => n.id === 'path-compose-skill-rms-min-gap')
    expect(cSrmin?.formula?.expr).toMatch(/rms_min_gap|rms_diff|min_abs/)
    expect(cSrmin?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(cSrmin?.formula?.plainZh).toMatch(/min|rms|dual|间隙/)

    const cSrmax = flat.find((n) => n.id === 'path-compose-skill-max-rms-gap')
    expect(cSrmax?.formula?.expr).toMatch(/max_rms_gap|max_abs|rms_diff/)
    expect(cSrmax?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(cSrmax?.formula?.plainZh).toMatch(/max|rms|dual|间隙/)

    const cSmomg = flat.find(
      (n) => n.id === 'path-compose-skill-envelope-moments-honesty-gate',
    )
    expect(cSmomg?.formula?.expr).toMatch(/gate|c_mean|c_cv/)
    expect(cSmomg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cSmomg?.formula?.plainZh).toMatch(
      /skill envelope moments|包装|诚实|门/,
    )

    // S20bl skill envelope kurtosis + maxMinGap dual residual packaging (wave32 residual compose expand)
    const cSkurt = flat.find((n) => n.id === 'path-compose-skill-kurtosis-diff')
    expect(cSkurt?.formula?.expr).toMatch(/kurtosis_diff|mean_fourth|std_abs/)
    expect(cSkurt?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSkurt?.formula?.plainZh).toMatch(/峰度|四阶|标准差/)

    const cSmmin = flat.find((n) => n.id === 'path-compose-skill-max-min-gap')
    expect(cSmmin?.formula?.expr).toMatch(/max_min_gap|max_abs|min_abs/)
    expect(cSmmin?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cSmmin?.formula?.plainZh).toMatch(/max|min|dual|间隙/)

    const cSmrmsd = flat.find(
      (n) => n.id === 'path-compose-skill-max-rms-gap-dual',
    )
    expect(cSmrmsd?.formula?.expr).toMatch(/max_rms_gap|max_abs|rms_diff/)
    expect(cSmrmsd?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(cSmrmsd?.formula?.plainZh).toMatch(/max|rms|dual|间隙/)

    const cSkurtg = flat.find(
      (n) => n.id === 'path-compose-skill-envelope-kurtosis-honesty-gate',
    )
    expect(cSkurtg?.formula?.expr).toMatch(/gate|c_kurt|c_mmin/)
    expect(cSkurtg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cSkurtg?.formula?.plainZh).toMatch(
      /skill envelope kurtosis|包装|诚实|门/,
    )

    // S20bm skill envelope MAD/IQR + medianMeanGap dual residual packaging (wave33 residual compose expand)
    const cSmad = flat.find((n) => n.id === 'path-compose-skill-mad-diff')
    expect(cSmad?.formula?.expr).toMatch(/MAD|median/)
    expect(cSmad?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSmad?.formula?.plainZh).toMatch(/MAD|中位数|绝对/)

    const cSiqr = flat.find((n) => n.id === 'path-compose-skill-iqr-diff')
    expect(cSiqr?.formula?.expr).toMatch(/IQR|Q3|Q1/)
    expect(cSiqr?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cSiqr?.formula?.plainZh).toMatch(/IQR|四分位/)

    const cSmmg = flat.find(
      (n) => n.id === 'path-compose-skill-median-mean-gap',
    )
    expect(cSmmg?.formula?.expr).toMatch(/median_mean_gap|median_abs|mean_abs/)
    expect(cSmmg?.formula?.expected).toBeCloseTo(0.005, 10)
    expect(cSmmg?.formula?.plainZh).toMatch(/median|mean|dual|间隙/)

    const cSmadIqr = flat.find((n) => n.id === 'path-compose-skill-mad-iqr-dual')
    expect(cSmadIqr?.formula?.expr).toMatch(/MAD|IQR|1\.349/)
    expect(cSmadIqr?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSmadIqr?.formula?.plainZh).toMatch(/MAD|IQR|dual/)

    const cSrobg = flat.find(
      (n) => n.id === 'path-compose-skill-envelope-robust-honesty-gate',
    )
    expect(cSrobg?.formula?.expr).toMatch(/gate|c_mad|c_iqr/)
    expect(cSrobg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cSrobg?.formula?.plainZh).toMatch(
      /skill envelope robust|包装|诚实|门/,
    )

    // S20bn skill envelope percentile gap p90−p10 + rangeIqrGap dual residual (wave34 residual compose expand)
    const cSp9010 = flat.find((n) => n.id === 'path-compose-skill-p90-p10-gap')
    expect(cSp9010?.formula?.expr).toMatch(/p90|p10/)
    expect(cSp9010?.formula?.expected).toBeCloseTo(0.03, 10)
    expect(cSp9010?.formula?.plainZh).toMatch(/百分位|p90|p10/)

    const cSriq = flat.find((n) => n.id === 'path-compose-skill-range-iqr-gap')
    expect(cSriq?.formula?.expr).toMatch(/range_iqr_gap|max_min_gap|IQR/)
    expect(cSriq?.formula?.expected).toBeCloseTo(0.03, 10)
    expect(cSriq?.formula?.plainZh).toMatch(/maxMin|IQR|dual|间隙/)

    const cSmmIqr = flat.find((n) => n.id === 'path-compose-skill-maxmin-iqr-dual')
    expect(cSmmIqr?.formula?.expr).toMatch(/max_min_gap|IQR/)
    expect(cSmmIqr?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSmmIqr?.formula?.plainZh).toMatch(/maxMin|IQR|dual/)

    const cSpr = flat.find(
      (n) => n.id === 'path-compose-skill-percentile-range-dual',
    )
    expect(cSpr?.formula?.expr).toMatch(/p90_p10_gap|max_min_gap/)
    expect(cSpr?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSpr?.formula?.plainZh).toMatch(/percentile|range|dual/)

    const cSpctg = flat.find(
      (n) => n.id === 'path-compose-skill-envelope-percentile-honesty-gate',
    )
    expect(cSpctg?.formula?.expr).toMatch(/gate|c_p9010|c_riq/)
    expect(cSpctg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cSpctg?.formula?.plainZh).toMatch(
      /skill envelope percentile|包装|诚实|门/,
    )

    // S20bo skill envelope rangePercentileGap + percentileIqrGap dual residual (wave35 residual compose expand)
    const cSrp = flat.find(
      (n) => n.id === 'path-compose-skill-range-percentile-gap',
    )
    expect(cSrp?.formula?.expr).toMatch(/range_percentile_gap|max_min_gap|p90/)
    expect(cSrp?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cSrp?.formula?.plainZh).toMatch(/rangePercentile|全距|百分位/)

    const cSpi = flat.find(
      (n) => n.id === 'path-compose-skill-percentile-iqr-gap',
    )
    expect(cSpi?.formula?.expr).toMatch(/percentile_iqr_gap|p90|IQR/)
    expect(cSpi?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cSpi?.formula?.plainZh).toMatch(/percentileIqr|百分位|四分位/)

    const cStel = flat.find(
      (n) => n.id === 'path-compose-skill-range-iqr-identity',
    )
    expect(cStel?.formula?.expr).toMatch(/range_iqr_gap|range_percentile|percentile_iqr/)
    expect(cStel?.formula?.expected).toBeCloseTo(0, 10)
    expect(cStel?.formula?.plainZh).toMatch(/望远镜|rangeIqr|恒等/)

    const cSrpAbs = flat.find(
      (n) => n.id === 'path-compose-skill-range-percentile-dual',
    )
    expect(cSrpAbs?.formula?.expr).toMatch(/range_percentile_gap/)
    expect(cSrpAbs?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSrpAbs?.formula?.plainZh).toMatch(/rangePercentile|dual|诚实/)

    const cSrpg = flat.find(
      (n) =>
        n.id === 'path-compose-skill-envelope-range-percentile-honesty-gate',
    )
    expect(cSrpg?.formula?.expr).toMatch(/gate|c_rp|c_pi/)
    expect(cSrpg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cSrpg?.formula?.plainZh).toMatch(
      /skill envelope rangePercentile|包装|诚实|门/,
    )

    // S20bp upperTailGap/lowerTailGap + rangeIqrIdentityAbs (wave36 residual compose expand; bridges wave35)
    const cSut = flat.find((n) => n.id === 'path-compose-skill-upper-tail-gap')
    expect(cSut?.formula?.expr).toMatch(/upper_tail_gap|max_abs|p90/)
    expect(cSut?.formula?.expected).toBeCloseTo(0.02, 10)
    expect(cSut?.formula?.plainZh).toMatch(/upperTail|最大|p90/)

    const cSlt = flat.find((n) => n.id === 'path-compose-skill-lower-tail-gap')
    expect(cSlt?.formula?.expr).toMatch(/lower_tail_gap|p10|min_abs/)
    expect(cSlt?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(cSlt?.formula?.plainZh).toMatch(/lowerTail|p10|最小/)

    const cStail = flat.find(
      (n) => n.id === 'path-compose-skill-range-percentile-tail-identity',
    )
    expect(cStail?.formula?.expr).toMatch(
      /range_percentile_gap|upper_tail_gap|lower_tail_gap/,
    )
    expect(cStail?.formula?.expected).toBeCloseTo(0, 10)
    expect(cStail?.formula?.plainZh).toMatch(/rangePercentile|upperTail|lowerTail|恒等/)

    const cSriqa = flat.find(
      (n) => n.id === 'path-compose-skill-range-iqr-identity-abs',
    )
    expect(cSriqa?.formula?.expr).toMatch(
      /range_iqr_identity_abs|range_iqr_gap|range_percentile/,
    )
    expect(cSriqa?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSriqa?.formula?.plainZh).toMatch(/rangeIqrIdentityAbs|绝对值/)

    const cStailg = flat.find(
      (n) => n.id === 'path-compose-skill-envelope-tail-identity-honesty-gate',
    )
    expect(cStailg?.formula?.expr).toMatch(/gate|c_up|c_lo|c_riq/)
    expect(cStailg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cStailg?.formula?.plainZh).toMatch(
      /skill envelope tail-identity|包装|诚实|门/,
    )

    // S20bq midTailGap/interDecileGap + rangePercentileTailIdentityAbs (wave37 residual compose expand; bridges wave36)
    const cSmt = flat.find((n) => n.id === 'path-compose-skill-mid-tail-gap')
    expect(cSmt?.formula?.expr).toMatch(
      /mid_tail_gap|max_min_gap|upper_tail_gap|lower_tail_gap/,
    )
    expect(cSmt?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(cSmt?.formula?.plainZh).toMatch(/midTail|全距|上尾|下尾/)

    const cSid = flat.find((n) => n.id === 'path-compose-skill-inter-decile-gap')
    expect(cSid?.formula?.expr).toMatch(/inter_decile_gap|p90|p10/)
    expect(cSid?.formula?.expected).toBeCloseTo(0.01, 10)
    expect(cSid?.formula?.plainZh).toMatch(/interDecile|p90|p10/)

    const cSmid = flat.find(
      (n) => n.id === 'path-compose-skill-mid-inter-decile-identity',
    )
    expect(cSmid?.formula?.expr).toMatch(
      /mid_tail_gap|inter_decile_gap|percentile_gap/,
    )
    expect(cSmid?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSmid?.formula?.plainZh).toMatch(/midTail|interDecile|percentile|恒等/)

    const cSrpta = flat.find(
      (n) => n.id === 'path-compose-skill-range-percentile-tail-identity-abs',
    )
    expect(cSrpta?.formula?.expr).toMatch(
      /range_percentile_tail_identity_abs|range_percentile_gap|upper_tail_gap|lower_tail_gap/,
    )
    expect(cSrpta?.formula?.expected).toBeCloseTo(0, 10)
    expect(cSrpta?.formula?.plainZh).toMatch(
      /rangePercentileTailIdentityAbs|绝对值/,
    )

    const cSmidg = flat.find(
      (n) =>
        n.id === 'path-compose-skill-envelope-mid-inter-decile-honesty-gate',
    )
    expect(cSmidg?.formula?.expr).toMatch(/gate|c_mid|c_id|c_rpta/)
    expect(cSmidg?.formula?.expected).toBeCloseTo(1, 10)
    expect(cSmidg?.formula?.plainZh).toMatch(
      /skill envelope mid\/inter-decile|包装|诚实|门/,
    )


    const composeWithFormula = flat.filter(
      (n) => n.id.startsWith('path-compose-') && n.formula,
    )
    expect(composeWithFormula.length).toBeGreaterThanOrEqual(78)
    for (const n of composeWithFormula) {
      expect(n.formula?.plainZh && n.formula.plainZh.length).toBeGreaterThan(4)
      expect(n.formula?.plainEn && n.formula.plainEn.length).toBeGreaterThan(4)
      expect(n.formula?.expected).toEqual(expect.any(Number))
      expect(Number.isFinite(n.formula!.expected as number)).toBe(true)
    }
  })

  it('path-experiment enrichWithFormulaViews attaches plainZh on photo foundations', () => {
    const session = buildParallelExplainSession({
      methodIds: ['kind-path-experiment'],
      layers: 'all',
    })
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const kteff = enriched.find(
      (n) => n.id === 'path-foundation-kteff' && n.formulaView,
    )
    expect(kteff?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(kteff?.formulaView?.expr).toMatch(/k_T|k_q/)
    const skill = enriched.find(
      (n) => n.id === 'path-foundation-skill' && n.formulaView,
    )
    expect(skill?.formulaView?.plainZh).toMatch(/技能/)
    const composePhi = enriched.find(
      (n) => n.id === 'path-compose-phi-from-ab' && n.formulaView,
    )
    expect(composePhi?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const composeO1 = enriched.find(
      (n) => n.id === 'path-compose-O1ss-from-phi' && n.formulaView,
    )
    expect(composeO1?.formulaView?.plainZh).toMatch(/单线态氧|猝灭|占比/)
    const composeCons = enriched.find(
      (n) => n.id === 'path-compose-conservation-residual' && n.formulaView,
    )
    expect(composeCons?.formulaView?.plainZh).toMatch(/守恒|残差/)
    const composeGfII = enriched.find(
      (n) => n.id === 'path-compose-G-from-fII' && n.formulaView,
    )
    expect(composeGfII?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const composeKteff = enriched.find(
      (n) => n.id === 'path-compose-kteff' && n.formulaView,
    )
    expect(composeKteff?.formulaView?.plainZh).toMatch(/失活|Type|合成/)
    const composeGDual = enriched.find(
      (n) => n.id === 'path-compose-G-dual-residual' && n.formulaView,
    )
    expect(composeGDual?.formulaView?.plainZh).toMatch(/生成|两路|残差|闭合/)
    const composeS0 = enriched.find(
      (n) => n.id === 'path-compose-S0ss-from-ab' && n.formulaView,
    )
    expect(composeS0?.formulaView?.plainZh).toMatch(/基态|稳态|合成/)
    const composeSkill = enriched.find(
      (n) => n.id === 'path-compose-skill' && n.formulaView,
    )
    expect(composeSkill?.formulaView?.plainZh.length).toBeGreaterThan(4)
    const composePhiMatch = enriched.find(
      (n) => n.id === 'path-compose-phi-match-residual' && n.formulaView,
    )
    expect(composePhiMatch?.formulaView?.plainZh).toMatch(/三线态|占比|残差|闭合/)
    const vMeas = enriched.find(
      (n) => n.id === 'path-compose-v-measure' && n.formulaView,
    )
    expect(vMeas?.formulaView?.plainZh).toMatch(/V-measure|同质|完整/)
    const ami = enriched.find(
      (n) => n.id === 'path-compose-ami-skill' && n.formulaView,
    )
    expect(ami?.formulaView?.plainZh).toMatch(/AMI|技能/)
    const vAmi = enriched.find(
      (n) => n.id === 'path-compose-v-ami-dual-residual' && n.formulaView,
    )
    expect(vAmi?.formulaView?.plainZh).toMatch(/V-measure|AMI|dual|诚实/)
    const vGate = enriched.find(
      (n) => n.id === 'path-compose-v-measure-honesty-gate' && n.formulaView,
    )
    expect(vGate?.formulaView?.plainZh).toMatch(/V-measure|包装|诚实|门/)
    const ari = enriched.find(
      (n) => n.id === 'path-compose-ari-skill' && n.formulaView,
    )
    expect(ari?.formulaView?.plainZh).toMatch(/ARI|技能/)
    const vAri = enriched.find(
      (n) => n.id === 'path-compose-v-ari-dual-residual' && n.formulaView,
    )
    expect(vAri?.formulaView?.plainZh).toMatch(/V-measure|ARI|dual|诚实/)
    const svGate = enriched.find(
      (n) =>
        n.id === 'path-compose-v-measure-sexviguple-honesty-gate' &&
        n.formulaView,
    )
    expect(svGate?.formulaView?.plainZh).toMatch(
      /V-measure|sexviguple|包装|诚实|门/,
    )
    const sMin = enriched.find(
      (n) => n.id === 'path-compose-skill-min-abs-diff' && n.formulaView,
    )
    expect(sMin?.formulaView?.plainZh).toMatch(/sexviguple|技能|dual|最小/)
    const sEnvg = enriched.find(
      (n) => n.id === 'path-compose-skill-envelope-honesty-gate' && n.formulaView,
    )
    expect(sEnvg?.formulaView?.plainZh).toMatch(/skill envelope|包装|诚实|门/)
    const sCv = enriched.find(
      (n) => n.id === 'path-compose-skill-cv-diff' && n.formulaView,
    )
    expect(sCv?.formulaView?.plainZh).toMatch(/变异|标准差|均值/)
    const sMomg = enriched.find(
      (n) =>
        n.id === 'path-compose-skill-envelope-moments-honesty-gate' &&
        n.formulaView,
    )
    expect(sMomg?.formulaView?.plainZh).toMatch(
      /skill envelope moments|包装|诚实|门/,
    )
    const sKurt = enriched.find(
      (n) => n.id === 'path-compose-skill-kurtosis-diff' && n.formulaView,
    )
    expect(sKurt?.formulaView?.plainZh).toMatch(/峰度|四阶|标准差/)
    const sKurtg = enriched.find(
      (n) =>
        n.id === 'path-compose-skill-envelope-kurtosis-honesty-gate' &&
        n.formulaView,
    )
    expect(sKurtg?.formulaView?.plainZh).toMatch(
      /skill envelope kurtosis|包装|诚实|门/,
    )
    const sMad = enriched.find(
      (n) => n.id === 'path-compose-skill-mad-diff' && n.formulaView,
    )
    expect(sMad?.formulaView?.plainZh).toMatch(/MAD|中位数|绝对/)
    const sRobg = enriched.find(
      (n) =>
        n.id === 'path-compose-skill-envelope-robust-honesty-gate' &&
        n.formulaView,
    )
    expect(sRobg?.formulaView?.plainZh).toMatch(
      /skill envelope robust|包装|诚实|门/,
    )
    const sP9010 = enriched.find(
      (n) => n.id === 'path-compose-skill-p90-p10-gap' && n.formulaView,
    )
    expect(sP9010?.formulaView?.plainZh).toMatch(/百分位|p90|p10/)
    const sPctg = enriched.find(
      (n) =>
        n.id === 'path-compose-skill-envelope-percentile-honesty-gate' &&
        n.formulaView,
    )
    expect(sPctg?.formulaView?.plainZh).toMatch(
      /skill envelope percentile|包装|诚实|门/,
    )
    const sRp = enriched.find(
      (n) =>
        n.id === 'path-compose-skill-range-percentile-gap' && n.formulaView,
    )
    expect(sRp?.formulaView?.plainZh).toMatch(/rangePercentile|全距|百分位/)
    const sRpg = enriched.find(
      (n) =>
        n.id ===
          'path-compose-skill-envelope-range-percentile-honesty-gate' &&
        n.formulaView,
    )
    expect(sRpg?.formulaView?.plainZh).toMatch(
      /skill envelope rangePercentile|包装|诚实|门/,
    )
    const sMid = enriched.find(
      (n) => n.id === 'path-compose-skill-mid-tail-gap' && n.formulaView,
    )
    expect(sMid?.formulaView?.plainZh).toMatch(/midTail|全距|上尾|下尾/)
    const sMidg = enriched.find(
      (n) =>
        n.id ===
          'path-compose-skill-envelope-mid-inter-decile-honesty-gate' &&
        n.formulaView,
    )
    expect(sMidg?.formulaView?.plainZh).toMatch(
      /skill envelope mid\/inter-decile|包装|诚实|门/,
    )
  })

  it('findMethodsByLink jobKind path-experiment', () => {
    const hit = findMethodsByLink({ jobKind: 'path-experiment' })
    expect(hit.some((m) => m.id === 'kind-path-experiment')).toBe(true)
  })

  it('parallel session includes path-experiment with md and em', () => {
    const session = buildParallelExplainSession({
      methodIds: [
        'kind-path-experiment',
        'kind-md-lj',
        'kind-em-fdtd-3d',
      ],
      layers: 'all',
    })
    expect(session.methods).toHaveLength(3)
    expect(
      session.allSubExplains.some((n) => n.id === 'path-foundation-T1ss'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'path-foundation-skill'),
    ).toBe(true)
    expect(
      session.allSubExplains.some((n) => n.id === 'path-compose-v-measure'),
    ).toBe(true)
    expect(
      session.allSubExplains.some(
        (n) => n.id === 'path-compose-v-measure-honesty-gate',
      ),
    ).toBe(true)
    const enriched = enrichWithFormulaViews(session.allSubExplains, 'zh')
    const photo = enriched.find(
      (n) => n.id === 'path-foundation-phiT' && n.formulaView,
    )
    expect(photo?.formulaView?.plainZh.length).toBeGreaterThan(4)
    expect(photo?.formulaView?.expr).toMatch(/phiT|T1/)
  })
})
