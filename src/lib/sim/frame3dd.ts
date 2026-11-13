/** Frame3DD `.3dd` input and `.out` result readers for the bundled software-case
 * corpus. `.3dd` is Henri Gavin's line-oriented frame/truss input format; `.out`
 * carries the reference tables published upstream. Only the planar, static,
 * nodal-load + prescribed-displacement subset is mapped to our `beam2d` FEM —
 * anything else (3D geometry, shear deformation, geometric stiffness, member
 * loads, temperature, dynamics) fails closed.
 */

export const FRAME3DD_MAX_BYTES = 256 * 1024

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

function dataLines(text: string): string[] {
  if (new TextEncoder().encode(text).length > FRAME3DD_MAX_BYTES) {
    throw new Error('Frame3DD input exceeds 256 KiB')
  }
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0)
}

function numericRow(line: string, count: number, what: string): number[] {
  const tokens = line.split(/\s+/)
  if (tokens.length < count || !tokens.slice(0, count).every((t) => NUM.test(t))) {
    throw new Error(`Frame3DD: invalid numeric row for ${what}: '${line.slice(0, 80)}'`)
  }
  return tokens.slice(0, count).map(Number)
}

export type Frame3ddNode = { id: number; x: number; y: number; z: number }
export type Frame3ddElement = {
  id: number
  n1: number
  n2: number
  ax: number
  izz: number
  e: number
  roll: number
}
export type Frame3ddLoadCase = {
  gravity: [number, number, number]
  nodalLoads: { node: number; fx: number; fy: number; fz: number; mxx: number; myy: number; mzz: number }[]
  uniformLoads: number
  trapezoidalLoads: number
  internalPointLoads: number
  temperatureLoads: number
  prescribed: { node: number; d: [number, number, number, number, number, number] }[]
}
export type Frame3ddInput = {
  title: string
  nodes: Frame3ddNode[]
  /** node id → restraint flags [x,y,z,xx,yy,zz] (1 = fixed) */
  restraints: Map<number, [number, number, number, number, number, number]>
  elements: Frame3ddElement[]
  shearDeformation: boolean
  geometricStiffness: boolean
  loadCases: Frame3ddLoadCase[]
}

export function parseFrame3ddInput(text: string): Frame3ddInput {
  const lines = dataLines(text)
  if (lines.length < 4) throw new Error('Frame3DD: truncated input')
  const title = lines[0]!
  const at = { i: 1 }
  const count = (what: string) => {
    const row = numericRow(lines[at.i++] ?? '', 1, what)
    if (!Number.isInteger(row[0]) || row[0]! < 0) throw new Error(`Frame3DD: invalid count for ${what}`)
    return row[0]!
  }

  const nodes: Frame3ddNode[] = []
  const nodeIds = new Set<number>()
  for (let k = count('nodes'); k > 0; k--) {
    const [id, x, y, z] = numericRow(lines[at.i++] ?? '', 4, 'node')
    if (!Number.isInteger(id) || nodeIds.has(id!)) throw new Error(`Frame3DD: invalid or duplicate node ${id}`)
    nodeIds.add(id!)
    nodes.push({ id: id!, x: x!, y: y!, z: z! })
  }

  const restraints = new Map<number, [number, number, number, number, number, number]>()
  for (let k = count('reactions'); k > 0; k--) {
    const row = numericRow(lines[at.i++] ?? '', 7, 'reaction')
    if (!nodeIds.has(row[0]!)) throw new Error(`Frame3DD: reaction on unknown node ${row[0]}`)
    const flags = row.slice(1, 7)
    if (!flags.every((f) => f === 0 || f === 1)) throw new Error('Frame3DD: restraint flags must be 0 or 1')
    restraints.set(row[0]!, flags as [number, number, number, number, number, number])
  }

  const elements: Frame3ddElement[] = []
  const elIds = new Set<number>()
  for (let k = count('frame elements'); k > 0; k--) {
    const row = numericRow(lines[at.i++] ?? '', 13, 'frame element')
    const [id, n1, n2, ax, , , , , izz, e, , roll] = row
    if (!Number.isInteger(id) || elIds.has(id!)) throw new Error(`Frame3DD: invalid or duplicate element ${id}`)
    elIds.add(id!)
    if (!nodeIds.has(n1!) || !nodeIds.has(n2!)) throw new Error(`Frame3DD: element ${id} references unknown node`)
    elements.push({ id: id!, n1: n1!, n2: n2!, ax: ax!, izz: izz!, e: e!, roll: roll! })
  }

  const shearDeformation = numericRow(lines[at.i++] ?? '', 1, 'shear flag')[0] !== 0
  const geometricStiffness = numericRow(lines[at.i++] ?? '', 1, 'geometric stiffness flag')[0] !== 0
  // exaggeration, zoom and the internal-force increment are postprocessing only
  at.i += 3

  const loadCases: Frame3ddLoadCase[] = []
  for (let k = count('load cases'); k > 0; k--) {
    const gravity = numericRow(lines[at.i++] ?? '', 3, 'gravity') as [number, number, number]
    const nodalLoads: Frame3ddLoadCase['nodalLoads'] = []
    for (let j = count('nodal loads'); j > 0; j--) {
      const row = numericRow(lines[at.i++] ?? '', 7, 'nodal load')
      if (!nodeIds.has(row[0]!)) throw new Error(`Frame3DD: nodal load on unknown node ${row[0]}`)
      nodalLoads.push({
        node: row[0]!,
        fx: row[1]!, fy: row[2]!, fz: row[3]!,
        mxx: row[4]!, myy: row[5]!, mzz: row[6]!,
      })
    }
    const uniformLoads = count('uniform loads')
    at.i += uniformLoads
    const trapezoidalLoads = count('trapezoidal loads')
    at.i += trapezoidalLoads
    const internalPointLoads = count('internal concentrated loads')
    at.i += internalPointLoads
    const temperatureLoads = count('temperature loads')
    at.i += temperatureLoads
    const prescribed: Frame3ddLoadCase['prescribed'] = []
    for (let j = count('prescribed displacements'); j > 0; j--) {
      const row = numericRow(lines[at.i++] ?? '', 7, 'prescribed displacement')
      if (!nodeIds.has(row[0]!)) throw new Error(`Frame3DD: prescribed displacement on unknown node ${row[0]}`)
      prescribed.push({ node: row[0]!, d: row.slice(1, 7) as [number, number, number, number, number, number] })
    }
    loadCases.push({ nodalLoads, uniformLoads, trapezoidalLoads, internalPointLoads, temperatureLoads, prescribed, gravity })
  }
  const dynamicModes = count('dynamic modes')
  if (dynamicModes !== 0) throw new Error('Frame3DD: dynamic/modal analysis is not supported')
  return { title, nodes, restraints, elements, shearDeformation, geometricStiffness, loadCases }
}

