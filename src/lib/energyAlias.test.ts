import { describe, expect, it } from 'vitest'
import {
  CONVERSIONS_TO_ONTOLOGY,
  energyDisplayName,
  sameEnergyForm,
  toConversionsId,
  toOntologyId,
} from './energyAlias'

describe('energyAlias — KUX 靶 A 双轨对照', () => {
  it('electrical ↔ electric 显式对照且不合并为同一字符串', () => {
    expect(CONVERSIONS_TO_ONTOLOGY.electrical).toBe('electric')
    expect(toOntologyId('electrical')).toBe('electric')
    expect(toConversionsId('electric')).toBe('electrical')
    expect('electrical').not.toBe('electric')
  })

  it('两端展示名均为「电能」', () => {
    expect(energyDisplayName('electrical')).toBe('电能')
    expect(energyDisplayName('electric')).toBe('电能')
  })

  it('en locale uses nameEn for ontology nodes', () => {
    expect(energyDisplayName('electric', 'en')).toMatch(/Electrical/i)
    expect(energyDisplayName('electrical', 'en')).toMatch(/Electrical/i)
    expect(energyDisplayName('em-visible', 'en')).toMatch(/Visible/i)
    expect(energyDisplayName('mechanical-kinetic', 'en')).toMatch(/Kinetic/i)
  })

  it('同名大类 id 自映射', () => {
    expect(toOntologyId('thermal')).toBe('thermal')
    expect(energyDisplayName('thermal')).toBe('热能')
    expect(energyDisplayName('electromagnetic')).toMatch(/电磁/)
  })

  it('sameEnergyForm 跨轨为真', () => {
    expect(sameEnergyForm('electrical', 'electric')).toBe(true)
    expect(sameEnergyForm('thermal', 'thermal')).toBe(true)
    expect(sameEnergyForm('thermal', 'chemical')).toBe(false)
  })

  it('未知 id 不把 raw id 当主文案', () => {
    expect(energyDisplayName('totally-unknown-xyz')).toBe('未命名能量形式')
    expect(energyDisplayName('totally-unknown-xyz', 'en')).toBe('Unnamed energy form')
    expect(energyDisplayName('totally-unknown-xyz')).not.toBe('totally-unknown-xyz')
  })

  it('子形态走本体名', () => {
    expect(energyDisplayName('em-visible')).toMatch(/可见/)
  })
})

describe('energy subtypes EN overlay', () => {
  it('merges nameEn/descriptionEn/examplesEn without CJK', async () => {
    const { energyType } = await import('../data/conversions')
    const em = energyType('electromagnetic')
    expect(em?.subtypes?.solar?.nameEn).toMatch(/Solar/i)
    expect(em?.subtypes?.solar?.nameEn).not.toMatch(/[\u4e00-\u9fff]/)
    expect(em?.subtypes?.solar?.descriptionEn).toBeTruthy()
    expect(em?.subtypes?.solar?.examplesEn?.length).toBe(
      em?.subtypes?.solar?.examples?.length,
    )
    for (const ex of em?.subtypes?.solar?.examplesEn ?? []) {
      expect(ex).not.toMatch(/[\u4e00-\u9fff]/)
    }
    // Chinese source untouched
    expect(em?.subtypes?.solar?.name).toMatch(/太阳/)
  })

  it('covers all subtype keys with EN overlays', async () => {
    const { ENERGY_KEYS, energyType } = await import('../data/conversions')
    for (const k of ENERGY_KEYS) {
      const et = energyType(k)
      for (const [sk, st] of Object.entries(et?.subtypes ?? {})) {
        expect(st.nameEn, `${k}/${sk}`).toBeTruthy()
        expect(st.nameEn!, `${k}/${sk}`).not.toMatch(/[\u4e00-\u9fff]/)
        expect(st.descriptionEn, `${k}/${sk}`).toBeTruthy()
        expect(st.descriptionEn!, `${k}/${sk}`).not.toMatch(/[\u4e00-\u9fff]/)
      }
    }
  })
})
