/**
 * CalculiX `.inp` (Abaqus keyword) subset interpreter for the bundled
 * software-case corpus.
 *
 * The supported subset covers the upstream `test/planestress.inp` /
 * `test/planestrain.inp` / `test/b31.inp` cases: *NODE, *ELEMENT (2D CPS/CPE
 * types and B31/B31R beams), *NSET/*ELSET, *BOUNDARY, *MATERIAL/*ELASTIC,
 * *SOLID SECTION / *BEAM SECTION (RECT), *STEP/*STATIC with *CLOAD/*DLOAD,
 * and the output-request keywords (parsed and ignored). Anything else fails
 * closed with a named keyword instead of being skipped.
 *
 * Element reduction: quads decompose into CST triangles on their corner
 * connectivity; mid-side nodes of quadratic elements (and their boundary
 * rows) are reduced away, with *CLOADs on them folding 50/50 onto the edge
 * endpoints. This is exact whenever the true displacement field is linear —
 * the cases here are constant-strain patches.
 *
 * Beam reduction: B31 is a linear Timoshenko beam; it is mapped onto the
 * `beam2d` Euler–Bernoulli element by projecting the 3D model onto its
 * in-plane basis. The shear correction is not modelled — for the slender
 * cantilevers in this corpus it is a documented sub-percent effect.
 */
export type CalculixElementType =
  | 'CPS3' | 'CPS4' | 'CPS8' | 'CPS8R' | 'CPE3' | 'CPE4' | 'CPE8' | 'CPE8R'
  | 'B31' | 'B31R'
const ELEM_NODES: Record<CalculixElementType, number> = {
  CPS3: 3, CPS4: 4, CPS8: 8, CPS8R: 8, CPE3: 3, CPE4: 4, CPE8: 8, CPE8R: 8,
  B31: 2, B31R: 2,
}
const PLANE_STRAIN = new Set(['CPE3', 'CPE4', 'CPE8', 'CPE8R'])
const BEAM_TYPES = new Set(['B31', 'B31R'])

