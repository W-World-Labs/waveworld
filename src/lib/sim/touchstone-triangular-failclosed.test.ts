import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

const triangular = (format: 'Lower' | 'Upper', data = '1 11 0 12 0 13 0 22 0 23 0 33 0') =>
  `[Version] 2.0\n` +
  `# Hz S RI R 50\n` +
  `[Number of Ports] 3\n` +
  `[Matrix Format] ${format}\n` +
  `[Number of Frequencies] 1\n` +
  `[Network Data]\n` +
  `${data}\n` +
  `[End]\n`

describe('Touchstone triangular matrix fail-closed parsing', () => {
  it.each(['Lower', 'Upper'] as const)('rejects malformed [Matrix Format] arguments with %s', (format) => {
    for (const args of ['', 'Lower Upper', 'Full Lower', 'Unknown']) {
      const text = triangular(format).replace(`[Matrix Format] ${format}`, `[Matrix Format]${args ? ` ${args}` : ''}`)
      expect(() => parseTouchstone(text, 'synthetic.s3p')).toThrow()
    }
  })

  it.each(['Lower', 'Upper'] as const)('rejects duplicate or late [Matrix Format] headers with %s', (format) => {
    const valid = triangular(format)
    expect(() => parseTouchstone(
      valid.replace(`[Matrix Format] ${format}\n`, `[Matrix Format] ${format}\n[Matrix Format] ${format}\n`),
      'synthetic.s3p',
    )).toThrow()
    expect(() => parseTouchstone(
      valid.replace('[Network Data]\n', `[Network Data]\n[Matrix Format] ${format}\n`),
      'synthetic.s3p',
    )).toThrow()
  })

  it.each(['Lower', 'Upper'] as const)('rejects incomplete triangular pair and record data with %s', (format) => {
    expect(() => parseTouchstone(triangular(format, '1 11 0 12 0 13 0 22 0 23 0 33'), 'synthetic.s3p')).toThrow()
    expect(() => parseTouchstone(triangular(format, '1 11 0 12 0 13 0 22 0 23 0'), 'synthetic.s3p')).toThrow()
  })

  it.each(['Lower', 'Upper'] as const)('rejects overlong triangular data with %s', (format) => {
    expect(() => parseTouchstone(
      triangular(format, '1 11 0 12 0 13 0 21 0 22 0 23 0 31 0'),
      'synthetic.s3p',
    )).toThrow()
  })

  it.each(['Lower', 'Upper'] as const)('keeps mixed-mode, noise, and unsupported headers rejected with %s', (format) => {
    const valid = triangular(format)
    for (const text of [
      valid.replace('[Network Data]', '[Mixed-Mode Order] D1,2\n[Network Data]'),
      valid.replace('[End]', '[Noise Data]\n1 0.1 0\n[End]'),
      valid.replace('[Network Data]', '[Port Impedance] 50 75 100\n[Network Data]'),
      valid.replace('[Network Data]', '[Vendor Extension]\n[Network Data]'),
    ]) {
      expect(() => parseTouchstone(text, 'synthetic.s3p')).toThrow()
    }
  })
})
