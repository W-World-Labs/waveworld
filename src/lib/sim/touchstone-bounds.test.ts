import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

const option = '# MHz S RI R 50\n'

describe('Touchstone parser admission bounds', () => {
  it('measures the 512 KiB limit in UTF-8 bytes, including multibyte comments', () => {
    const prefix = `${option}1 0 0\n!`
    const prefixBytes = new TextEncoder().encode(prefix).byteLength
    const comment = '界'.repeat((512 * 1024 - prefixBytes) / 3)
    const atLimit = `${prefix}${comment}`
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(512 * 1024)
    expect(parseTouchstone(atLimit, 'bounded.s1p').points).toHaveLength(1)
    expect(() => parseTouchstone(`${atLimit}界`, 'oversized.s1p')).toThrow(/512 KiB/i)
  })

  it('accepts exactly 4096 records and rejects the next complete record', () => {
    const records = Array.from({ length: 4096 }, (_, index) => `${index + 1} 0 0`).join('\n')
    expect(parseTouchstone(`${option}${records}`, 'limit.s1p').points).toHaveLength(4096)
    expect(() => parseTouchstone(`${option}${records}\n4097 0 0`, 'overflow.s1p')).toThrow(/4096/)
  })

  it('rejects extensions outside the supported one-to-eight-port range', () => {
    expect(parseTouchstone(`${option}1 0 0`, 'one.S1P').ports).toBe(1)
    expect(parseTouchstone(`${option}1 0 0 0 0 0 0 0 0`, 'two.s2p').ports).toBe(2)
    expect(() => parseTouchstone(`${option}1 0 0`, 'zero.s0p')).toThrow(/\.s1p.*\.s8p/i)
    expect(() => parseTouchstone(`${option}1 0 0`, 'nine.s9p')).toThrow(/\.s1p.*\.s8p/i)
    expect(() => parseTouchstone(`${option}1 0 0`, 'network.snp')).toThrow(/\.s1p.*\.s8p/i)
  })

  it('accepts the bounded eight-port endpoint with four-pair row continuations', () => {
    const fourPairs = '0 0 0 0 0 0 0 0'
    const firstRowStart = '1 0.2 0 0 0 0 0 0 0'
    const rows = [firstRowStart, fourPairs, ...Array(14).fill(fourPairs)].join('\n')
    const network = parseTouchstone(`# Hz S RI R 50\n${rows}`, 'max.s8p')

    expect(network.ports).toBe(8)
    expect(network.points).toHaveLength(1)
    expect(network.points[0].s).toHaveLength(64)
    expect(network.points[0].s[0]).toEqual([0.2, 0])
  })

  it('enforces the square matrix width for each multiport frequency record', () => {
    // A 3-port record is three physical matrix rows, each containing 3 pairs.
    const rowOne = '1 0 0 0 0 0'
    const rowTwo = '0 0 1 0 0 0'
    const rowThree = '0 0 0 1 0 0'
    const completeRows = `# MHz S RI R 50\n1 ${rowOne}\n${rowTwo}\n${rowThree}`
    expect(() => parseTouchstone(`# MHz S RI R 50\n1 ${rowOne}\n${rowTwo}`, 'short.s3p')).toThrow(/incomplete/i)
    expect(() => parseTouchstone(`${completeRows}\n2 ${rowOne}\n${rowTwo}`, 'short-frequency.s3p')).toThrow(/incomplete/i)
    // A flattened/column-major record has nine pairs on one line, not three row lines.
    expect(() => parseTouchstone(`# MHz S RI R 50\n1 ${Array(18).fill('0').join(' ')}`, 'flattened.s3p')).toThrow()
    // A full set of nine pairs with column-like row widths (2 + 4 + 3) is malformed.
    expect(() => parseTouchstone(`# MHz S RI R 50\n1 0 0 0 0\n${Array(8).fill('0').join(' ')}\n${Array(6).fill('0').join(' ')}`, 'wrong-row-order.s3p')).toThrow()
    // A 3-port row cannot contain a fourth pair.
    expect(() => parseTouchstone(`# MHz S RI R 50\n1 ${rowOne} 7 8`, 'wide-row.s3p')).toThrow()
    expect(() => parseTouchstone(`${option}1 0 0 0 0 0 0 0`, 'short.s2p')).toThrow(/incomplete/i)
  })

  it('rejects more than four network pairs on a Touchstone 1 data line', () => {
    // A 5-port matrix row has five pairs and must be split into 4 + 1 pair lines.
    const fivePairs = Array(10).fill('0').join(' ')
    expect(() => parseTouchstone(`# MHz S RI R 50\n1 ${fivePairs}`, 'too-many-pairs.s5p')).toThrow(/four|4|row|line/i)
  })

  it('rejects missing frequency starts and malformed continuation rows', () => {
    expect(() => parseTouchstone('# MHz S RI R 50\n0.1 0.2\n', 'continuation-only.s3p')).toThrow(/incomplete|frequency|row/i)
    expect(() => parseTouchstone('# MHz S RI R 50\n1 0 0 0 0\n0 0 0 0 0 0\n', 'partial-row.s5p')).toThrow(/incomplete|row/i)
  })

  it('rejects empty datasets and incomplete records', () => {
    expect(() => parseTouchstone(option, 'empty.s1p')).toThrow(/at least one/i)
    expect(() => parseTouchstone(`${option}1 0`, 'partial.s1p')).toThrow(/incomplete/i)
  })

  it('rejects a finite input frequency whose unit conversion overflows', () => {
    expect(() => parseTouchstone('# GHz S RI R 50\n1e308 0 0', 'overflow.s1p')).toThrow(/finite positive Hz/i)
    expect(parseTouchstone('# Hz S RI R 50\n1e300 0 0', 'large-finite.s1p').points[0].frequencyHz).toBe(1e300)
  })

  it('rejects non-ASCII numeric lookalikes and malformed numeric fields', () => {
    expect(() => parseTouchstone(`${option}１ 0 0`, 'unicode-digit.s1p')).toThrow(/decimal|number/i)
    expect(() => parseTouchstone(`${option}1\u00a00 0`, 'unicode-space.s1p')).toThrow(/decimal|number|ASCII/i)
    expect(() => parseTouchstone(`${option}1 0x0 0`, 'hex.s1p')).toThrow(/decimal|number/i)
    expect(() => parseTouchstone(`${option}1 0 0junk`, 'trailing.s1p')).toThrow(/decimal|number/i)
    expect(() => parseTouchstone(`${option}1 NaN 0`, 'nan.s1p')).toThrow(/decimal|number/i)
  })
})
