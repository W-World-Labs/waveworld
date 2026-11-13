/** OpenFOAM dictionary subset reader for the bundled software-case corpus.
 * Parses real `controlDict`/`physicalProperties`/`blockMeshDict`/`0/U` text into
 * the scalars, vectors and patch tables our LBM checks need. This is not a general
 * OpenFOAM parser: unsupported constructs fail closed instead of being skipped.
 */

export type FoamDict = [string, FoamValue][]
export type FoamValue =
  | number
  | string
  | FoamValue[]
  | FoamDict
  | { uniform: FoamValue }
  | { [key: string]: FoamValue }

export const OPENFOAM_DICT_MAX_BYTES = 256 * 1024

type Tok = string

function tokenize(text: string): Tok[] {
  if (new TextEncoder().encode(text).length > OPENFOAM_DICT_MAX_BYTES) {
    throw new Error('OpenFOAM dictionary exceeds 256 KiB')
  }
  const body = text
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  const tokens: Tok[] = []
  for (const rawLine of body.split(/\r?\n/)) {
    const hashless = rawLine.trimStart()
    if (hashless.startsWith('#')) continue // cpp directives (#includeEtc) carry no case data
    const line = rawLine.replace(/\/\/.*$/, '')
    for (const m of line.matchAll(/[(){}[\];]|[^\s(){}[\];]+/g)) tokens.push(m[0])
  }
  return tokens
}

function parseDictBody(tokens: Tok[], pos: { i: number }): FoamDict {
  const entries: FoamDict = []
  while (pos.i < tokens.length && tokens[pos.i] !== '}') {
    const key = tokens[pos.i++]!
    if (key === ';') continue
    if (/^[(){}[\]]/.test(key) || key.length === 0) {
      throw new Error(`OpenFOAM dict: unexpected token '${key}' where a key was expected`)
    }
    if (tokens[pos.i] === '{') {
      pos.i++
      entries.push([key.replace(/^"|"$/g, ''), parseDictBody(tokens, pos)])
      if (tokens[pos.i] !== '}') throw new Error(`OpenFOAM dict: missing '}' for '${key}'`)
      pos.i++
      if (tokens[pos.i] === ';') pos.i++
      continue
    }
    // `key v1 v2 … ;` — consecutive bare values form a list (e.g.
    // `box (0 -1 -1) (5 1 1);` in setFieldsDict).
    const values = [parseValue(tokens, pos)]
    while (tokens[pos.i] === '(') values.push(parseValue(tokens, pos))
    entries.push([key, values.length === 1 ? values[0]! : values])
    if (tokens[pos.i] !== ';') throw new Error(`OpenFOAM dict: missing ';' after '${key}'`)
    pos.i++
  }
  return entries
}

function parseValue(tokens: Tok[], pos: { i: number }): FoamValue {
  const tok = tokens[pos.i]
  if (tok === undefined) throw new Error('OpenFOAM dict: unexpected end of input')
  if (tok === '(') {
    pos.i++
    const items: FoamValue[] = []
    while (tokens[pos.i] !== ')') {
      if (pos.i >= tokens.length) throw new Error('OpenFOAM dict: unterminated list')
      if (tokens[pos.i] === '(') items.push(parseValue(tokens, pos))
      else if (tokens[pos.i + 1] === '{') {
        const name = tokens[pos.i]!
        pos.i += 2
        items.push({ [name]: parseDictBody(tokens, pos) })
        if (tokens[pos.i] !== '}') throw new Error(`OpenFOAM dict: missing '}' in list block '${name}'`)
        pos.i++
      } else if (tokens[pos.i + 1] === '(') {
        const kw = tokens[pos.i]!
        pos.i++
        items.push({ [kw]: parseValue(tokens, pos) })
      } else items.push(atomValue(tokens[pos.i++]!))
    }
    pos.i++
    return items
  }
  if (tok === '[') {
    pos.i++
    const dims: number[] = []
    while (tokens[pos.i] !== ']') {
      if (pos.i >= tokens.length) throw new Error('OpenFOAM dict: unterminated dimension set')
      const d = Number(tokens[pos.i++])
      if (!Number.isFinite(d)) throw new Error('OpenFOAM dict: non-numeric dimension')
      dims.push(d)
    }
    pos.i++
    // `key [dims] value;` (dimensioned scalar) vs `key [dims];` (the dims are the value)
    if (tokens[pos.i] === ';') return dims
    return parseValue(tokens, pos)
  }
  if (tok === '}' || tok === ')' || tok === ';') {
    throw new Error(`OpenFOAM dict: unexpected '${tok}' in value position`)
  }
  pos.i++
  if (tok === 'uniform') return { uniform: parseValue(tokens, pos) }
  const scalar = atomValue(tok)
  // `key value [unit];` — OpenFOAM 12 writes e.g. `nu 1e-05 [m^2/s];`
  if (tokens[pos.i] === '[') {
    if (typeof scalar !== 'number') throw new Error('OpenFOAM dict: unit suffix on a non-scalar')
    pos.i++
    while (tokens[pos.i] !== ']') {
      if (pos.i >= tokens.length) throw new Error('OpenFOAM dict: unterminated unit suffix')
      pos.i++
    }
    pos.i++
    return scalar
  }
  return scalar
}

