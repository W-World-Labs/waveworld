import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

const s1p = readFileSync(
  new URL('../../../public/datasets/touchstone-example.s1p', import.meta.url),
  'utf8',
)
const s2p = readFileSync(
  new URL('../../../public/datasets/touchstone-example.s2p', import.meta.url),
  'utf8',
)

describe('bundled Touchstone examples', () => {
  it('parses the one-port MA example and converts MHz to Hz', () => {
    const network = parseTouchstone(s1p, 'touchstone-example.s1p')

    expect(network.ports).toBe(1)
    expect(network.format).toBe('MA')
    expect(network.frequencyUnit).toBe('MHz')
    expect(network.referenceOhms).toBe(50)
    expect(network.points.map(({ frequencyHz }) => frequencyHz)).toEqual([
      100e6,
      200e6,
      300e6,
    ])
    expect(network.points[0]?.s).toEqual([[0, 0]])
    expect(network.points[1]?.s[0]?.[0]).toBeCloseTo(Math.SQRT1_2 * 0.25)
    expect(network.points[1]?.s[0]?.[1]).toBeCloseTo(-Math.SQRT1_2 * 0.25)
    expect(network.points[2]?.s[0]?.[0]).toBeCloseTo(0)
    expect(network.points[2]?.s[0]?.[1]).toBeCloseTo(0.5)
  })

  it('parses the two-port RI example in standard S11, S21, S12, S22 order', () => {
    const network = parseTouchstone(s2p, 'touchstone-example.s2p')

    expect(network.ports).toBe(2)
    expect(network.format).toBe('RI')
    expect(network.frequencyUnit).toBe('GHz')
    expect(network.referenceOhms).toBe(50)
    expect(network.points.map(({ frequencyHz }) => frequencyHz)).toEqual([
      1e9,
      2e9,
      3e9,
    ])
    expect(network.points.map(({ s }) => s)).toEqual([
      [[0, 0], [0.8, 0], [0.8, 0], [0.1, 0]],
      [[0.2, 0], [0.7, 0], [0.7, 0], [0.1, 0]],
      [[0, 0.5], [0.6, 0], [0.6, 0], [0.1, 0]],
    ])
  })
})