/** Unit multipliers into SI for the `.3dd` family that declares (force, length) in its title. */
export const FRAME3DD_UNITS = {
  'kip-in': { length: 0.0254, force: 4448.2216152605, stress: 6.894757293168e6 },
  'kip-ft': { length: 0.3048, force: 4448.2216152605, stress: 6.894757293168e6 / 0.3048 },
  'kN-m': { length: 1, force: 1000, stress: 1000 },
  'N-m': { length: 1, force: 1, stress: 1 },
} as const

export type Frame3ddUnitName = keyof typeof FRAME3DD_UNITS

export type Beam2dParameters = {
  elementType: 'beam2d'
  youngsModulusPa: number
  poissonRatio: number
  nodes: { id: number; x: number; y: number }[]
  elements: { id: number; n1: number; n2: number; area: number; I: number }[]
  constraints: { node: number; dof: 'ux' | 'uy' | 'rz'; value: number }[]
  loads: { node: number; dof: 'ux' | 'uy' | 'rz'; value: number }[]
  units: {
    length: 'm'
    force: 'N'
    stress: 'Pa'
    youngsModulus: 'Pa'
    area: 'm^2'
    secondMoment: 'm^4'
    displacement: 'm'
  }
}

/** Map the planar-static subset of a `.3dd` file to SI `beam2d` FEM parameters.
 * In Frame3DD a member lying in the XY plane with roll=0 keeps local z parallel
 * to global Z, so in-plane bending uses Izz. Out-of-plane restraint flags are
 * inert in 2D; nonzero out-of-plane prescribed motion or loads are rejected. */
