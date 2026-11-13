import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

// Synthetic non-vendor oracle: values encode matrix position so ordering is visible.
const twoPortV2 = (dataOrder = '21_12') =>
  `[Version] 2.0\n` +
  `# MHz S RI R 50\n` +
  `[Number of Ports] 2\n` +
  `[Two-Port Data Order] ${dataOrder}\n` +
  `[Number of Frequencies] 1\n` +
  `[Reference] 50 50\n` +
  `[Network Data]\n` +
  `1 11 0 21 0 12 0 22 0\n` +
  `[End]\n`

describe('bounded Touchstone 2.0 keyword subset', () => {
  it('parses the explicit v2 envelope, counts, common real reference, and required legacy two-port order', () => {
    const network = parseTouchstone(twoPortV2(), 'synthetic.s2p')

    expect(network).toMatchObject({
      ports: 2,
      frequencyUnit: 'MHz',
      format: 'RI',
      referenceOhms: 50,
      points: [{
        frequencyHz: 1e6,
        s: [[11, 0], [21, 0], [12, 0], [22, 0]],
      }],
    })
  })

  it('honors [Two-Port Data Order] 12_21 while preserving the existing network representation', () => {
    const network = parseTouchstone(twoPortV2('12_21'), 'synthetic.s2p')

    expect(network.points[0].s).toEqual([
      [11, 0], [12, 0], [21, 0], [22, 0],
    ])
  })

  it('retains nonuniform positive [Reference] values in port order and keeps port 1 as the scalar reference', () => {
    const network = parseTouchstone(
      twoPortV2().replace('[Reference] 50 50', '[Reference] 40.5 75.25'),
      'synthetic.s2p',
    )

    expect(network.referenceOhms).toBe(40.5)
    expect(network.referenceImpedancesOhms).toEqual([40.5, 75.25])
  })

  it('keeps equal per-port references compatible with the common-reference representation', () => {
    const network = parseTouchstone(
      twoPortV2().replace('[Reference] 50 50', '[Reference] 62.5 62.5'),
      'synthetic.s2p',
    )

    expect(network.referenceOhms).toBe(62.5)
    expect(network.referenceImpedancesOhms).toEqual([62.5, 62.5])
    expect(parseTouchstone(twoPortV2(), 'synthetic.s2p').referenceOhms).toBe(50)
  })

  it('rejects invalid [Reference] vector values and lengths', () => {
    const valid = twoPortV2()
    for (const reference of [
      '[Reference] 0 50',
      '[Reference] -1 50',
      '[Reference] NaN 50',
      '[Reference] Infinity 50',
      '[Reference] 1e999 50',
      '[Reference] 50',
      '[Reference] 40 50 75',
      '[Reference]',
    ]) {
      const text = valid.replace('[Reference] 50 50', reference)
      expect(() => parseTouchstone(text, 'synthetic.s2p')).toThrow()
    }
  })

  it('accepts the supported port range and requires the declared count to match the extension', () => {
    for (const ports of [1, 3, 8]) {
      const entries = Array.from({ length: ports * ports }, (_, index) => `${index + 1} 0`)
      const matrixRows = Array.from({ length: ports }, (_, rowIndex) => {
        const values = entries.slice(rowIndex * ports, (rowIndex + 1) * ports)
        const wrapped = ports >= 5
          ? Array.from({ length: Math.ceil(ports / 4) }, (_, chunk) => values.slice(chunk * 4, chunk * 4 + 4).join(' ')).join('\n')
          : values.join(' ')
        return `${rowIndex === 0 ? '1 ' : ''}${wrapped}`
      }).join('\n')
      const text =
        `[Version] 2.0\n# Hz S RI R 50\n[Number of Ports] ${ports}\n` +
        `[Number of Frequencies] 1\n[Network Data]\n${matrixRows}\n[End]\n`
      const network = parseTouchstone(text, `synthetic.s${ports}p`)
      expect(network.ports).toBe(ports)
      expect(network.points[0].s).toHaveLength(ports * ports)
    }

    expect(() => parseTouchstone(twoPortV2(), 'mismatch.s3p')).toThrow()
    expect(() => parseTouchstone(twoPortV2(), 'unsupported.s9p')).toThrow()
  })

  it('parses a multiport full matrix in row-major order', () => {
    const network = parseTouchstone(
      `[Version] 2.0\n# GHz S RI R 50\n` +
        `[Number of Ports] 3\n[Number of Frequencies] 1\n` +
        `[Network Data]\n1 11 0 12 0 13 0\n21 0 22 0 23 0\n31 0 32 0 33 0\n[End]\n`,
      'synthetic.s3p',
    )

    expect(network.points[0]).toEqual({
      frequencyHz: 1e9,
      s: [[11, 0], [12, 0], [13, 0], [21, 0], [22, 0], [23, 0], [31, 0], [32, 0], [33, 0]],
    })
  })

  it('rejects missing, duplicate, reordered, or inconsistent structural keywords', () => {
    const valid = twoPortV2()
    const invalid = [
      valid.replace('[Version] 2.0\n', ''),
      valid.replace('[Number of Ports] 2\n', ''),
      valid.replace('[Number of Frequencies] 1\n', ''),
      valid.replace('[Network Data]\n', ''),
      valid.replace('[End]\n', ''),
      valid.replace('[Number of Ports] 2\n', '[Number of Ports] 2\n[Number of Ports] 2\n'),
      valid.replace('[Two-Port Data Order] 21_12\n', ''),
      valid.replace('[Number of Frequencies] 1', '[Number of Frequencies] 2'),
      valid.replace('[Number of Ports] 2', '[Number of Ports] 3'),
      valid.replace('[Network Data]\n', '[Number of Frequencies] 1\n[Network Data]\n'),
    ]
    for (const text of invalid) expect(() => parseTouchstone(text, 'synthetic.s2p')).toThrow()
  })

  it('uses [Number of Ports] for .ts files and keeps .sNp extension mismatches closed', () => {
    expect(parseTouchstone(twoPortV2(), 'synthetic.ts').ports).toBe(2)
    expect(() => parseTouchstone(twoPortV2(), 'synthetic.s3p')).toThrow(/match/i)
    expect(() => parseTouchstone('# Hz S RI R 50\n1 0.1 0\n', 'legacy.ts')).toThrow(/\.s1p/i)
  })

  it('rejects unsupported sections, mixed-mode, noise, and per-port renormalization', () => {
    const unsupported = [
      twoPortV2().replace('[Network Data]', '[Vendor Extension]\n[Network Data]'),
      twoPortV2().replace('[Network Data]', '[Mixed-Mode Order] D1,2\n[Network Data]'),
      twoPortV2().replace('[End]', '[Noise Data]\n1 0.1 0\n[End]'),
      twoPortV2().replace('[Reference] 50', '[Reference] 50 75'),
      twoPortV2().replace('[Network Data]', '[Port Impedance] 50 75\n[Network Data]'),
    ]
    for (const text of unsupported) expect(() => parseTouchstone(text, 'synthetic.s2p')).toThrow()
  })

  it('rejects malformed matrix layout and data outside the network section', () => {
    for (const text of [
      twoPortV2().replace('1 11 0 21 0 12 0 22 0', '1 11 0 21 0 12 0'),
      twoPortV2().replace('[Network Data]\n', ''),
      twoPortV2().replace('[End]', '2 1 0 2 0 3 0 4 0\n[End]'),
      twoPortV2('12_21').replace('[Two-Port Data Order] 12_21', '[Two-Port Data Order] INVALID'),
    ]) {
      expect(() => parseTouchstone(text, 'synthetic.s2p')).toThrow()
    }
  })
})