export type CalculixInp = {
  nodes: { id: number; x: number; y: number; z: number }[]
  elements: { id: number; type: CalculixElementType; conn: number[] }[]
  nsets: Map<string, number[]>
  elsets: Map<string, number[]>
  /** { node }-resolved displacement constraints (dofs 1-3 translations, 4-6 rotations). */
  boundaries: { node: number; dof1: number; dof2: number; value: number }[]
  material: { name: string; E: number; nu: number }
  thickness: number
  cloads: { node: number; dof: number; value: number }[]
  dloads: { elem: number; face: number; pressure: number }[]
  /** '*SOLID SECTION' continuum vs '*BEAM SECTION' beam model. */
  family: 'continuum' | 'beam'
  /** Set for family 'continuum'. */
  continuumKind: 'plane-stress' | 'plane-strain' | null
  /** Set for family 'beam' (SECTION=RECT only). */
  beamSection: { elset: string; material: string; a: number; b: number; dir: [number, number, number] } | null
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/
const num = (tok: string | undefined, what: string): number => {
  const v = Number(String(tok ?? '').replace(/[dD]/g, 'e'))
  if (tok === undefined || !NUM.test(tok.trim()) || !Number.isFinite(v)) {
    throw new Error(`CalculiX input: expected numeric ${what}`)
  }
  return v
}
const int = (tok: string | undefined, what: string): number => {
  const v = num(tok, what)
  if (!Number.isSafeInteger(v)) throw new Error(`CalculiX input: expected integer ${what}`)
  return v
}

function keywordOpts(line: string): [string, Map<string, string>] {
  const [head, ...rest] = line.split(',')
  const opts = new Map<string, string>()
  for (const tok of rest) {
    const eq = tok.indexOf('=')
    if (eq < 0) opts.set(tok.trim().toUpperCase(), '')
    else opts.set(tok.slice(0, eq).trim().toUpperCase(), tok.slice(eq + 1).trim())
  }
  return [head!.trim().toUpperCase(), opts]
}

/** Keywords whose following data lines are output requests — shape-checked, ignored. */
const OUTPUT_KEYWORDS = new Set(['NODE PRINT', 'EL PRINT', 'NODE FILE', 'EL FILE', 'CONTACT PRINT', 'CONTACT FILE'])
/** Keywords with no data lines. */
const FLAG_KEYWORDS = new Set(['STATIC', 'END STEP', 'END DATA', 'RESTART', 'HEADING'])

export function parseCalculixInp(text: string): CalculixInp {
  const nodes: CalculixInp['nodes'] = []
  const elements: CalculixInp['elements'] = []
  const nsets = new Map<string, number[]>()
  const elsets = new Map<string, number[]>()
  const boundaries: CalculixInp['boundaries'] = []
  const cloads: CalculixInp['cloads'] = []
  const dloads: CalculixInp['dloads'] = []
  const materials = new Map<string, { E: number; nu: number }>()
  const sections: { elset: string; material: string; thickness: number }[] = []
  const beamSections: NonNullable<CalculixInp['beamSection']>[] = []
  let curMaterial = ''
  let curElset = ''
  let mode: 'node' | 'element' | 'nset' | 'elset' | 'boundary' | 'elastic' | 'section' | 'cload' | 'dload' | 'skip' | null = null
  let sectionElset = ''
  let sectionMaterial = ''
  let inStep = false

  // Logical lines: a line ending in ',' continues onto the next.
  const raw = text.split(/\r?\n/)
  const lines: string[] = []
  for (const r of raw) {
    const t = r.trim()
    if (t.startsWith('**') || t === '') {
      if (lines.length && lines[lines.length - 1]!.endsWith(',')) continue
      lines.push(t)
      continue
    }
    if (lines.length && lines[lines.length - 1]!.endsWith(',') && !t.startsWith('*')) {
      lines[lines.length - 1] += ' ' + t
    } else lines.push(t)
  }

  /** Data lines following keyword at index i0, plus how many raw lines they span. */
  const dataLines = (i0: number): { rows: string[]; span: number } => {
    const rows: string[] = []
    let i = i0
    for (; i < lines.length && !lines[i]!.startsWith('*'); i++) {
      if (lines[i] !== '' && !lines[i]!.startsWith('**')) rows.push(lines[i]!)
    }
    return { rows, span: i - i0 }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line === '' || line.startsWith('**')) continue
    if (!line.startsWith('*')) throw new Error(`CalculiX input: stray data line '${line.slice(0, 40)}'`)
    const [kw, opts] = keywordOpts(line.slice(1))
    const block = dataLines(i + 1)
    i += block.span // consume this keyword's data block

    if (OUTPUT_KEYWORDS.has(kw)) { mode = 'skip'; continue }
    if (FLAG_KEYWORDS.has(kw)) { mode = null; if (kw === 'END STEP') inStep = false; continue }
    switch (kw) {
      case 'NODE': {
        mode = 'node'
        for (const row of block.rows) {
          const f = row.split(',').map(s => s.trim())
          nodes.push({ id: int(f[0], 'node id'), x: num(f[1], 'x'), y: num(f[2], 'y'), z: f[3] === undefined || f[3] === '' ? 0 : num(f[3], 'z') })
        }
        break
      }
      case 'ELEMENT': {
        const t = (opts.get('TYPE') ?? '').toUpperCase() as CalculixElementType
        if (!(t in ELEM_NODES)) throw new Error(`CalculiX input: unsupported element type '${opts.get('TYPE')}'`)
        curElset = opts.get('ELSET') ?? ''
        mode = 'element'
        for (const row of block.rows) {
          const f = row.split(',').map(s => s.trim()).filter(s => s !== '')
          const conn = f.slice(1).map(tk => int(tk, 'element node'))
          if (conn.length !== ELEM_NODES[t]) {
            throw new Error(`CalculiX input: ${t} expects ${ELEM_NODES[t]} nodes, got ${conn.length}`)
          }
          elements.push({ id: int(f[0], 'element id'), type: t, conn })
          if (curElset) (elsets.get(curElset) ?? elsets.set(curElset, []).get(curElset)!).push(int(f[0], 'element id'))
        }
        break
      }
      case 'NSET': {
        const name = opts.get('NSET')
        if (!name) throw new Error('CalculiX input: *NSET requires NSET=')
        if (opts.has('GENERATE')) throw new Error('CalculiX input: NSET GENERATE is not supported')
        mode = 'nset'
        const list = nsets.get(name) ?? nsets.set(name, []).get(name)!
        for (const row of block.rows) {
          for (const tok of row.split(',').map(s => s.trim()).filter(s => s !== '')) list.push(int(tok, 'nset node'))
        }
        break
      }
      case 'ELSET': {
        const name = opts.get('ELSET')
        if (!name) throw new Error('CalculiX input: *ELSET requires ELSET=')
        if (opts.has('GENERATE')) throw new Error('CalculiX input: ELSET GENERATE is not supported')
        mode = 'elset'
        const list = elsets.get(name) ?? elsets.set(name, []).get(name)!
        for (const row of block.rows) {
          for (const tok of row.split(',').map(s => s.trim()).filter(s => s !== '')) list.push(int(tok, 'elset elem'))
        }
        break
      }
      case 'BOUNDARY': {
        if (opts.size > 0 && ![...opts.keys()].every(k => k === 'OP' || k === 'TYPE')) {
          throw new Error('CalculiX input: unsupported *BOUNDARY option')
        }
        mode = 'boundary'
        for (const row of block.rows) {
          const f = row.split(',').map(s => s.trim())
          const dof1 = int(f[1], 'boundary dof1')
          const dof2 = int(f[2], 'boundary dof2')
          if (dof1 < 1 || dof2 > 6 || dof1 > dof2) {
            throw new Error('CalculiX input: *BOUNDARY dof range must lie within 1-6')
          }
          const value = f[3] === undefined || f[3] === '' ? 0 : num(f[3], 'boundary value')
          const target = f[0]!
          const ids = NUM.test(target) ? [int(target, 'boundary node')] : (nsets.get(target.toUpperCase()) ?? nsets.get(target))
          if (!ids) throw new Error(`CalculiX input: *BOUNDARY references unknown node/set '${target}'`)
          for (const id of ids) boundaries.push({ node: id, dof1, dof2, value })
        }
        break
      }
      case 'MATERIAL': {
        const name = opts.get('NAME')
        if (!name) throw new Error('CalculiX input: *MATERIAL requires NAME=')
        curMaterial = name
        mode = null
        break
      }
      case 'ELASTIC': {
        mode = 'elastic'
        for (const row of block.rows) {
          const f = row.split(',').map(s => s.trim())
          materials.set(curMaterial, { E: num(f[0], 'elastic E'), nu: num(f[1], 'elastic nu') })
        }
        break
      }
      case 'SOLID SECTION': {
        sectionElset = opts.get('ELSET') ?? ''
        sectionMaterial = opts.get('MATERIAL') ?? ''
        mode = 'section'
        for (const row of block.rows) {
          sections.push({ elset: sectionElset, material: sectionMaterial, thickness: num(row.split(',')[0], 'section thickness') })
        }
        break
      }
      case 'BEAM SECTION': {
        const section = (opts.get('SECTION') ?? '').toUpperCase()
        if (section !== 'RECT') {
          throw new Error(`CalculiX input: only *BEAM SECTION,SECTION=RECT is supported, got '${section}'`)
        }
        sectionElset = opts.get('ELSET') ?? ''
        sectionMaterial = opts.get('MATERIAL') ?? ''
        mode = 'section'
        if (block.rows.length !== 2) {
          throw new Error(`CalculiX input: *BEAM SECTION expects a dimensions row and a direction row, got ${block.rows.length} rows`)
        }
        const dims = block.rows[0]!.split(',').map(s => s.trim())
        const dir = block.rows[1]!.split(',').map(s => s.trim())
        beamSections.push({
          elset: sectionElset,
          material: sectionMaterial,
          a: num(dims[0], 'beam section dim a'),
          b: num(dims[1], 'beam section dim b'),
          dir: [num(dir[0], 'beam dir x'), num(dir[1], 'beam dir y'), num(dir[2], 'beam dir z')],
        })
        break
      }
      case 'STEP': { inStep = true; mode = null; break }
      case 'CLOAD': {
        if (!inStep) throw new Error('CalculiX input: *CLOAD outside *STEP')
        mode = 'cload'
        for (const row of block.rows) {
          const f = row.split(',').map(s => s.trim())
          const dof = int(f[1], 'cload dof')
          if (dof < 1 || dof > 6) throw new Error('CalculiX input: *CLOAD dof must lie within 1-6')
          cloads.push({ node: int(f[0], 'cload node'), dof, value: num(f[2], 'cload value') })
        }
        break
      }
      case 'DLOAD': {
        if (!inStep) throw new Error('CalculiX input: *DLOAD outside *STEP')
        mode = 'dload'
        for (const row of block.rows) {
          const f = row.split(',').map(s => s.trim())
          const faceTok = f[1] ?? ''
          const m = /^P([1-4])$/.exec(faceTok)
          if (!m) throw new Error(`CalculiX input: only pressure faces P1-P4 are supported in *DLOAD, got '${faceTok}'`)
          dloads.push({ elem: int(f[0], 'dload elem'), face: int(m[1], 'dload face'), pressure: num(f[2], 'dload pressure') })
        }
        break
      }
      default:
        throw new Error(`CalculiX input: unsupported keyword '*${kw}'`)
    }
  }
  void mode

  if (nodes.length === 0 || elements.length === 0) throw new Error('CalculiX input: missing *NODE or *ELEMENT data')
  if (materials.size !== 1) throw new Error('CalculiX input: exactly one *MATERIAL/*ELASTIC is required')
  const families = new Set(elements.map(e => (BEAM_TYPES.has(e.type) ? 'beam' : 'continuum')))
  if (families.size !== 1) throw new Error('CalculiX input: mixed beam/continuum elements are not supported')
  const family = families.values().next().value as 'continuum' | 'beam'
  let continuumKind: CalculixInp['continuumKind'] = null
  let beamSection: CalculixInp['beamSection'] = null
  let thickness = 0
  if (family === 'continuum') {
    if (beamSections.length > 0) throw new Error('CalculiX input: *BEAM SECTION without beam elements')
    if (sections.length !== 1 || !materials.has(sections[0]!.material)) {
      throw new Error('CalculiX input: exactly one *SOLID SECTION with a known material is required')
    }
    thickness = sections[0]!.thickness
    const kinds = new Set(elements.map(e => (PLANE_STRAIN.has(e.type) ? 'plane-strain' : 'plane-stress')))
    if (kinds.size !== 1) throw new Error('CalculiX input: mixed plane-stress/plane-strain elements are not supported')
    continuumKind = kinds.values().next().value as 'plane-stress' | 'plane-strain'
  } else {
    if (sections.length > 0) throw new Error('CalculiX input: *SOLID SECTION without continuum elements')
    if (dloads.length > 0) throw new Error('CalculiX input: *DLOAD on beam elements is not supported')
    if (beamSections.length !== 1 || !materials.has(beamSections[0]!.material)) {
      throw new Error('CalculiX input: exactly one *BEAM SECTION with a known material is required')
    }
    const sect = beamSections[0]!
    const covered = new Set(elsets.get(sect.elset) ?? [])
    if (covered.size === 0 || elements.some(e => !covered.has(e.id))) {
      throw new Error(`CalculiX input: *BEAM SECTION elset '${sect.elset}' does not cover all beam elements`)
    }
    const dl = Math.hypot(sect.dir[0], sect.dir[1], sect.dir[2])
    if (!(dl > 0)) throw new Error('CalculiX input: *BEAM SECTION direction vector must be nonzero')
    if (!(sect.a > 0) || !(sect.b > 0)) throw new Error('CalculiX input: *BEAM SECTION dimensions must be positive')
    beamSection = sect
  }
  const nodeIds = new Set(nodes.map(n => n.id))
  for (const e of elements) for (const c of e.conn) {
    if (!nodeIds.has(c)) throw new Error(`CalculiX input: element ${e.id} references unknown node ${c}`)
  }

  return {
    nodes, elements, nsets, elsets, boundaries, cloads, dloads, family, continuumKind, beamSection,
    material: { name: [...materials.keys()][0]!, ...materials.values().next().value! },
    thickness,
  }
}