function atomValue(tok: string): number | string {
  const n = Number(tok)
  return Number.isFinite(n) && /^[+-]?[\d.eE+-]+$/.test(tok) ? n : tok.replace(/^"|"$/g, '')
}

/** Parse an OpenFOAM dictionary file into ordered key/value entries. */
export function parseOpenFoamDict(text: string): FoamDict {
  const tokens = tokenize(text)
  const dict = parseDictBody(tokens, { i: 0 })
  return dict
}

/** Entries of a dict as a name→value map; duplicate keys fail closed. */
export function foamEntries(dict: FoamDict): Map<string, FoamValue> {
  const map = new Map<string, FoamValue>()
  for (const [key, value] of dict) {
    if (map.has(key)) throw new Error(`OpenFOAM dict: duplicate key '${key}'`)
    map.set(key, value)
  }
  return map
}

export function foamNumber(v: FoamValue | undefined, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`OpenFOAM dict: expected numeric ${what}`)
  }
  return v
}

export function foamVector(v: FoamValue | undefined, what: string): [number, number, number] {
  const arr = Array.isArray(v) ? v : (v as { uniform?: FoamValue } | undefined)?.uniform
  if (!Array.isArray(arr) || arr.length !== 3 || !arr.every((x) => typeof x === 'number')) {
    throw new Error(`OpenFOAM dict: expected 3-vector ${what}`)
  }
  return arr as [number, number, number]
}

