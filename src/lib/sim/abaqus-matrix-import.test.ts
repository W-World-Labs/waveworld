import { describe, expect, it } from 'vitest'
import { importAbaqusMatrixPair } from './abaqus-matrix-import'

// Small, invented matrix records: row node, row DOF, column node, column DOF, value.
// These fixtures describe no vendor model or commercial solver output.
const pair = (stiffness: string, mass: string) => importAbaqusMatrixPair(stiffness, mass)
const expectFailure = (stiffness: string, mass: string) => {
  const result = pair(stiffness, mass)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected matrix import to fail')
  expect(result.diagnostics.length).toBeGreaterThan(0)
  expect(result.diagnostics.every(message => typeof message === 'string' && message.length > 0)).toBe(true)
}

describe('Abaqus matrix pair import', () => {
  it.each([
    ['lower triangle', '10,1,10,1,6\n20,1,10,1,-2\n20,1,20,1,5', 'lower'],
    ['upper triangle', '10,1,10,1,6\n10,1,20,1,-2\n20,1,20,1,5', 'upper'],
    ['full symmetric storage', '10,1,10,1,6\n10,1,20,1,-2\n20,1,10,1,-2\n20,1,20,1,5', 'full'],
  ] as const)('expands %s into matching dense symmetric matrices', (_label, stiffness, storage) => {
    const mass = stiffness.replace(/6/g, '4').replace(/-2/g, '-1').replace(/5/g, '3')
    const result = pair(stiffness, mass)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.diagnostics.join('; '))

    expect(result.stiffness).toEqual([[6, -2], [-2, 5]])
    expect(result.mass).toEqual([[4, -1], [-1, 3]])
    expect(result.stiffnessStorage).toBe(storage)
    expect(result.massStorage).toBe(storage)
    expect(result.stiffnessEntries).toBe(storage === 'full' ? 4 : 3)
    expect(result.massEntries).toBe(storage === 'full' ? 4 : 3)
  })

  it('returns a deterministic lexicographic node and DOF map independent of record order', () => {
    const first = pair(
      '20,3,20,3,9\n10,2,10,2,8\n10,1,10,1,7',
      '20,3,20,3,3\n10,2,10,2,2\n10,1,10,1,1',
    )
    const permuted = pair(
      '10,1,10,1,7\n20,3,20,3,9\n10,2,10,2,8',
      '10,1,10,1,1\n20,3,20,3,3\n10,2,10,2,2',
    )
    expect(first.ok).toBe(true)
    expect(permuted.ok).toBe(true)
    if (!first.ok || !permuted.ok) throw new Error('Expected both synthetic matrix pairs to import')

    const expectedMap = [
      { index: 0, node: 10, dof: 1 },
      { index: 1, node: 10, dof: 2 },
      { index: 2, node: 20, dof: 3 },
    ]
    expect(first.dofMap).toEqual(expectedMap)
    expect(permuted.dofMap).toEqual(expectedMap)
    expect(permuted.stiffness).toEqual(first.stiffness)
    expect(permuted.mass).toEqual(first.mass)
  })

  it('accepts explicitly stored zero coefficients and reports their entries', () => {
    const result = pair('4,1,4,1,0\n4,1,9,1,0\n9,1,9,1,2', '4,1,4,1,1\n4,1,9,1,0\n9,1,9,1,3')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.diagnostics.join('; '))
    expect(result.stiffness).toEqual([[0, 0], [0, 2]])
    expect(result.stiffnessEntries).toBe(3)
    expect(result.mass).toEqual([[1, 0], [0, 3]])
    expect(result.massEntries).toBe(3)
  })

  it('rejects duplicate coordinates in either matrix', () => {
    expectFailure('1,1,1,1,2\n1,1,1,1,2', '1,1,1,1,1')
    expectFailure('1,1,1,1,2', '1,1,1,1,1\n1,1,1,1,1')
  })

  it('rejects mixed triangular and full storage and asymmetric full storage', () => {
    expectFailure('1,1,1,1,4\n1,1,2,1,1\n2,1,2,1,3\n3,1,2,1,2\n3,1,3,1,5', '1,1,1,1,2\n1,1,2,1,1\n2,1,1,1,1\n2,1,2,1,2\n2,1,3,1,1\n3,1,2,1,1\n3,1,3,1,3')
    expectFailure('1,1,1,1,4\n1,1,2,1,1\n2,1,1,1,7\n2,1,2,1,3', '1,1,1,1,2\n1,1,2,1,1\n2,1,1,1,1\n2,1,2,1,2')
  })

  it('rejects malformed field counts and non-finite coefficients', () => {
    expectFailure('1,1,1,1', '1,1,1,1,1')
    expectFailure('1,1,1,1,2,extra', '1,1,1,1,1')
    expectFailure('1,1,1,1,NaN', '1,1,1,1,1')
    expectFailure('1,1,1,1,Infinity', '1,1,1,1,1')
  })

  it('rejects negative or internal node identifiers and unsupported DOFs', () => {
    expectFailure('-1,1,-1,1,2', '-1,1,-1,1,1')
    expectFailure('0,1,0,1,2', '0,1,0,1,1')
    expectFailure('1,7,1,7,2', '1,7,1,7,1')
  })

  it('requires mass diagonals and matching stiffness and mass DOF sets', () => {
    expectFailure('1,1,1,1,4\n1,1,2,1,1\n2,1,2,1,3', '1,1,2,1,1\n2,1,2,1,2')
    expectFailure('1,1,1,1,4\n1,1,2,1,1\n2,1,2,1,3', '1,1,1,1,2')
  })

  it('rejects matrices above the 16-DOF cap', () => {
    const records = Array.from({ length: 17 }, (_, index) => `${index + 1},1,${index + 1},1,1`).join('\n')
    expectFailure(records, records)
  })

  it('rejects input files larger than 2 MiB', () => {
    const valid = '1,1,1,1,1'
    expectFailure(`${valid}\n${' '.repeat(2 * 1024 * 1024)}`, valid)
  })
})