/** Corner node order c1..c4 for CCX 2D quads; 8-node types append midsides m12,m23,m34,m41. */
function elemBoundaryLoop(conn: number[]): number[][] {
  const c = conn.slice(0, 4)
  const mids = conn.length === 8 ? conn.slice(4, 8) : null
  // face k: edge c_k → c_{k+1}, carrying midside m_k when present
  return [0, 1, 2, 3].map(k => {
    const a = c[k]!, b = c[(k + 1) % 4]!
    return mids ? [a, mids[k]!, b] : [a, b]
  })
}

/** Signed double area of triangle (a,b,c) — positive when CCW. */
function triArea2(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/**
 * Decompose a supported element into CST triangles: 3-node as-is; 4- and
 * 8-node quads → (c1,c2,c3)+(c1,c3,c4) on the corner connectivity. Mid-side
 * nodes of quadratic elements carry no information when the true field is
 * linear (the constant-strain patch here), so they are reduced away; callers
 * drop unused nodes and their boundary rows (corner-pinned edges constrain
 * the whole affine edge identically).
 */
export function calculixToTriangles(inp: CalculixInp): { conn: [number, number, number]; srcElem: number }[] {
  if (inp.family !== 'continuum') throw new Error('CalculiX input: beam elements cannot be triangulated')
  const pos = new Map(inp.nodes.map(n => [n.id, n]))
  const out: { conn: [number, number, number]; srcElem: number }[] = []
  const push = (a: number, b: number, c: number, src: number) => {
    const [na, nb, nc] = [pos.get(a)!, pos.get(b)!, pos.get(c)!]
    const conn: [number, number, number] = triArea2(na, nb, nc) >= 0 ? [a, b, c] : [a, c, b]
    out.push({ conn, srcElem: src })
  }
  for (const el of inp.elements) {
    const [c1, c2, c3, c4] = el.conn
    if (el.conn.length === 3) push(c1!, c2!, c3!, el.id)
    else { push(c1!, c2!, c3!, el.id); push(c1!, c3!, c4!, el.id) }
  }
  return out
}

const DOF = ['ux', 'uy'] as const

/**
 * Map a parsed `.inp` onto the structural runner's explicit-mesh CST
 * parameters. CalculiX inputs are unit-free; we adopt the conventional
 * consistent N-mm-MPa system (E=210000 is MPa) and convert to SI.
 */
export function calculixCstParameters(inp: CalculixInp): Record<string, unknown> {
  const MM = 1e-3, MPA = 1e6
  const pos = new Map(inp.nodes.map(n => [n.id, n]))
  const tris = calculixToTriangles(inp)
  const used = new Set(tris.flatMap(t => t.conn))
  const kept = inp.nodes.filter(n => used.has(n.id))
  const keptIds = new Set(kept.map(n => n.id))

  // Mid-side nodes reduced away by the CST triangulation fold onto their
  // edge's corner endpoints (consistent 50/50 split — exact for the affine
  // fields this subset runs).
  const midEdge = new Map<number, [number, number]>()
  for (const el of inp.elements) {
    if (el.conn.length !== 8) continue
    for (const edge of elemBoundaryLoop(el.conn)) midEdge.set(edge[1]!, [edge[0]!, edge[2]!])
  }

  const loads = new Map<string, number>()
  const addLoad = (node: number, dof: 'ux' | 'uy', v: number) => {
    const key = `${node}:${dof}`
    loads.set(key, (loads.get(key) ?? 0) + v)
  }
  const addNodeLoad = (node: number, dof: 'ux' | 'uy', v: number) => {
    if (keptIds.has(node)) { addLoad(node, dof, v); return }
    const ends = midEdge.get(node)
    if (!ends) throw new Error(`CalculiX input: *CLOAD on node ${node} outside the reduced mesh`)
    addLoad(ends[0], dof, v / 2)
    addLoad(ends[1], dof, v / 2)
  }
  for (const cl of inp.cloads) {
    if (cl.dof > 2) throw new Error(`CalculiX input: *CLOAD dof ${cl.dof} has no 2D continuum counterpart`)
    addNodeLoad(cl.node, DOF[cl.dof - 1]!, cl.value) // nodal force: N
  }
  for (const dl of inp.dloads) {
    const el = inp.elements.find(e => e.id === dl.elem)
    if (!el) throw new Error(`CalculiX input: *DLOAD references unknown element ${dl.elem}`)
    const edge = elemBoundaryLoop(el.conn)[dl.face - 1]!
    const a = pos.get(edge[0]!)!, b = pos.get(edge[edge.length - 1]!)!
    const ex = (b.x - a.x) * MM, ey = (b.y - a.y) * MM
    const len = Math.hypot(ex, ey)
    if (!(len > 0)) throw new Error(`CalculiX input: zero-length loaded edge on element ${dl.elem}`)
    // CCW element boundary → outward normal = (dy, -dx)/|e|.
    const nx = ey / len, ny = -ex / len
    const pPa = dl.pressure * MPA
    const fTotal = -pPa * len * inp.thickness * MM // P>0 = compressive (inward)
    // Linear-edge consistent load: half to each end corner.
    for (const nd of [edge[0]!, edge[edge.length - 1]!]) {
      addLoad(nd, 'ux', 0.5 * fTotal * nx)
      addLoad(nd, 'uy', 0.5 * fTotal * ny)
    }
  }

  const constraints: { node: number; dof: string; value: number }[] = []
  for (const b of inp.boundaries) {
    if (!keptIds.has(b.node)) continue // reduced-away midside — see calculixToTriangles
    for (let d = b.dof1; d <= b.dof2; d++) {
      if (d > 2) throw new Error(`CalculiX input: *BOUNDARY dof ${d} has no 2D continuum counterpart`)
      constraints.push({ node: b.node, dof: DOF[d - 1]!, value: b.value * MM })
    }
  }

  return {
    elementType: 'cst',
    mode: inp.continuumKind,
    continuumKind: inp.continuumKind,
    thicknessM: inp.thickness * MM,
    youngsModulusPa: inp.material.E * MPA,
    poissonRatio: inp.material.nu,
    fixity: 'other',
    nodes: kept.map(n => ({ id: n.id, x: n.x * MM, y: n.y * MM })),
    elements: tris.map((t, i) => ({ id: i + 1, n1: t.conn[0], n2: t.conn[1], n3: t.conn[2] })),
    constraints,
    loads: [...loads.entries()].map(([k, value]) => {
      const [node, dof] = k.split(':')
      return { node: Number(node), dof, value }
    }),
    units: { length: 'm', force: 'N', stress: 'Pa', youngsModulus: 'Pa', area: 'm2', secondMoment: 'm4', displacement: 'm' },
  }
}

/** Parse the `displacements (vx,vy,vz) for set NALL` table of a CalculiX `.dat` reference. */
export function parseCalculixDatDisplacements(text: string): Map<number, [number, number, number]> {
  const out = new Map<number, [number, number, number]>()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/displacements \(vx,vy,vz\)/.test(lines[i]!)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j]!.trim()
      if (t === '') continue
      const f = t.split(/\s+/)
      if (f.length !== 4 || !NUM.test(f[0]!)) break
      out.set(int(f[0], 'dat node'), [num(f[1], 'ux'), num(f[2], 'uy'), num(f[3], 'uz')])
    }
  }
  if (out.size === 0) throw new Error('CalculiX .dat: no displacement table found')
  return out
}

