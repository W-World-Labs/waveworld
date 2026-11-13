import { describe, expect, it } from 'vitest'
import { methodById, methodsForSimPath } from '../data/methods/methods'
import {
  controlHintsForSim,
  familyMethods,
  sortMethodsForSim,
  stepMethods,
  toNarrativeCard,
} from './simMethodNarrative'

describe('simMethodNarrative — KUX 靶 F', () => {
  it('ripple / optics-lab 有挂接方法', () => {
    expect(methodsForSimPath('ripple').length).toBeGreaterThanOrEqual(3)
    expect(methodsForSimPath('optics-lab').length).toBeGreaterThanOrEqual(2)
  })

  it('旗舰与主 sim path 有控件→步骤提示', () => {
    expect(controlHintsForSim('ripple').length).toBeGreaterThan(0)
    expect(controlHintsForSim('optics-lab').some((h) => h.methodId.includes('snell') || h.methodId.includes('optics'))).toBe(true)
    const core = ['fdtd', 'md', 'rlc', 'laser', 'ising', 'fluid'] as const
    for (const p of core) {
      const hints = controlHintsForSim(p)
      expect(hints.length, p).toBeGreaterThanOrEqual(3)
      for (const h of hints) {
        expect(methodById(h.methodId), `${p} → ${h.methodId}`).toBeDefined()
      }
    }
    // 扩展叶子：至少 2 条且 methodId 可解析
    const more = [
      'ultrasound', 'phasedarray', 'stm', 'afm', 'tdoa', 'ai-chain',
      'faraday', 'mutual', 'eeg', 'ecg', 'windtunnel', 'display', 'radar',
      'matrix', 'paths', 'graph', 'phenomena', 'converter', 'transducers', 'apps',
      'controversies', 'methods', 'taxonomy', 'world', 'sensing',
    ] as const
    for (const p of more) {
      const hints = controlHintsForSim(p)
      expect(hints.length, p).toBeGreaterThanOrEqual(2)
      for (const h of hints) {
        expect(methodById(h.methodId), `${p} → ${h.methodId}`).toBeDefined()
      }
    }
    expect(controlHintsForSim('unknown-sim')).toEqual([])
  })

  it('知识页主入口均挂接方法且有叙事卡', () => {
    for (const p of [
      'matrix', 'paths', 'graph', 'converter', 'transducers', 'apps',
      'controversies', 'methods', 'taxonomy', 'world', 'sensing',
    ] as const) {
      const ms = methodsForSimPath(p)
      expect(ms.length, p).toBeGreaterThan(0)
      const card = toNarrativeCard(ms[0])
      expect(card.summary.length).toBeGreaterThan(4)
      expect(controlHintsForSim(p).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('叙事卡含人话四件套字段', () => {
    const m = methodsForSimPath('ripple')[0]
    const card = toNarrativeCard(m)
    expect(card.title.length).toBeGreaterThan(0)
    expect(card.summary.length).toBeGreaterThan(0)
    expect(card.foundations.length).toBeGreaterThan(0)
    expect(card.role.length).toBeGreaterThan(0)
  })

  it('族与步骤可拆分', () => {
    const ms = sortMethodsForSim(methodsForSimPath('ripple'))
    expect(familyMethods(ms).length).toBeGreaterThan(0)
    expect(stepMethods(ms).length).toBeGreaterThan(0)
  })
})
