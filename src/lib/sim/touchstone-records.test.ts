import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

describe('parseTouchstone record boundaries and strict input handling', () => {
  it('parses a complete one-port record with comments, blank lines, and CRLF', () => {
    const network = parseTouchstone(
      '\uFEFF! measured-like fixture\r\n\r\n# GHz S RI R 50 ! option\r\n\r\n1 0.25 -0.5 ! first point\r\n2 0.75 0.125\r\n',
      'fixture.S1P',
    )

    expect(network).toMatchObject({
      ports: 1,
      frequencyUnit: 'GHz',
      format: 'RI',
      referenceOhms: 50,
      points: [
        { frequencyHz: 1e9, s: [[0.25, -0.5]] },
        { frequencyHz: 2e9, s: [[0.75, 0.125]] },
      ],
    })
  })

  it('parses complete two-port records and keeps S11, S21, S12, S22 order', () => {
    const network = parseTouchstone(
      '# MHz S RI R 75\n10 1 2 3 4 5 6 7 8\n',
      'coupler.s2p',
    )

    expect(network.ports).toBe(2)
    expect(network.referenceOhms).toBe(75)
    expect(network.points).toEqual([
      {
        frequencyHz: 10e6,
        s: [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
        ],
      },
    ])
  })

  it('allows a record to continue across lines and blank/comment lines', () => {
    const network = parseTouchstone(
      '# Hz S RI R 50\n1 0.1\n! continuation follows\n\n0.2\n',
      'wrapped.s1p',
    )

    expect(network.points).toEqual([{ frequencyHz: 1, s: [[0.1, 0.2]] }])
  })

  it('rejects extra fields and incomplete dangling records', () => {
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0 0 9\n', 'too-many.s1p')).toThrow()
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0\n', 'dangling.s1p')).toThrow(/incomplete/)
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0 0 2 0\n', 'dangling.s2p')).toThrow(/incomplete/)
  })

  it('rejects duplicate options and duplicate, decreasing, or nonpositive frequencies', () => {
    expect(() => parseTouchstone('# Hz S RI R 50\n# Hz S RI R 50\n1 0 0\n', 'duplicate-option.s1p')).toThrow(/Duplicate/)
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0 0\n1 1 1\n', 'duplicate-frequency.s1p')).toThrow(/increasing/)
    expect(() => parseTouchstone('# Hz S RI R 50\n2 0 0\n1 1 1\n', 'decreasing-frequency.s1p')).toThrow(/increasing/)
    expect(() => parseTouchstone('# Hz S RI R 50\n0 0 0\n', 'zero-frequency.s1p')).toThrow(/positive/)
    expect(() => parseTouchstone('# Hz S RI R 50\n-1 0 0\n', 'negative-frequency.s1p')).toThrow(/positive/)
  })

  it('rejects trailing noise, later data blocks, and extension/port mismatches', () => {
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0 0\nEND\n', 'trailing.s1p')).toThrow()
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0 0\n[Network Data]\n', 'data-block.s1p')).toThrow()
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0 0\n', 'network.s3p')).toThrow(/3-port matrix rows/)
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0 0\n', 'network.snp')).toThrow(/\.s1p through \.s8p/)
  })
})