export function frame3ddBeam2dParameters(
  input: Frame3ddInput,
  options: { loadCase: number; units: Frame3ddUnitName },
): Beam2dParameters {
  const u = FRAME3DD_UNITS[options.units]
  const lc = input.loadCases[options.loadCase - 1]
  if (!lc) throw new Error(`Frame3DD: load case ${options.loadCase} does not exist`)
  if (input.shearDeformation) throw new Error('Frame3DD: shear deformation is not supported')
  if (input.geometricStiffness) throw new Error('Frame3DD: geometric stiffness is not supported')
  if (lc.gravity.some((g) => g !== 0)) throw new Error('Frame3DD: self-weight gravity loads are not supported')
  if (lc.uniformLoads + lc.trapezoidalLoads + lc.internalPointLoads + lc.temperatureLoads > 0) {
    throw new Error('Frame3DD: member/temperature loads are not supported')
  }
  if (input.nodes.some((n) => n.z !== 0) || input.elements.some((e) => e.roll !== 0)) {
    throw new Error('Frame3DD: non-planar geometry is not supported')
  }
  if (input.elements.some((e) => !(e.ax > 0) || !(e.izz > 0) || !(e.e > 0))) {
    throw new Error('Frame3DD: elements need positive Ax, Izz and E')
  }
  const Es = new Set(input.elements.map((e) => e.e))
  if (Es.size !== 1) throw new Error('Frame3DD: mixed-element-modulus models are not mapped to a single E')

  const prescribed = new Map<number, [number, number, number, number, number, number]>()
  for (const p of lc.prescribed) {
    if (prescribed.has(p.node)) throw new Error(`Frame3DD: duplicate prescribed displacement on node ${p.node}`)
    if (p.d[2] !== 0 || p.d[3] !== 0 || p.d[4] !== 0) {
      throw new Error(`Frame3DD: out-of-plane prescribed displacement on node ${p.node}`)
    }
    prescribed.set(p.node, p.d)
  }

  const constraints: Beam2dParameters['constraints'] = []
  for (const [node, flags] of input.restraints) {
    const d = prescribed.get(node)
    // restrained in-plane DOFs get their prescribed value (0 when absent);
    // unrestrained in-plane DOFs must not carry prescribed motion.
    if (flags[0] === 1) constraints.push({ node, dof: 'ux', value: (d?.[0] ?? 0) * u.length })
    if (flags[1] === 1) constraints.push({ node, dof: 'uy', value: (d?.[1] ?? 0) * u.length })
    if (flags[5] === 1) constraints.push({ node, dof: 'rz', value: d?.[5] ?? 0 })
    if (d && ((flags[0] === 0 && d[0] !== 0) || (flags[1] === 0 && d[1] !== 0) || (flags[5] === 0 && d[5] !== 0))) {
      throw new Error(`Frame3DD: prescribed displacement on unrestrained node ${node}`)
    }
  }
  for (const [node] of prescribed) {
    if (!input.restraints.has(node)) {
      throw new Error(`Frame3DD: prescribed displacement on node ${node} without restraint flags`)
    }
  }

  const loads: Beam2dParameters['loads'] = []
  for (const l of lc.nodalLoads) {
    if (l.fz !== 0 || l.mxx !== 0 || l.myy !== 0) {
      throw new Error(`Frame3DD: out-of-plane load on node ${l.node}`)
    }
    if (l.fx !== 0) loads.push({ node: l.node, dof: 'ux', value: l.fx * u.force })
    if (l.fy !== 0) loads.push({ node: l.node, dof: 'uy', value: l.fy * u.force })
    if (l.mzz !== 0) loads.push({ node: l.node, dof: 'rz', value: l.mzz * u.force * u.length })
  }

  const l4 = u.length ** 4
  const l2 = u.length ** 2
  return {
    elementType: 'beam2d',
    youngsModulusPa: input.elements[0]!.e * u.stress,
    poissonRatio: 0.3,
    nodes: input.nodes.map((n) => ({ id: n.id, x: n.x * u.length, y: n.y * u.length })),
    elements: input.elements.map((e) => ({
      id: e.id, n1: e.n1, n2: e.n2, area: e.ax * l2, I: e.izz * l4,
    })),
    constraints,
    loads,
    units: {
      length: 'm', force: 'N', stress: 'Pa', youngsModulus: 'Pa',
      area: 'm^2', secondMoment: 'm^4', displacement: 'm',
    },
  }
}

export type Frame3ddReference = {
  /** node id → [dx, dy, dz, drx, dry, drz] */
  displacements: Map<number, [number, number, number, number, number, number]>
  /** node id → [Fx, Fy, Fz, Mxx, Myy, Mzz] */
  reactions: Map<number, [number, number, number, number, number, number]>
}

/** Read one solved load case from a Frame3DD `.out` file (1-based index). */
export function parseFrame3ddOutput(text: string, loadCase: number): Frame3ddReference {
  const lines = text.split(/\r?\n/)
  const caseRe = /L O A D   C A S E\s+(\d+)\s+O F\s+(\d+)/
  // Displacement/reaction tables appear once in the input echo and once in the
  // results; the results section follows the stiffness-analysis banner.
  const analysisAt = lines.findIndex((l) => l.includes('E L A S T I C   S T I F F N E S S   A N A L Y S I S'))
  if (analysisAt < 0) throw new Error('Frame3DD .out: no analysis section')
  let inCase = false
  const result: Frame3ddReference = { displacements: new Map(), reactions: new Map() }
  const readTable = (start: number, into: Map<number, [number, number, number, number, number, number]>) => {
    for (let i = start; i < lines.length; i++) {
      const row = lines[i]!.trim().split(/\s+/)
      if (row.length >= 7 && NUM.test(row[0]!)) {
        const values = row.slice(0, 7).map(Number)
        into.set(values[0]!, values.slice(1, 7) as [number, number, number, number, number, number])
      } else if (into.size > 0) return i
    }
    return lines.length
  }
  for (let i = analysisAt; i < lines.length; i++) {
    const m = lines[i]!.match(caseRe)
    if (m) inCase = Number(m[1]) === loadCase
    if (!inCase) continue
    if (lines[i]!.includes('N O D E   D I S P L A C E M E N T S')) {
      i = readTable(i + 2, result.displacements)
    } else if (lines[i]!.includes('R E A C T I O N S')) {
      i = readTable(i + 2, result.reactions)
      return result
    }
  }
  if (result.displacements.size === 0) throw new Error(`Frame3DD .out: no results for load case ${loadCase}`)
  return result
}
