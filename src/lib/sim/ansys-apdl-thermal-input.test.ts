import { describe, expect, it } from 'vitest'
import { parseAnsysApdlThermalInput } from './ansys-apdl-thermal-input'

const validApdl = `! literal steady LINK33 bar
/PREP7
ET,1,LINK33
R,1,2.5
MP,KXX,1,15
N,10,0,0,0
N,40,0.25,0,0
N,99,2,0,0
TYPE,1
REAL,1
MAT,1
E,10,40
EN,7,40,99
FINISH
/SOLU
ANTYPE,STATIC
D,10,TEMP,100
D,99,TEMP,20
F,40,HEAT,3
SOLVE
FINISH
`

const replaceOnce = (source: string, from: string, to: string): string => {
  if (!source.includes(from)) throw new Error(`fixture does not contain ${from}`)
  return source.replace(from, to)
}

const noEndpointConstraint = replaceOnce(validApdl, 'D,99,TEMP,20\n', '')

describe('Ansys APDL thermal input parser', () => {
  it('parses literal steady LINK33 bars, comments, E/EN, nonuniform x, endpoint temperatures, and nodal heat', () => {
    const parsed = parseAnsysApdlThermalInput(validApdl)

    expect(parsed.input).toEqual({
      module: 'sw-ansys-thermal-fem',
      backend: 'host',
      analysis: 'steady',
      dimension: 1,
      mesh: {
        element: 'bar',
        nodes: [[0], [0.25], [2]],
        elements: [[0, 1], [1, 2]],
      },
      conductivity: 15,
      thickness: 2.5,
      dirichlet: [
        { node: 0, temperature: 100 },
        { node: 2, temperature: 20 },
      ],
      sources: [0, 3, 0],
    })
    expect(parsed.externalNodeLabels).toEqual([10, 40, 99])
    expect(parsed.summary).toEqual({
      nodeCount: 3,
      elementCount: 2,
      areaM2: 2.5,
      conductivityWPerMK: 15,
    })
    expect(parsed.sourceText).toBe(validApdl)
  })

  it('accepts either E node-pair elements or EN explicit element IDs', () => {
    const eOnly = replaceOnce(validApdl, 'EN,7,40,99\n', 'E,40,99\n')
    const enOnly = replaceOnce(validApdl, 'E,10,40\n', 'EN,3,10,40\n')

    expect(parseAnsysApdlThermalInput(eOnly).input.mesh.elements).toEqual([[0, 1], [1, 2]])
    expect(parseAnsysApdlThermalInput(enOnly).input.mesh.elements).toEqual([[0, 1], [1, 2]])
  })

  it('accepts ANTYPE,STATIC in /PREP7 as documented by MAPDL', () => {
    const prep7Analysis = replaceOnce(
      replaceOnce(validApdl, '/PREP7\n', '/PREP7\nANTYPE,STATIC\n'),
      'ANTYPE,STATIC\nD,10,TEMP,100',
      'D,10,TEMP,100',
    )
    expect(parseAnsysApdlThermalInput(prep7Analysis).input.analysis).toBe('steady')
  })

  it.each([
    ['macro definition', replaceOnce(validApdl, '/PREP7\n', '*SET,X,1\n/PREP7\n')],
    ['parameter substitution', replaceOnce(validApdl, 'N,10,0,0,0', 'N,10,X,0,0')],
    ['NBLOCK bulk input', replaceOnce(validApdl, 'N,10,0,0,0\n', 'NBLOCK,6,SOLID,,3\n(1i8,3e20.13)\n10,0,0,0\n')],
    ['unknown command', replaceOnce(validApdl, 'SOLVE\n', 'PLOT\nSOLVE\n')],
    ['non-x-axis geometry', replaceOnce(validApdl, 'N,40,0.25,0,0', 'N,40,0.25,0.01,0')],
    ['missing endpoint temperature', noEndpointConstraint],
    ['interior endpoint temperature', replaceOnce(validApdl, 'D,99,TEMP,20', 'D,40,TEMP,20')],
    ['transient analysis', replaceOnce(validApdl, 'ANTYPE,STATIC', 'ANTYPE,TRANS')],
    ['extra real constant set', replaceOnce(validApdl, 'MP,KXX,1,15', 'R,2,2.5\nMP,KXX,1,15')],
    ['extra material', replaceOnce(validApdl, 'MP,KXX,1,15', 'MP,KXX,2,15\nMP,KXX,1,15')],
    ['extra element type', replaceOnce(validApdl, 'ET,1,LINK33', 'ET,1,LINK33\nET,2,LINK33')],
    ['non-finite numeric field', replaceOnce(validApdl, 'MP,KXX,1,15', 'MP,KXX,1,1e309')],
    ['numeric magnitude above bound', replaceOnce(validApdl, 'MP,KXX,1,15', 'MP,KXX,1,1000000000001')],
  ])('fails closed for %s', (_name, source) => {
    expect(() => parseAnsysApdlThermalInput(source)).toThrow()
  })

  it.each([
    ['duplicate node ID', replaceOnce(validApdl, 'N,40,0.25,0,0\n', 'N,10,0.25,0,0\n')],
    ['duplicate EN element ID', replaceOnce(validApdl, 'EN,7,40,99', 'EN,1,40,99')],
    ['duplicate nodal heat load', replaceOnce(validApdl, 'F,40,HEAT,3', 'F,40,HEAT,3\nF,40,HEAT,4')],
    ['duplicate endpoint temperature load', replaceOnce(validApdl, 'D,10,TEMP,100', 'D,10,TEMP,100\nD,10,TEMP,90')],
    ['disconnected element chain', replaceOnce(validApdl, 'EN,7,40,99', 'EN,7,10,99')],
    ['nonadjacent element', replaceOnce(validApdl, 'E,10,40', 'E,10,99')],
  ])('rejects %s', (_name, source) => {
    expect(() => parseAnsysApdlThermalInput(source)).toThrow()
  })

  it('enforces the input byte and command caps', () => {
    expect(() => parseAnsysApdlThermalInput(`!${'x'.repeat(65_536)}`)).toThrow()
    expect(() => parseAnsysApdlThermalInput(
      validApdl.replace('/PREP7\n', `/PREP7\n${'TYPE,1\n'.repeat(2_050)}`),
    )).toThrow()
  })

  it('enforces node and element caps', () => {
    const manyNodes = Array.from({ length: 257 }, (_, index) => `N,${index + 1},${index},0,0`).join('\n')
    const nodesOverCap = validApdl.replace(
      'N,10,0,0,0\nN,40,0.25,0,0\nN,99,2,0,0',
      manyNodes,
    )
    expect(() => parseAnsysApdlThermalInput(nodesOverCap)).toThrow()

    const manyElements = Array.from({ length: 256 }, (_, index) => `E,${index + 1},${index + 2}`).join('\n')
    const elementsOverCap = validApdl.replace('E,10,40\nEN,7,40,99', manyElements)
    expect(() => parseAnsysApdlThermalInput(elementsOverCap)).toThrow()
  })
})