function foamDict(v: FoamValue | undefined, what: string): FoamDict {
  if (!v || !Array.isArray(v) || v.some((e) => !Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string')) {
    throw new Error(`OpenFOAM dict: expected dictionary ${what}`)
  }
  return v as FoamDict
}

/** Kinematic viscosity nu [m^2/s] from physicalProperties/transportProperties. */
export function parseOpenFoamNu(text: string): number {
  const top = foamEntries(parseOpenFoamDict(text))
  const model = top.get('viscosityModel')
  if (model !== undefined && model !== 'constant') {
    throw new Error(`OpenFOAM dict: unsupported viscosityModel '${String(model)}'`)
  }
  return foamNumber(top.get('nu'), 'nu')
}

/** `simulationType` plus the declared turbulence/laminar model, when present. */
export function parseOpenFoamSimulationType(text: string): { type: string; model?: string } {
  const top = foamEntries(parseOpenFoamDict(text))
  const type = top.get('simulationType')
  if (typeof type !== 'string') throw new Error('OpenFOAM dict: missing simulationType')
  const block = top.get(type)
  const model = block ? foamEntries(foamDict(block, type)).get('model') : undefined
  return { type, model: typeof model === 'string' ? model : undefined }
}

export type FoamPatchValue = { name: string; type: string; value?: [number, number, number] }

/** boundaryField patch types and fixed values from a `0/U`-style field file. */
export function parseOpenFoamBoundaryField(text: string): FoamPatchValue[] {
  const top = foamEntries(parseOpenFoamDict(text))
  const boundaryField = foamEntries(foamDict(top.get('boundaryField'), 'boundaryField'))
  const patches: FoamPatchValue[] = []
  for (const [name, v] of boundaryField) {
    const patch = foamEntries(foamDict(v, `boundaryField.${name}`))
    const type = patch.get('type')
    if (typeof type !== 'string') throw new Error(`OpenFOAM dict: patch '${name}' missing type`)
    const value = patch.get('value')
    patches.push({ name, type, value: value === undefined ? undefined : foamVector(value, `boundaryField.${name}.value`) })
  }
  return patches
}

export type FoamBlockMesh = {
  convertToMeters: number
  /** Cell counts of the first hex block (single-block meshes: the grid). */
  cells: [number, number, number]
  /** Cell counts of every hex block, in file order. */
  blocks: [number, number, number][]
  /** Scaled axis-aligned bounding box of all vertices. */
  bounds: { min: [number, number, number]; max: [number, number, number] }
  /** Axis-aligned plane(s) each patch covers (a patch may span several faces). */
  patches: { name: string; type: string; planes: { axis: 'x' | 'y' | 'z'; at: number }[] }[]
}

/** blockMeshDict subset: hex blocks, axis-aligned planar patches, domain bounds. */
export function parseOpenFoamBlockMesh(text: string): FoamBlockMesh {
  const top = foamEntries(parseOpenFoamDict(text))
  const scale = foamNumber(top.get('convertToMeters') ?? 1, 'convertToMeters')

  const verticesList = top.get('vertices')
  if (!Array.isArray(verticesList)) throw new Error('OpenFOAM dict: missing vertices list')
  const vertices = verticesList.map((v) => foamVector(v, 'vertex'))
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const v of vertices) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, v[a]! * scale)
      max[a] = Math.max(max[a]!, v[a]! * scale)
    }
  }

  const blocksList = top.get('blocks')
  if (!Array.isArray(blocksList)) throw new Error('OpenFOAM dict: missing blocks list')
  const blocks: [number, number, number][] = []
  for (let i = 0; i < blocksList.length; i++) {
    const item = blocksList[i]
    if (typeof item === 'object' && item !== null && !Array.isArray(item) && 'hex' in item) {
      const counts = blocksList[i + 1]
      if (!Array.isArray(counts) || counts.length !== 3 || !counts.every((c) => Number.isInteger(c) && (c as number) > 0)) {
        throw new Error('OpenFOAM dict: hex block missing (nx ny nz) cell counts')
      }
      blocks.push(counts as [number, number, number])
    }
  }
  if (blocks.length === 0) throw new Error('OpenFOAM dict: no hex block found')
  const cells = blocks[0]!

  const boundaryList = top.get('boundary')
  if (!Array.isArray(boundaryList)) throw new Error('OpenFOAM dict: missing boundary list')
  const patches: FoamBlockMesh['patches'] = []
  for (const item of boundaryList) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const [name, patchDict] = Object.entries(item)[0] ?? []
    if (!name || !patchDict) continue
    const patch = foamEntries(patchDict as FoamDict)
    const type = patch.get('type')
    if (typeof type !== 'string') throw new Error(`OpenFOAM dict: patch '${name}' missing type`)
    if (type === 'empty') continue // 2D front/back faces carry no physics
    const faces = patch.get('faces')
    if (!Array.isArray(faces) || faces.length === 0) throw new Error(`OpenFOAM dict: patch '${name}' has no faces`)
    const planes: { axis: 'x' | 'y' | 'z'; at: number }[] = []
    for (const f of faces) {
      if (!Array.isArray(f)) throw new Error(`OpenFOAM dict: patch '${name}' face is not a vertex list`)
      const coords = f.map((idx) => {
        const v = vertices[Number(idx)]
        if (!v) throw new Error(`OpenFOAM dict: patch '${name}' references unknown vertex ${String(idx)}`)
        return v
      })
      const axes = (['x', 'y', 'z'] as const).filter((_, a) => {
        const vals = coords.map((c) => c[a])
        return Math.max(...vals) - Math.min(...vals) < 1e-9
      })
      if (axes.length !== 1) {
        throw new Error(`OpenFOAM dict: patch '${name}' face is not axis-aligned planar (unsupported)`)
      }
      const axis = axes[0]!
      const at = coords[0]![{ x: 0, y: 1, z: 2 }[axis]]! * scale
      if (!planes.some((p) => p.axis === axis && Math.abs(p.at - at) < 1e-9)) {
        planes.push({ axis, at })
      }
    }
    patches.push({ name, type, planes })
  }
  return { convertToMeters: scale, cells, blocks, bounds: { min, max }, patches }
}

