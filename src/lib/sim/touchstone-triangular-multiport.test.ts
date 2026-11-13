import { describe, expect, it } from 'vitest'
import { parseTouchstone } from './touchstone'

// Synthetic values encode triangular position; they are not vendor data.
function triangularRecord(ports: number, format: 'Lower' | 'Upper', frequency: number) {
  const pairs: Array<[number, number]> = []
  for (let row = 0; row < ports; row += 1) {
    for (let column = 0; column < ports; column += 1) {
      if (format === 'Lower' ? column <= row : column >= row) {
        const position = (row + 1) * 100 + column + 1
        pairs.push([position + frequency, -position - frequency])
      }
    }
  }
  return { pairs, fields: pairs.flatMap(([real, imaginary]) => [real, imaginary]) }
}

function expandedMatrix(ports: number, format: 'Lower' | 'Upper', frequency: number) {
  const triangular = triangularRecord(ports, format, frequency).pairs
  const stored = new Map<string, [number, number]>()
  const matrix: Array<[number, number]> = []
  let pairIndex = 0
  for (let row = 0; row < ports; row += 1) {
    for (let column = 0; column < ports; column += 1) {
      const isStored = format === 'Lower' ? column <= row : column >= row
      if (isStored) {
        stored.set(`${row},${column}`, triangular[pairIndex++]!)
      }
    }
  }
  for (let row = 0; row < ports; row += 1) {
    for (let column = 0; column < ports; column += 1) {
      // Touchstone triangular matrices represent a symmetric matrix.
      matrix.push(stored.get(`${row},${column}`) ?? stored.get(`${column},${row}`)!)
    }
  }
  return matrix
}

function recordFields(ports: number, format: 'Lower' | 'Upper', frequency: number) {
  return triangularRecord(ports, format, frequency).fields
}

function document(ports: number, format: 'Lower' | 'Upper', wrapped: boolean) {
  const first = recordFields(ports, format, 1)
  const second = recordFields(ports, format, 2)
  const firstFields = wrapped
    ? `1 ${first.slice(0, 6).join(' ')}\n${first.slice(6).join(' ')}`
    : `1 ${first.join(' ')}`
  return [
    '[Version] 2.0',
    '# MHz S RI R 50',
    `[Number of Ports] ${ports}`,
    '[Number of Frequencies] 2',
    `[Matrix Format] ${format}`,
    '[Network Data]',
    firstFields,
    `2 ${second.join(' ')}`,
    '[End]',
    '',
  ].join('\n')
}

describe('synthetic Touchstone 2.x triangular multiport matrices', () => {
  for (const ports of [3, 4]) {
    for (const format of ['Lower', 'Upper'] as const) {
      it(`expands ${ports}-port ${format} records into the existing row-major matrix`, () => {
        const network = parseTouchstone(document(ports, format, ports === 4 && format === 'Upper'), `synthetic.s${ports}p`)

        expect(network.points).toEqual([
          { frequencyHz: 1e6, s: expandedMatrix(ports, format, 1) },
          { frequencyHz: 2e6, s: expandedMatrix(ports, format, 2) },
        ])
      })
    }
  }
})
