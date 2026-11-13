import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

const triangularTwoPortV2 = (
  matrixFormat: 'Lower' | 'Upper',
  dataOrder: '21_12' | '12_21',
) =>
  `[Version] 2.0\n` +
  `# MHz S RI R 50\n` +
  `[Number of Ports] 2\n` +
  `[Two-Port Data Order] ${dataOrder}\n` +
  `[Matrix Format] ${matrixFormat}\n` +
  `[Number of Frequencies] 2\n` +
  `[Reference] 50 50\n` +
  `[Network Data]\n` +
  (matrixFormat === 'Lower'
    ? `1 11 1 21 2 22 3\n2 31 4 41 5 32 6\n`
    : `1 11 1 12 2 22 3\n2 31 4 41 5 32 6\n`) +
  `[End]\n`

describe('Touchstone 2.x triangular two-port matrices', () => {
  it.each(['Lower', 'Upper'] as const)(
    'expands the %s matrix to canonical S11, S21, S12, S22 order',
    (matrixFormat) => {
      const offDiagonal = matrixFormat === 'Lower' ? [21, 2] : [12, 2]
      const network = parseTouchstone(
        triangularTwoPortV2(matrixFormat, '21_12'),
        'synthetic.s2p',
      )

      expect(network).toMatchObject({
        ports: 2,
        frequencyUnit: 'MHz',
        format: 'RI',
        referenceOhms: 50,
        points: [
          {
            frequencyHz: 1e6,
            s: [[11, 1], offDiagonal, offDiagonal, [22, 3]],
          },
          {
            frequencyHz: 2e6,
            s: [[31, 4], [41, 5], [41, 5], [32, 6]],
          },
        ],
      })
    },
  )

  it.each(['21_12', '12_21'] as const)(
    'keeps triangular interpretation with [Two-Port Data Order] %s',
    (dataOrder) => {
      for (const matrixFormat of ['Lower', 'Upper'] as const) {
        const offDiagonal = matrixFormat === 'Lower' ? [21, 2] : [12, 2]
        const network = parseTouchstone(
          triangularTwoPortV2(matrixFormat, dataOrder),
          'synthetic.s2p',
        )

        expect(network.points[0].s).toEqual([
          [11, 1], offDiagonal, offDiagonal, [22, 3],
        ])
      }
    },
  )

  it('still requires [Two-Port Data Order] for a v2 two-port file', () => {
    const missingOrder = triangularTwoPortV2('Lower', '21_12').replace(
      '[Two-Port Data Order] 21_12\n',
      '',
    )

    expect(() => parseTouchstone(missingOrder, 'synthetic.s2p')).toThrow(
      /Two-Port Data Order/,
    )
  })
})