/** Parse the `stresses (elem, integ.pnt.,sxx,...)` table → per-element mean [sxx,syy,szz,sxy]. */
export function parseCalculixDatStresses(text: string): Map<number, [number, number, number, number]> {
  const acc = new Map<number, number[][]>()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/stresses \(elem, integ\.pnt\./.test(lines[i]!)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j]!.trim()
      if (t === '') continue
      const f = t.split(/\s+/)
      if (f.length !== 8 || !NUM.test(f[0]!)) break
      const id = int(f[0], 'dat elem')
      const arr = acc.get(id) ?? acc.set(id, []).get(id)!
      arr.push([num(f[2], 'sxx'), num(f[3], 'syy'), num(f[4], 'szz'), num(f[5], 'sxy')])
    }
  }
  if (acc.size === 0) throw new Error('CalculiX .dat: no stress table found')
  const out = new Map<number, [number, number, number, number]>()
  for (const [id, rows] of acc) {
    out.set(id, [0, 1, 2, 3].map(k => rows.reduce((s, r) => s + r[k]!, 0) / rows.length) as [number, number, number, number])
  }
  return out
}

type Vec3 = [number, number, number]
const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const vdot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const vcross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
]
const vnorm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  if (!(l > 0)) throw new Error('CalculiX input: degenerate vector')
  return [a[0] / l, a[1] / l, a[2] / l]
}
const GLOBAL_AXES: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

