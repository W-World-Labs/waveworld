import { describe, expect, it } from 'vitest'
import { parseAbaqusMaterialCard } from './abaqus-material-card'

const CARD = `** standalone isotropic material
*Material, name=Steel-1018
*Elastic
210000, 0.3
*Plastic
250, 0.
320, .02
`

describe('bounded Abaqus material card reader', () => {
  it('parses one named isotropic elastic law and plastic hardening table', () => {
    expect(parseAbaqusMaterialCard(CARD)).toEqual({
      name: 'Steel-1018',
      E: 210000,
      nu: 0.3,
      hardeningCurve: [[250, 0], [320, 0.02]],
    })
  })

  it('accepts case-insensitive keywords and Abaqus D exponents', () => {
    expect(parseAbaqusMaterialCard(`*material, name=Steel\n*elastic\n2.1D5,3.0D-1\n*plastic\n2.5D2,0.`)).toMatchObject({
      E: 210000,
      nu: 0.3,
      hardeningCurve: [[250, 0]],
    })
  })

  it('rejects a full deck keyword, extra card options, and additional materials', () => {
    expect(() => parseAbaqusMaterialCard(CARD.replace('*Plastic', '*Density\n7.8\n*Plastic'))).toThrow(/unsupported keyword \*DENSITY/)
    expect(() => parseAbaqusMaterialCard(CARD.replace('*Elastic', '*Elastic, type=ENGINEERING CONSTANTS'))).toThrow(/only TYPE=ISOTROPIC/)
    expect(() => parseAbaqusMaterialCard(CARD.replace('*Elastic', '*Material, name=Second\n*Elastic'))).toThrow(/exactly one/)
  })

  it('rejects malformed and nonphysical elastic values', () => {
    for (const invalid of [
      CARD.replace('210000, 0.3', '210000'),
      CARD.replace('210000, 0.3', '0, 0.3'),
      CARD.replace('210000, 0.3', '210000, 0.5'),
      CARD.replace('210000, 0.3', '210000, NaN'),
    ]) expect(() => parseAbaqusMaterialCard(invalid)).toThrow()
  })

  it('requires the plastic table to begin at zero and rise monotonically', () => {
    for (const invalid of [
      CARD.replace('250, 0.', '250, 0.001'),
      CARD.replace('320, .02', '240, .02'),
      CARD.replace('320, .02', '320, 0.'),
      CARD.replace('320, .02', '320, -0.02'),
      CARD.replace('320, .02', '320, .02, 300'),
    ]) expect(() => parseAbaqusMaterialCard(invalid)).toThrow()
  })

  it('enforces source and table bounds', () => {
    expect(() => parseAbaqusMaterialCard('x'.repeat(256_001))).toThrow(/character limit/)
    const rows = Array.from({ length: 10_001 }, (_, index) => `${250 + index}, ${index === 0 ? 0 : index / 1000}`).join('\n')
    expect(() => parseAbaqusMaterialCard(`*Material, name=A\n*Elastic\n1000, .25\n*Plastic\n${rows}`)).toThrow(/10000 rows/)
  })
})
