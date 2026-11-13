import { describe, expect, it } from 'vitest'
import { getTerm, TERM_GLOSSARY, termTitle, termIdsForSimPath } from './termGlossary'

describe('termGlossary — KUX 靶 D', () => {
  it('核心术语齐全且人话非空', () => {
    const need = [
      'exergy', 'phi', 'cop', 'pue', 'eta', 'transport',
      'cfl', 'zt', 'snr', 'fill-factor', 'quantum-yield', 'wall-plug',
    ] as const
    for (const id of need) {
      const t = getTerm(id)
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.plainZh.length).toBeGreaterThan(8)
      expect(t.labelEn?.length).toBeGreaterThan(0)
      expect(t.plainEn?.length).toBeGreaterThan(8)
    }
  })

  it('termTitle 含 plainZh / plainEn', () => {
    expect(termTitle('cop')).toMatch(/大于 1|性能系数/)
    expect(termTitle('exergy')).toMatch(/可用功|㶲/)
    expect(termTitle('cfl')).toMatch(/时间步|数值爆炸|CFL|网格/)
    expect(termTitle('zt')).toMatch(/热电|ZT|塞贝克/)
    expect(termTitle('cop', 'en')).toMatch(/COP|Coefficient|ambient/i)
    expect(termTitle('exergy', 'en')).toMatch(/exergy|useful work/i)
    expect(termTitle('cfl', 'en')).toMatch(/CFL|time step|grid/i)
  })

  it('字典键稳定（防静默丢词条）', () => {
    expect(Object.keys(TERM_GLOSSARY).length).toBeGreaterThanOrEqual(16)
  })

  it('termIdsForSimPath 按页挂术语', () => {
    expect(termIdsForSimPath('fdtd')).toContain('cfl')
    expect(termIdsForSimPath('emwave3d')).toContain('cfl')
    expect(termIdsForSimPath('ai-chain')).toContain('pue')
    expect(termIdsForSimPath('laser')).toContain('wall-plug')
    expect(termIdsForSimPath('matrix')).toContain('exergy')
    expect(termIdsForSimPath('converter')).toEqual(
      expect.arrayContaining(['eta', 'cop', 'exergy', 'transport']),
    )
    expect(termIdsForSimPath('transducers')).toContain('cop')
    expect(termIdsForSimPath('graph')).toContain('exergy')
    expect(termIdsForSimPath('sensing')).toContain('eta')
    expect(termIdsForSimPath('apps')).toContain('cop')
    expect(termIdsForSimPath('controversies')).toContain('second-law')
    expect(termIdsForSimPath('taxonomy')).toContain('conversion')
    expect(termIdsForSimPath('methods')).toContain('exergy')
    expect(termIdsForSimPath('phenomena')).toContain('eta')
    expect(termIdsForSimPath('world')).toContain('second-law')
    expect(termIdsForSimPath('fluid')).toContain('cfl')
    expect(termIdsForSimPath('fluid')).not.toContain('carnot-limit')
    expect(termIdsForSimPath('windtunnel')).toContain('cfl')
    expect(termIdsForSimPath('rlc')).toContain('energy-ledger')
    expect(termIdsForSimPath('stm')).toContain('snr')
    expect(termIdsForSimPath('world')).toContain('conversion')
    expect(termIdsForSimPath('unknown-xyz').length).toBeGreaterThan(0)
    // 已知主叶子不落到「仅默认」
    for (const p of ['fdtd', 'md', 'fluid', 'rlc', 'paths', 'display', 'radar', 'ultrasound'] as const) {
      const ids = termIdsForSimPath(p)
      expect(ids.length).toBeGreaterThanOrEqual(2)
      expect(ids).not.toEqual(['eta', 'exergy'])
    }
  })
})