/** First explicit momentum-source vector [m/s^2] from an fvModels file, if declared. */
export function parseOpenFoamMomentumSource(text: string): [number, number, number] {
  const top = foamEntries(parseOpenFoamDict(text))
  for (const [, v] of top) {
    const model = foamEntries(foamDict(v, 'fvModels entry'))
    if (model.get('type') !== 'semiImplicitSource') continue
    const sources = foamEntries(foamDict(model.get('sources'), 'sources'))
    const u = sources.get('U')
    if (u === undefined) continue
    const explicit = foamEntries(foamDict(u, 'sources.U')).get('explicit')
    return foamVector(explicit, 'sources.U.explicit')
  }
  throw new Error('OpenFOAM dict: no semiImplicitSource momentum source for U')
}

export type FoamFieldValues = {
  U?: [number, number, number]
  T?: number
  p?: number
  /** Other volScalarFieldValue entries (e.g. alpha.water), by field name. */
  scalars: Record<string, number>
}
export type FoamSetFields = {
  /** defaultFieldValues applied everywhere a region does not override. */
  defaults: FoamFieldValues
  /** boxToCell regions: axis-aligned box plus the field values set inside it. */
  regions: { box: [[number, number, number], [number, number, number]]; values: FoamFieldValues }[]
}

function fieldValuesOf(list: FoamValue | undefined, what: string): FoamFieldValues {
  if (!Array.isArray(list)) throw new Error(`OpenFOAM dict: expected field-value list ${what}`)
  const out: FoamFieldValues = { scalars: {} }
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (typeof item !== 'string' || !/^vol(Scalar|Vector)FieldValue$/.test(item)) continue
    // Two surface forms: `volVectorFieldValue U (0 0 0)` parses as
    // {U: [..]}, while `volScalarFieldValue T 300` stays three bare items.
    const next = list[++i]
    let field: string | undefined
    let value: FoamValue | undefined
    if (typeof next === 'string') {
      field = next
      value = list[++i]
    } else if (typeof next === 'object' && next !== null && !Array.isArray(next)) {
      ;[field, value] = Object.entries(next)[0] ?? []
    }
    if (field === 'U') out.U = foamVector(value, `${what}.U`)
    else if (field === 'T') out.T = foamNumber(value, `${what}.T`)
    else if (field === 'p') out.p = foamNumber(value, `${what}.p`)
    else if (typeof field === 'string' && /^[\w.]+$/.test(field)) {
      out.scalars[field] = foamNumber(value, `${what}.${field}`)
    } else {
      throw new Error(`OpenFOAM dict: unsupported ${what} field '${String(field)}'`)
    }
  }
  return out
}

