import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  calculixBeam2dParameters,
  calculixCstParameters,
  parseCalculixInp,
} from './calculix-inp'

const DIR = resolve('scripts/research/software-cases/calculix/test')
const PS = readFileSync(resolve(DIR, 'planestress.inp'), 'utf8')
const PE = readFileSync(resolve(DIR, 'planestrain.inp'), 'utf8')
const B31 = readFileSync(resolve(DIR, 'b31.inp'), 'utf8')

describe('CalculiX .inp subset interpreter', () => {
  it('parses planestrain.inp into a single-quad plane-strain model', () => {
    const inp = parseCalculixInp(PE)
    expect(inp.nodes).toHaveLength(4)
    expect(inp.elements[0]).toMatchObject({ type: 'CPE4', conn: [1, 4, 3, 2] })
    expect(inp.continuumKind).toBe('plane-strain')
    expect(inp.boundaries).toEqual([
      { node: 1, dof1: 1, dof2: 2, value: 0 },
      { node: 2, dof1: 2, dof2: 2, value: 0 },
    ])
    const p = calculixCstParameters(inp)
    const tris = p.elements as { n1: number; n2: number; n3: number }[]
    expect(tris).toHaveLength(2)
    // 1 N over t=0.01 mm × 1 mm edge → σyy = 100 MPa.
    expect(p.youngsModulusPa).toBe(210000e6)
  })

  it('parses planestress.inp DLOAD into consistent edge loads', () => {
    const inp = parseCalculixInp(PS)
    const p = calculixCstParameters(inp)
    const loads = p.loads as { node: number; dof: string; value: number }[]
    // Total right-edge force = 100 MPa × 1 mm × 0.01 mm = 1 N in +x,
    // split 0.25/0.5/0.25 across corner nodes 14, 15, 19.
    const fx = new Map(loads.filter(l => l.dof === 'ux').map(l => [l.node, l.value]))
    expect(fx.get(14)).toBeCloseTo(0.25, 6)
    expect(fx.get(15)).toBeCloseTo(0.5, 6)
    expect(fx.get(19)).toBeCloseTo(0.25, 6)
    expect([...fx.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    // Left-edge ux constraints survive on corner nodes only.
    const c = p.constraints as { node: number; dof: string }[]
    expect(c.filter(x => x.dof === 'ux').map(x => x.node).sort((a, b) => a - b)).toEqual([1, 4, 10])
    expect(c).toContainEqual({ node: 4, dof: 'uy', value: 0 })
  })

  it('parses b31.inp into a beam model with RECT section', () => {
    const inp = parseCalculixInp(B31)
    expect(inp.family).toBe('beam')
    expect(inp.continuumKind).toBeNull()
    expect(inp.elements).toHaveLength(10)
    expect(inp.elements[0]).toMatchObject({ type: 'B31', conn: [1, 2] })
    expect(inp.beamSection).toMatchObject({ elset: 'EAll', material: 'ALUM', a: 0.25, b: 0.25, dir: [1, 0, 0] })
    expect(inp.boundaries).toEqual([{ node: 1, dof1: 1, dof2: 6, value: 0 }])
    expect(inp.cloads).toEqual([{ node: 11, dof: 1, value: 1 }])

    // Projection: beam axis z → our ux, transverse +x load → our uy.
    const p = calculixBeam2dParameters(inp)
    const nodes = p.nodes as { id: number; x: number; y: number }[]
    expect(nodes.find(n => n.id === 11)).toMatchObject({ x: 0.01, y: 0 })
    expect(p.constraints).toEqual([
      { node: 1, dof: 'uy', value: 0 },
      { node: 1, dof: 'ux', value: 0 },
      { node: 1, dof: 'rz', value: 0 },
    ])
    expect(p.loads).toEqual([{ node: 11, dof: 'ux', value: 0 }, { node: 11, dof: 'uy', value: 1 }])
    const el = (p.elements as { I: number; area: number }[])[0]!
    expect(el.area).toBeCloseTo(0.25 * 0.25 * 1e-6, 12)
    expect(el.I).toBeCloseTo(((0.25 * 0.25 ** 3) / 12) * 1e-12, 18)
  })

  it('fails closed outside the subset', () => {
    // Parse-level rejections.
    const parseCases: [string, RegExp][] = [
      [PE.replace('TYPE=CPE4', 'TYPE=C3D8'), /unsupported element type 'C3D8'/],
      [PE.replace('*STATIC', '*DYNAMIC'), /unsupported keyword '\*DYNAMIC'/],
      [PE.replace('*CLOAD', '*TEMPERATURE'), /unsupported keyword '\*TEMPERATURE'/],
      [PE.replace(/\*MATERIAL[\s\S]*?\*ELASTIC\n210000,\.3\n/, ''), /exactly one \*MATERIAL/],
      [B31.replace('TYPE=B31', 'TYPE=B32'), /unsupported element type 'B32'/],
      [B31.replace('SECTION=RECT', 'SECTION=PIPE'), /SECTION=RECT is supported/],
      [B31.replace('*BEAM SECTION', '*SOLID SECTION'), /\*SOLID SECTION without continuum elements/],
      [B31.replace('*STEP', '*STEP\n*DUMMY\n1'), /unsupported keyword '\*DUMMY'/],
      [B31.replace('*BOUNDARY', '*ELEMENT,TYPE=CPS3\n11,1,2,3\n*BOUNDARY'), /mixed beam\/continuum/],
    ]
    for (const [text, re] of parseCases) {
      expect(() => parseCalculixInp(text), re.source).toThrow(re)
    }
    // dof>2 parses but the continuum adapter rejects it.
    expect(() => calculixCstParameters(parseCalculixInp(PE.replace('3,2,0.5', '3,3,0.5'))))
      .toThrow(/no 2D continuum counterpart/)
    expect(() => calculixCstParameters(parseCalculixInp(PE.replace('1,1,2', '1,1,3'))))
      .toThrow(/no 2D continuum counterpart/)
    // Out-of-plane loads/moments are rejected by the beam adapter, not
    // dropped. Two transverse load directions skew the bending plane, which
    // is caught at the clamped restraint before the loads are even reached.
    expect(() => calculixBeam2dParameters(parseCalculixInp(B31.replace('11,1,1.', '11,1,1.\n11,2,1.'))))
      .toThrow(/restraint axis oblique|out-of-plane/)
    expect(() => calculixBeam2dParameters(parseCalculixInp(B31.replace('11,1,1.', '11,4,1.'))))
      .toThrow(/out-of-plane moment \*CLOAD/)
    // The continuum adapter rejects beam-family models.
    expect(() => calculixCstParameters(parseCalculixInp(B31))).toThrow(/beam elements cannot be triangulated/)
  })
})
