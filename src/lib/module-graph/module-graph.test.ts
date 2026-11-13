import { describe, it, expect } from 'vitest'
import {
  CORE_DOMAINS, DOMAIN_PORT_VARS, domainOf, port, domainCell,
} from './domains'
import { classifyPrimitive, primitiveSpec } from './primitives'
import { portsCompatible, diracWired, composePH } from './composition'
import { etaBoundUnder, conditionsCompatible, conditionsThermalExergy } from './conditions'
import { parseETP, ETP_LABEL } from './module'
import { INFORMATION_THEORY } from './information'
import { edgeToModule, MODULES, domainMatrix, coreMatrixCoverage, inferRole, formOf } from './adapter'
import { EDGES } from '../../data/ontology/edges'
import { KB } from '../physics/constants'

describe('F1 六域 taxonomy', () => {
  it('六域恰为 mechanical/thermal/electrical/magnetic/radiant/chemical', () => {
    expect(CORE_DOMAINS).toEqual(['mechanical', 'thermal', 'electrical', 'magnetic', 'radiant', 'chemical'])
  })
  it('WaveWorld 顶层形式正确映射到域', () => {
    expect(domainOf('electric')).toBe('electrical')
    expect(domainOf('thermal')).toBe('thermal')
    expect(domainOf('mechanical')).toBe('mechanical')
    expect(domainOf('chemical')).toBe('chemical')
    expect(domainOf('electromagnetic')).toBe('radiant')
    expect(domainOf('acoustic')).toBe('acoustic')
  })
  it('每个域都有共轭 (effort,flow) 端口变量（F2）', () => {
    for (const d of CORE_DOMAINS) {
      const v = DOMAIN_PORT_VARS[d]
      expect(v.effort.symbol).toBeTruthy()
      expect(v.flow.symbol).toBeTruthy()
      expect(v.powerExpr).toContain('=')
    }
  })
  it('域矩阵单元键与自环判定', () => {
    expect(domainCell('electric', 'thermal').key).toBe('electrical->thermal')
    expect(domainCell('electric', 'electric').self).toBe(true)
    expect(domainCell('electric', 'thermal').self).toBe(false)
  })
})

describe('F2 端口功率共轭', () => {
  it('port() 自动填入该域共轭变量', () => {
    const p = port('electrical', 'in')
    expect(p.effort.symbol).toBe('u')
    expect(p.flow.symbol).toBe('i')
    expect(p.direction).toBe('in')
  })
})

describe('F3 transformer/gyrator 两原语', () => {
  it('同域 → transformer', () => {
    expect(classifyPrimitive('electrical', 'electrical')).toBe('transformer')
    const s = primitiveSpec('electrical', 'electrical')
    expect(s.crossDomain).toBe(false)
  })
  it('跨域 → gyrator', () => {
    expect(classifyPrimitive('electrical', 'mechanical')).toBe('gyrator')
    const s = primitiveSpec('thermal', 'electrical')
    expect(s.primitive).toBe('gyrator')
    expect(s.crossDomain).toBe(true)
  })
})

describe('F4 Dirac 组合性', () => {
  it('同域 + 方向互补 → 端口匹配', () => {
    expect(portsCompatible(port('electrical', 'out'), port('electrical', 'in'))).toBe(true)
    expect(portsCompatible(port('electrical', 'out'), port('thermal', 'in'))).toBe(false)
    expect(portsCompatible(port('electrical', 'out'), port('electrical', 'out'))).toBe(false)
  })
  it('diracWired 检出断链点', () => {
    const ok = diracWired([[port('electrical', 'out'), port('electrical', 'in')]])
    expect(ok).toEqual({ wired: true, brokenAt: null })
    const bad = diracWired([[port('electrical', 'out'), port('thermal', 'in')]])
    expect(bad.wired).toBe(false)
    expect(bad.brokenAt).toBe(0)
  })
  it('composePH：两模块合法 + Dirac 互连 ⇒ 组合是 pH', () => {
    const r = composePH([true, true], { wired: true })
    expect(r.compositionIsPortHamiltonian).toBe(true)
    expect(composePH([true, false], { wired: true }).compositionIsPortHamiltonian).toBe(false)
    expect(composePH([true, true], { wired: false }).compositionIsPortHamiltonian).toBe(false)
  })
})

