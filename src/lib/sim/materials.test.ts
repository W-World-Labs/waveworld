// src/lib/sim/materials.test.ts
import { describe, it, expect } from 'vitest'
import { MATERIALS, findMaterial, materialScale, KB_KJ_PER_MOL_K } from './materials'

describe('materials: 真实材料库', () => {
  it('加载到 21 个材料、含氩', () => {
    expect(MATERIALS.length).toBeGreaterThanOrEqual(20)
    const ar = findMaterial('氩')
    expect(ar).toBeTruthy()
    expect(ar!.sigma_nm).toBeCloseTo(0.3405, 6)
    expect(ar!.mass_amu).toBeCloseTo(39.948, 4)
  })
  it('每个材料带非空 forcefield/source 引证', () => {
    for (const m of MATERIALS) {
      expect(m.forcefield.length).toBeGreaterThan(0)
      expect(m.source.length).toBeGreaterThan(0)
      expect(['quantitative', 'qualitative']).toContain(m.fidelity)
    }
  })
  it('ε[kJ/mol] 与 ε/k_B[K] k_B 自洽（有 ε 的条目）', () => {
    for (const m of MATERIALS) {
      if (m.epsilon_kJmol > 0 && m.epsilon_over_kB_K > 0) {
        expect(m.epsilon_kJmol).toBeCloseTo(m.epsilon_over_kB_K * KB_KJ_PER_MOL_K, 2)
      }
    }
  })
  it('materialScale 把材料转成 LJ 标度', () => {
    const s = materialScale(findMaterial('氩')!)
    expect(s.tau_ps).toBeGreaterThan(2.0)
  })

  it('nameEn overlay covers common materials without CJK', () => {
    const ar = findMaterial('氩')!
    expect(ar.nameEn).toMatch(/Argon/i)
    expect(ar.nameEn).not.toMatch(/[\u4e00-\u9fff]/)
    expect(ar.categoryLabelEn).toMatch(/Noble|LJ/i)
  })

  it('forcefieldEn overlay covers all materials without CJK', () => {
    for (const m of MATERIALS) {
      expect(m.forcefieldEn, m.name).toBeTruthy()
      expect(m.forcefieldEn!, m.name).not.toMatch(/[\u4e00-\u9fff]/)
    }
    const ar = findMaterial('氩')!
    expect(ar.forcefieldEn).toMatch(/Lennard/i)
  })

  it('notesEn overlay covers materials that have Chinese notes', () => {
    const withNotes = MATERIALS.filter((m) => m.notes)
    expect(withNotes.length).toBeGreaterThan(10)
    for (const m of withNotes) {
      expect(m.notesEn, m.name).toBeTruthy()
      expect(m.notesEn!, m.name).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })
})
