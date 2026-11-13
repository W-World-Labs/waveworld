import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

describe('Touchstone 1.0 scalar formats', () => {
  it('parses RI values as real and imaginary components', () => {
    const network = parseTouchstone(
      '# Hz S RI R 50\n1 0.25 -0.5\n',
      'sample.s1p',
    )

    expect(network.points).toEqual([
      { frequencyHz: 1, s: [[0.25, -0.5]] },
    ])
  })

  it('converts MA magnitudes and degree angles to complex pairs', () => {
    const network = parseTouchstone(
      '# Hz S MA R 50\n1 2 90\n2 0.5 -180\n',
      'sample.s1p',
    )

    expect(network.points[0].s[0][0]).toBeCloseTo(0, 14)
    expect(network.points[0].s[0][1]).toBeCloseTo(2, 14)
    expect(network.points[1].s[0][0]).toBeCloseTo(-0.5, 14)
    expect(network.points[1].s[0][1]).toBeCloseTo(0, 14)
  })

  it('converts DB values and degree angles to complex pairs', () => {
    const network = parseTouchstone(
      '# Hz S DB R 50\n1 20 90\n2 -20 -90\n',
      'sample.s1p',
    )

    expect(network.points[0].s[0][0]).toBeCloseTo(0, 12)
    expect(network.points[0].s[0][1]).toBeCloseTo(10, 12)
    expect(network.points[1].s[0][0]).toBeCloseTo(0, 12)
    expect(network.points[1].s[0][1]).toBeCloseTo(-0.1, 12)
  })

  it('uses standard 2-port data order S11, S21, S12, S22', () => {
    const network = parseTouchstone(
      '# MHz S RI R 50\n1 11 0 21 0 12 0 22 0\n2 31 1 41 2 32 3 42 4\n',
      'sample.s2p',
    )

    expect(network.points).toEqual([
      { frequencyHz: 1e6, s: [[11, 0], [21, 0], [12, 0], [22, 0]] },
      { frequencyHz: 2e6, s: [[31, 1], [41, 2], [32, 3], [42, 4]] },
    ])
  })

  it('preserves both one-port complex pairs and frequency point ordering', () => {
    const network = parseTouchstone(
      '# Hz S RI R 50\n1 11 1\n2 22 2\n',
      'ordered.s1p',
    )

    expect(network.points).toEqual([
      { frequencyHz: 1, s: [[11, 1]] },
      { frequencyHz: 2, s: [[22, 2]] },
    ])
  })

  it('parses 3-port RI data in Touchstone 1 row-wise order', () => {
    const network = parseTouchstone(
      '! Three-port fixture: values identify their row and column.\n' +
        '# MHz S RI R 50\n' +
        '! Rows are S11, S12, S13; S21, S22, S23; S31, S32, S33.\n' +
        '1 11 1 12 2 13 3  ! first matrix row\n' +
        '21 4 22 5 23 6\n' +
        '31 7 32 8 33 9\n' +
        '2 41 11 42 12 43 13\n' +
        '51 14 52 15 53 16\n' +
        '61 17 62 18 63 19\n',
      'matrix.s3p',
    )

    expect(network.ports).toBe(3)
    expect(network.points[0]).toEqual({
      frequencyHz: 1e6,
      s: [
        [11, 1], [12, 2], [13, 3],
        [21, 4], [22, 5], [23, 6],
        [31, 7], [32, 8], [33, 9],
      ],
    })
    expect(network.points[1]).toEqual({
      frequencyHz: 2e6,
      s: [
        [41, 11], [42, 12], [43, 13],
        [51, 14], [52, 15], [53, 16],
        [61, 17], [62, 18], [63, 19],
      ],
    })
    // The VSWR flow reads S11 from the first complex pair in the flattened matrix.
    expect(network.points[0].s[0]).toEqual([11, 1])
  })

  it('preserves every four-port matrix pair in row-wise order across points', () => {
    const network = parseTouchstone(
      '# GHz S RI R 50\n' +
        '1 11 1 12 2 13 3 14 4\n' +
        '21 5 22 6 23 7 24 8\n' +
        '31 9 32 10 33 11 34 12\n' +
        '41 13 42 14 43 15 44 16\n' +
        '2 51 17 52 18 53 19 54 20\n' +
        '61 21 62 22 63 23 64 24\n' +
        '71 25 72 26 73 27 74 28\n' +
        '81 29 82 30 83 31 84 32\n',
      'matrix.s4p',
    )

    expect(network.points).toEqual([
      { frequencyHz: 1e9, s: [[11, 1], [12, 2], [13, 3], [14, 4], [21, 5], [22, 6], [23, 7], [24, 8], [31, 9], [32, 10], [33, 11], [34, 12], [41, 13], [42, 14], [43, 15], [44, 16]] },
      { frequencyHz: 2e9, s: [[51, 17], [52, 18], [53, 19], [54, 20], [61, 21], [62, 22], [63, 23], [64, 24], [71, 25], [72, 26], [73, 27], [74, 28], [81, 29], [82, 30], [83, 31], [84, 32]] },
    ])
  })

  it.each([5, 6, 7, 8])('accepts the .s%dp import extension and complete matrix', (ports) => {
    const pairs = Array.from({ length: ports * ports }, (_, index) => `${index + 1} 0`)
    const rows = Array.from({ length: ports }, (_, row) => {
      const rowPairs = pairs.slice(row * ports, (row + 1) * ports)
      const lines = []
      for (let offset = 0; offset < rowPairs.length; offset += 4) {
        lines.push(rowPairs.slice(offset, offset + 4).join(' '))
      }
      return lines.join('\n')
    }).join('\n')
    const network = parseTouchstone(`# Hz S RI R 50\n1 ${rows}`, `import.s${ports}p`)

    expect(network.ports).toBe(ports)
    expect(network.points).toEqual([{
      frequencyHz: 1,
      s: pairs.map((_, index) => [index + 1, 0]),
    }])
  })

  it('parses 5-port MA data with each matrix row wrapped after four pairs', () => {
    const network = parseTouchstone(
      '! Five-port fixture; each pair is magnitude, angle in degrees.\n' +
        '# Hz S MA R 50\n' +
        '1 1 0 2 0 3 0 4 0  ! row 1, first four pairs\n' +
        '5 0\n' +
        '6 0 7 0 8 0 9 0\n' +
        '10 0\n' +
        '11 0 12 0 13 0 14 0\n' +
        '15 0\n' +
        '16 0 17 0 18 0 19 0\n' +
        '20 0\n' +
        '21 0 22 0 23 0 24 0\n' +
        '25 90\n',
      'wrapped.s5p',
    )

    expect(network.ports).toBe(5)
    expect(network.points[0].s).toHaveLength(25)
    expect(network.points[0].s.slice(0, 5)).toEqual([
      [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
    ])
    expect(network.points[0].s[5]).toEqual([6, 0])
    expect(network.points[0].s[24][0]).toBeCloseTo(0, 14)
    expect(network.points[0].s[24][1]).toBeCloseTo(25, 14)
    expect(network.points[0].s[0]).toEqual([1, 0])
  })

  it('parses 3-port DB magnitudes and angles while retaining the first pair as S11', () => {
    const network = parseTouchstone(
      '! 3-port DB fixture with a unique imaginary S11 value.\n' +
        '# GHz S DB R 50\n' +
        '1 0 90 6 0 12 0\n' +
        '18 0 24 0 30 0\n' +
        '36 0 42 0 48 0\n',
      'db-matrix.s3p',
    )

    expect(network.ports).toBe(3)
    expect(network.points[0].s).toHaveLength(9)
    expect(network.points[0].s[0][0]).toBeCloseTo(0, 14)
    expect(network.points[0].s[0][1]).toBeCloseTo(1, 14)
    expect(network.points[0].s[1][0]).toBeCloseTo(10 ** (6 / 20), 14)
    expect(network.points[0].s[1][1]).toBeCloseTo(0, 14)
  })

  it.each([
    ['Hz', 1],
    ['kHz', 1e3],
    ['MHz', 1e6],
    ['GHz', 1e9],
  ] as const)('converts %s frequencies to Hz', (unit, multiplier) => {
    const network = parseTouchstone(
      `# ${unit} S RI R 50\n2.5 0 0\n`,
      'sample.s1p',
    )

    expect(network.frequencyUnit).toBe(unit)
    expect(network.points[0].frequencyHz).toBe(2.5 * multiplier)
  })

  it('matches simple complex analytic goldens from the common 2-port fixture', () => {
    const network = parseTouchstone(
      '! simple measured-like test fixture (not vendor data)\n' +
        '# GHz S RI R 50\n' +
        '1 0 0 0.8 0 0.8 0 0.1 0\n' +
        '2 0.2 0 0.7 0 0.7 0 0.1 0\n' +
        '3 0 0.5 0.6 0 0.6 0 0.1 0\n',
      'simple-golden.s2p',
    )

    expect(network.points.map((point) => point.frequencyHz)).toEqual([
      1e9,
      2e9,
      3e9,
    ])
    expect(network.points.map((point) => point.s[0])).toEqual([
      [0, 0],
      [0.2, 0],
      [0, 0.5],
    ])
    expect(network.points.map((point) => point.s[1])).toEqual([
      [0.8, 0],
      [0.7, 0],
      [0.6, 0],
    ])
    expect(network.points.map((point) => point.s[2])).toEqual([
      [0.8, 0],
      [0.7, 0],
      [0.6, 0],
    ])
    expect(network.points.map((point) => point.s[3])).toEqual([
      [0.1, 0],
      [0.1, 0],
      [0.1, 0],
    ])
  })

  it.each([
    ['malformed numeric token', '# Hz S RI R 50\n1 1junk 0\n'],
    ['negative MA magnitude', '# Hz S MA R 50\n1 -0.1 45\n'],
    ['non-finite numeric overflow', '# Hz S RI R 50\n1 1e309 0\n'],
    ['non-finite DB conversion overflow', '# Hz S DB R 50\n1 1e308 0\n'],
  ])('rejects %s', (_case, text) => {
    expect(() => parseTouchstone(text, 'bad.s1p')).toThrow()
  })
})
