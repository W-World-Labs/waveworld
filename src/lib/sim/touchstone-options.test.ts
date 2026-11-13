import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

const onePort = (option: string, data = '1 0.25 -0.5') => `${option}\n${data}`

describe('Touchstone option-line acceptance', () => {
  it('accepts exactly one complete option line with category order varied, case ignored, comments, CRLF, and a leading BOM', () => {
    const text = '\uFEFF! measured-like fixture\r\n# s ri ghz r 50 ! explicit reference\r\n1 0.25 -0.5\r\n'
    const network = parseTouchstone(text, 'fixture.S1P')

    expect(network).toMatchObject({
      ports: 1,
      frequencyUnit: 'GHz',
      format: 'RI',
      referenceOhms: 50,
      points: [{ frequencyHz: 1e9, s: [[0.25, -0.5]] }],
    })
  })

  it('accepts another ordering of the explicit option categories', () => {
    const network = parseTouchstone(onePort('# R 75 MA MHz S', '2 0.5 90'), 'ordered.s1p')
    expect(network).toMatchObject({
      frequencyUnit: 'MHz',
      format: 'MA',
      referenceOhms: 75,
    })
    expect(network.points[0]?.frequencyHz).toBe(2e6)
    expect(network.points[0]?.s[0]?.[0]).toBeCloseTo(0)
    expect(network.points[0]?.s[0]?.[1]).toBeCloseTo(0.5)
  })

  it('requires one explicit option line and rejects incomplete or unknown option tokens', () => {
    for (const input of [
      '1 0.1 0',
      '# GHz S RI\n1 0.1 0',
      '# GHz S RI R 50 EXTRA\n1 0.1 0',
      '# GHz S RI R 50 EXTRA 1\n1 0.1 0',
      '# GHz S RI R\n1 0.1 0',
    ]) {
      expect(() => parseTouchstone(input, 'missing.s1p')).toThrow()
    }
  })

  it('requires a positive finite explicit R reference', () => {
    for (const reference of ['0', '-50', 'NaN', 'Infinity', '1e999', 'junk']) {
      expect(() => parseTouchstone(onePort(`# Hz S RI R ${reference}`), 'reference.s1p')).toThrow()
    }
    expect(parseTouchstone(onePort('# Hz S RI R 50'), 'reference.s1p').referenceOhms).toBe(50)
  })

  it('rejects duplicate and late option lines', () => {
    expect(() => parseTouchstone('# Hz S RI R 50\n# GHz S MA R 75\n1 0.1 0', 'duplicate.s1p')).toThrow(/duplicate/i)
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0.1 0\n# GHz S MA R 75', 'late.s1p')).toThrow(/before data|late/i)
  })

  it('rejects Touchstone 2 keywords and noise records', () => {
    for (const text of [
      '# Hz S RI R 50\n[Version] 2.0\n1 0.1 0',
      '# Hz S RI R 50\n[Noise Data]\n1 0.1 0',
      '# Hz S RI R 50\n1 0.1 0\n1 0.2 0 0.3 0',
    ]) {
      expect(() => parseTouchstone(text, 'keyword.s1p')).toThrow()
    }
  })

  it('rejects unsupported parameter families and per-port references', () => {
    for (const parameter of ['Y', 'Z', 'G', 'H']) {
      expect(() => parseTouchstone(`# Hz ${parameter} RI R 50\n1 0.1 0`, 'parameter.s1p')).toThrow()
    }
    expect(() => parseTouchstone('# Hz S RI R 50 75\n1 0.1 0', 'per-port-reference.s1p')).toThrow()
  })
})