/**
 * Map a parsed beam `.inp` onto the `beam2d` FEM parameters by projecting
 * the 3D model onto its in-plane orthonormal basis (e1 = element axis, e2 =
 * in-plane transverse, o = e1×e2 = bending neutral axis). B31's Timoshenko
 * shear deformation is not modelled (documented sub-percent effect for the
 * slender corpus cantilevers); out-of-plane restraints are dropped, while
 * out-of-plane loads / prescribed values fail closed.
 */
export function calculixBeam2dParameters(inp: CalculixInp): Record<string, unknown> {
  const MM = 1e-3, MPA = 1e6, TOL = 1e-6
  if (inp.family !== 'beam' || !inp.beamSection) throw new Error('CalculiX input: not a beam model')
  const pos = new Map(inp.nodes.map(n => [n.id, n] as const))
  const used = new Set(inp.elements.flatMap(e => e.conn))
  const axes = inp.elements.map(e => {
    const d = vsub([pos.get(e.conn[1])!.x, pos.get(e.conn[1])!.y, pos.get(e.conn[1])!.z],
                   [pos.get(e.conn[0])!.x, pos.get(e.conn[0])!.y, pos.get(e.conn[0])!.z])
    return vnorm(d) // throws on zero-length element
  })

  // Model plane: from two non-parallel element axes, or from the net
  // transverse force direction for a straight (collinear) beam.
  let ohat: Vec3 | null = null
  for (let i = 1; i < axes.length && !ohat; i++) {
    const c = vcross(axes[0]!, axes[i]!)
    if (Math.hypot(c[0], c[1], c[2]) > TOL) ohat = vnorm(c)
  }
  if (!ohat) {
    const a = axes[0]!
    let tx = 0, ty = 0, tz = 0
    for (const cl of inp.cloads) {
      if (cl.dof > 3) continue
      const g = GLOBAL_AXES[cl.dof - 1]!
      const t = cl.value * vdot(g, a)
      tx += cl.value * g[0] - t * a[0]; ty += cl.value * g[1] - t * a[1]; tz += cl.value * g[2] - t * a[2]
    }
    const tl = Math.hypot(tx, ty, tz)
    ohat = tl > TOL ? vnorm(vcross(a, [tx / tl, ty / tl, tz / tl]))
                    : vnorm(vcross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
  }
  const e1 = axes[0]!
  const e2 = vnorm(vcross(ohat, e1))
  for (const ax of axes) {
    if (Math.abs(vdot(ax, ohat)) > TOL) throw new Error('CalculiX input: beam elements are not coplanar')
  }
  const p0 = pos.get(inp.elements[0]!.conn[0])!
  const origin: Vec3 = [p0.x, p0.y, p0.z]
  const nodeAt = (id: number): Vec3 => {
    const p = pos.get(id)
    if (!p) throw new Error(`CalculiX input: unknown node ${id}`)
    return [p.x, p.y, p.z]
  }
  for (const id of used) {
    const d = vsub(nodeAt(id), origin)
    if (Math.abs(vdot(d, ohat)) > 1e-6 * Math.max(1, Math.hypot(d[0], d[1], d[2]))) {
      throw new Error(`CalculiX input: node ${id} lies outside the model plane`)
    }
  }

  // RECT a×b about local axes 1 (the *BEAM SECTION direction vector) and 2
  // (= axis×dir1); inertia about the neutral axis o: I = I1·(o·1)² + I2·(o·2)².
  const { a, b, dir } = inp.beamSection
  const dir1 = vnorm(dir)
  const I1 = (a * b ** 3) / 12, I2 = (b * a ** 3) / 12
  const elements = inp.elements.map((e, i) => {
    const two = vnorm(vcross(axes[i]!, dir1))
    const I = I1 * vdot(ohat!, dir1) ** 2 + I2 * vdot(ohat!, two) ** 2
    return { id: e.id, n1: e.conn[0]!, n2: e.conn[1]!, area: a * b * MM ** 2, I: I * MM ** 4 }
  })

  const constraints: { node: number; dof: string; value: number }[] = []
  for (const bc of inp.boundaries) {
    for (let d = bc.dof1; d <= bc.dof2; d++) {
      const g = GLOBAL_AXES[(d - 1) % 3]!
      if (d <= 3) {
        const co = vdot(g, ohat), c1 = vdot(g, e1), c2 = vdot(g, e2)
        if (Math.abs(co) > 1 - TOL) {
          if (bc.value !== 0) throw new Error('CalculiX input: prescribed out-of-plane displacement')
        } else if (Math.abs(c1) > 1 - TOL) constraints.push({ node: bc.node, dof: 'ux', value: bc.value * c1 * MM })
        else if (Math.abs(c2) > 1 - TOL) constraints.push({ node: bc.node, dof: 'uy', value: bc.value * c2 * MM })
        else throw new Error('CalculiX input: restraint axis oblique to the model plane')
      } else {
        const co = vdot(g, ohat)
        if (Math.abs(co) > 1 - TOL) constraints.push({ node: bc.node, dof: 'rz', value: bc.value * co })
        else if (bc.value !== 0) throw new Error('CalculiX input: prescribed out-of-plane rotation')
      }
    }
  }

  const loads = new Map<string, number>()
  const add = (node: number, dof: string, v: number) => {
    const k = `${node}:${dof}`
    loads.set(k, (loads.get(k) ?? 0) + v)
  }
  for (const cl of inp.cloads) {
    if (!used.has(cl.node)) throw new Error(`CalculiX input: *CLOAD on node ${cl.node} outside the beam mesh`)
    const g = GLOBAL_AXES[(cl.dof - 1) % 3]!
    if (cl.dof <= 3) {
      const fo = cl.value * vdot(g, ohat)
      if (fo !== 0) throw new Error(`CalculiX input: out-of-plane *CLOAD on node ${cl.node}`)
      add(cl.node, 'ux', cl.value * vdot(g, e1))
      add(cl.node, 'uy', cl.value * vdot(g, e2))
    } else {
      const co = vdot(g, ohat)
      if (cl.value !== 0 && Math.abs(co) < 1 - TOL) {
        throw new Error(`CalculiX input: out-of-plane moment *CLOAD on node ${cl.node}`)
      }
      add(cl.node, 'rz', cl.value * co * MM) // N·mm → N·m
    }
  }

  return {
    elementType: 'beam2d',
    youngsModulusPa: inp.material.E * MPA,
    poissonRatio: inp.material.nu,
    nodes: [...used].map(id => {
      const d = vsub(nodeAt(id), origin)
      return { id, x: vdot(d, e1) * MM, y: vdot(d, e2) * MM }
    }),
    elements,
    constraints,
    loads: [...loads.entries()].map(([k, value]) => {
      const [node, dof] = k.split(':')
      return { node: Number(node), dof, value }
    }),
    units: { length: 'm', force: 'N', stress: 'Pa', youngsModulus: 'Pa', area: 'm^2', secondMoment: 'm^4', displacement: 'm' },
  }
}

/** Parse the fixed-width `-4  DISP` block of a CalculiX `.frd` file → node → [vx,vy,vz]. */
export function parseCalculixFrdDisplacements(text: string): Map<number, [number, number, number]> {
  const out = new Map<number, [number, number, number]>()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-4\s+DISP/.test(lines[i]!)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!
      if (/^\s*-3/.test(l)) break
      if (/^\s*-1/.test(l)) {
        out.set(int(l.slice(3, 13).trim(), 'frd node'), [
          num(l.slice(13, 25).trim(), 'frd vx'),
          num(l.slice(25, 37).trim(), 'frd vy'),
          num(l.slice(37, 49).trim(), 'frd vz'),
        ])
      }
    }
  }
  if (out.size === 0) throw new Error('CalculiX .frd: no DISP block found')
  return out
}