describe('F6 EPHS conditions', () => {
  it('热㶲因子随温度单调', () => {
    expect(conditionsThermalExergy({ T: 600 })).toBeGreaterThan(conditionsThermalExergy({ T: 400 }))
  })
  it('统一 η 上界：热→功 < 1，功→功 = 1', () => {
    expect(etaBoundUnder('thermal', 'electric')).toBeLessThan(1)
    expect(etaBoundUnder('electric', 'mechanical')).toBe(1)
  })
  it('热→电 上界退化为卡诺', () => {
    const eta = etaBoundUnder('thermal', 'electric', { T: 600 })
    expect(eta).toBeCloseTo(1 - 298.15 / 600, 6)
  })
  it('conditions 相容性：温度失配>2x 不相容', () => {
    expect(conditionsCompatible({ T: 300 }, { T: 400 }).compatible).toBe(true)
    expect(conditionsCompatible({ T: 300 }, { T: 900 }).compatible).toBe(false)
  })
})

describe('F7 SSN/SOSA 统一模块 + F8 ETP', () => {
  it('四 ETP 全有标签', () => {
    for (const e of ['C', 'D', 'M', 'P'] as const) expect(ETP_LABEL[e]).toBeTruthy()
  })
  it('parseETP 解析 ETP 序列', () => {
    expect(parseETP('M-D-D-C')).toEqual(['M', 'D', 'D', 'C'])
    expect(parseETP('PM')).toEqual(['P', 'M'])
  })
  it('edgeToModule 产出合法统一 Module', () => {
    const e = EDGES.find((x) => x.from !== x.to)!
    const m = edgeToModule(e)
    expect(m.role).toBeTruthy()
    expect(m.procedures[0].etp.length).toBeGreaterThan(0)
    expect(m.ports).toHaveLength(2)
    expect(m.ports[0].direction).toBe('in')
    expect(m.ports[1].direction).toBe('out')
    expect(m.componentRole).toBe('transducer')
    expect(m.sourceEdgeId).toBe(e.id)
  })
  it('inferRole：to=electric 的非 transport 边判为 generator/sensor', () => {
    const e = EDGES.find((x) => formOf(x.to) === 'electric' && x.kind !== 'transport')!
    const r = inferRole(e)
    expect(['generator', 'sensor']).toContain(r)
  })
  it('Landauer 地板量级正确', () => {
    expect(INFORMATION_THEORY.landauer300K_J)
      .toBeCloseTo(KB * 300 * Math.LN2, 12)
  })
})

describe('适配接地：全量边 → 模块 + 域矩阵覆盖', () => {
  it('每条边都能转成模块', () => {
    expect(MODULES.length).toBe(EDGES.length)
    for (const m of MODULES) {
      expect(m.ports.filter((p) => p.channel === 'energy')).toHaveLength(2)
      expect(m.primitive).toBeTruthy()
    }
  })
  it('六域 6×6 矩阵至少覆盖一部分，并报出缺口', () => {
    const cov = coreMatrixCoverage()
    expect(cov.total).toBe(36)
    expect(cov.filled).toBeGreaterThan(0)
    // magnetic 域 WaveWorld 未单列，含 magnetic 的单元预期大量缺失（已知缺口，不报错）
    expect(cov.missing.some((k) => k.startsWith('magnetic->'))).toBe(true)
  })
  it('domainMatrix 含经典电气→热单元', () => {
    const cells = domainMatrix()
    const keys = cells.map((c) => c.cell.key)
    expect(keys).toContain('electrical->thermal')
  })
})