/** setFieldsDict subset: defaultFieldValues + boxToCell regions (U/T/p only). */
export function parseOpenFoamSetFields(text: string): FoamSetFields {
  const top = foamEntries(parseOpenFoamDict(text))
  const defaults = fieldValuesOf(top.get('defaultFieldValues'), 'defaultFieldValues')
  const regionsList = top.get('regions')
  const regions: FoamSetFields['regions'] = []
  if (regionsList !== undefined) {
    if (!Array.isArray(regionsList)) throw new Error('OpenFOAM dict: regions must be a list')
    for (const item of regionsList) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const [name, dict] = Object.entries(item)[0] ?? []
      if (name !== 'boxToCell' || !dict) {
        throw new Error(`OpenFOAM dict: unsupported regions entry '${String(name)}'`)
      }
      const entries = foamEntries(foamDict(dict, `regions.${name}`))
      const box = entries.get('box')
      if (!Array.isArray(box) || box.length !== 2) {
        throw new Error('OpenFOAM dict: boxToCell needs two corner vectors')
      }
      regions.push({
        box: [foamVector(box[0], 'box.min'), foamVector(box[1], 'box.max')],
        values: fieldValuesOf(entries.get('fieldValues'), 'boxToCell.fieldValues'),
      })
    }
  }
  return { defaults, regions }
}

export type FoamThermo = {
  equationOfState: string
  /** kg/mol (molWeight is g/mol in OpenFOAM). */
  molWeightKgPerMol: number
  /** J/(kg·K). */
  cp: number
  /** Dynamic viscosity Pa·s (0 = inviscid). */
  mu: number
}

/** Thermophysical mixture subset: perfect-gas EOS, molWeight, Cp, mu. */
export function parseOpenFoamThermo(text: string): FoamThermo {
  const top = foamEntries(parseOpenFoamDict(text))
  const thermo = foamEntries(foamDict(top.get('thermoType'), 'thermoType'))
  const eos = thermo.get('equationOfState')
  if (typeof eos !== 'string') throw new Error('OpenFOAM dict: missing thermoType.equationOfState')
  const mixture = foamEntries(foamDict(top.get('mixture'), 'mixture'))
  const specie = foamEntries(foamDict(mixture.get('specie'), 'mixture.specie'))
  const thermodynamics = foamEntries(foamDict(mixture.get('thermodynamics'), 'mixture.thermodynamics'))
  const transport = foamEntries(foamDict(mixture.get('transport'), 'mixture.transport'))
  return {
    equationOfState: eos,
    molWeightKgPerMol: foamNumber(specie.get('molWeight'), 'mixture.specie.molWeight') * 1e-3,
    cp: foamNumber(thermodynamics.get('Cp'), 'mixture.thermodynamics.Cp'),
    mu: foamNumber(transport.get('mu'), 'mixture.transport.mu'),
  }
}

/** uniformDimensionedVectorField subset: the `value` vector (e.g. constant/g). */
export function parseOpenFoamUniformVector(text: string): [number, number, number] {
  const top = foamEntries(parseOpenFoamDict(text))
  return foamVector(top.get('value'), 'value')
}

export type FoamPhase = {
  name: string
  transportModel: string
  /** Kinematic viscosity m²/s. */
  nu: number
  /** Density kg/m³. */
  rho: number
}

export type FoamTwoPhaseTransport = {
  phases: [FoamPhase, FoamPhase]
  /** Surface tension N/m. */
  sigma: number
}

/**
 * Two-phase transportProperties subset (interFoam family):
 * `phases (a b)` plus per-phase { transportModel, nu, rho } dicts and `sigma`.
 */
export function parseOpenFoamTwoPhaseTransport(text: string): FoamTwoPhaseTransport {
  const top = foamEntries(parseOpenFoamDict(text))
  const phaseNames = top.get('phases')
  if (!Array.isArray(phaseNames) || phaseNames.length !== 2 || !phaseNames.every((p) => typeof p === 'string')) {
    throw new Error('OpenFOAM dict: expected `phases (nameA nameB)`')
  }
  const phases = phaseNames.map((name) => {
    const entries = foamEntries(foamDict(top.get(name as string), `phase ${String(name)}`))
    return {
      name: name as string,
      transportModel: String(entries.get('transportModel') ?? ''),
      nu: foamNumber(entries.get('nu'), `${String(name)}.nu`),
      rho: foamNumber(entries.get('rho'), `${String(name)}.rho`),
    }
  }) as [FoamPhase, FoamPhase]
  return { phases, sigma: foamNumber(top.get('sigma'), 'sigma') }
}
