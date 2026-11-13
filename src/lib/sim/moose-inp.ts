/**
 * Strict subset interpreter for MOOSE input files (hit-format INI syntax).
 * Scope: 2-D GeneratedMesh + a single first-order Lagrange variable, one
 * `Diffusion` kernel, DirichletBC/NeumannBC on the four named sidesets,
 * Steady executioner. This covers MOOSE's canonical diffusion tutorial
 * (e.g. test/tests/kernels/simple_diffusion) and nothing else — any
 * out-of-subset syntax fails closed with a named error instead of being
 * silently ignored.
 *
 * MOOSE semantics honoured here:
 *  - A side set with no BC block gets the natural (zero-flux) condition.
 *  - `inactive =` removes a named sub-block; `active =` restricts the set.
 */

export const MOOSE_INP_MAX_BYTES = 64 * 1024

type Block = { name: string; params: Map<string, string>; blocks: Block[] }
const OUTPUT_BLOCKS = new Set(['outputs', 'reporters', 'vectorpostprocessors'])
const IGNORED_BLOCKS = new Set(['problem']) // parse-checked, carries no physics in our subset
const SECTIONS = new Set(['mesh', 'variables', 'kernels', 'bcs', 'materials', 'functions', 'postprocessors', 'executioner', ...IGNORED_BLOCKS, ...OUTPUT_BLOCKS])

// Function declaration (not a const arrow) so definite-assignment analysis
// treats calls as terminal — never-returning const expressions don't count.
function fail(msg: string): never { throw new Error(`MOOSE input: ${msg}`) }

const num = (v: string | undefined, what: string, def?: number): number => {
  if (v === undefined) {
    if (def !== undefined) return def
    fail(`missing required parameter '${what}'`)
  }
  const n = Number(v)
  if (!Number.isFinite(n)) fail(`parameter '${what}' must be a number, got '${v}'`)
  return n
}

const int = (v: string | undefined, what: string): number => {
  const n = num(v, what)
  if (!Number.isInteger(n) || n <= 0) fail(`parameter '${what}' must be a positive integer, got '${v}'`)
  return n
}

const blockParam = (b: Block, key: string): string | undefined => {
  const v = b.params.get(key.toLowerCase())
  return v === undefined ? undefined : v.trim().replace(/^['"]|['"]$/g, '')
}

const requireParam = (b: Block, key: string, where: string): string => {
  const v = blockParam(b, key)
  if (v === undefined || v === '') fail(`${where}: missing '${key}'`)
  return v
}

const requireType = (b: Block, where: string): string =>
  requireParam(b, 'type', where)

// ---------------------------------------------------------------- hit syntax

const parseBlocks = (source: string): Block[] => {
  if (source.length > MOOSE_INP_MAX_BYTES) fail(`input exceeds ${MOOSE_INP_MAX_BYTES} bytes`)
  const roots: Block[] = []
  const stack: Block[] = []
  const top = (): Block => stack[stack.length - 1]!
  const push = (name: string) => {
    const b: Block = { name, params: new Map(), blocks: [] }
    const parent = stack.length ? top() : null
    ;(parent ? parent.blocks : roots).push(b)
    stack.push(b)
  }

  for (const rawLine of source.split('\n')) {
    // MOOSE comments: '#' and '!' (and '//' at line start / after tokens).
    let line = rawLine
    const hash = line.indexOf('#')
    if (hash >= 0) line = line.slice(0, hash)
    const bang = line.indexOf('!')
    if (bang >= 0) line = line.slice(0, bang)
    line = line.trim()
    if (line === '' || line.startsWith('//')) continue

    // hit syntax: `[]` or `[../]` close the innermost block; `[./name]` and
    // bare `[name]` open a child of the open block (top-level if none open).
    if (line === '[]' || line === '[../]' || line === '[./]') {
      if (!stack.length) fail(`block close '${line}' with no open block`)
      stack.pop()
      continue
    }
    const open = line.match(/^\[(?:\.\/)?([A-Za-z_][A-Za-z0-9_-]*)\]$/)
    if (open) {
      push(open[1]!.toLowerCase())
      continue
    }
    if (line.startsWith('[')) fail(`malformed block header '${line}'`)
    const eq = line.indexOf('=')
    if (eq < 0) fail(`expected 'key = value' or block header, got '${line}'`)
    const key = line.slice(0, eq).trim().toLowerCase()
    if (!/^[a-z_][a-z0-9_]*$/.test(key)) fail(`malformed parameter name '${key}'`)
    if (!stack.length) fail(`parameter '${key}' outside any block`)
    top().params.set(key, line.slice(eq + 1).trim())
  }
  if (stack.length) fail(`unclosed block '${top().name}'`)
  return roots
}

// Block activation: `inactive = 'a b'` disables sub-blocks a and b;
// `active = 'a'` keeps only a. Applied by pruning, before interpretation.
const pruneInactive = (block: Block) => {
  const inactive = (blockParam(block, 'inactive') ?? '').split(/\s+/).filter(Boolean)
  const active = (blockParam(block, 'active') ?? '').split(/\s+/).filter(Boolean)
  block.params.delete('inactive')
  block.params.delete('active')
  block.blocks = block.blocks.filter(b =>
    (active.length === 0 || active.includes(b.name)) && !inactive.includes(b.name))
  for (const b of block.blocks) pruneInactive(b)
}

// ------------------------------------------------------- semantic extraction

// ------------------------------------------------- parsed-function subset
// Strict mini evaluator for MOOSE ParsedFunction expressions: numbers,
// t/x/y/z, pi, + - * / ^ ( ), and a whitelist of math functions.
// Anything else fails closed — no eval(), ever.

type Ast =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'neg'; a: Ast }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Ast; b: Ast }
  | { k: 'call'; fn: string; args: Ast[] }

const FN_ARITY: Record<string, number> = {
  sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1,
  exp: 1, log: 1, sqrt: 1, abs: 1, sinh: 1, cosh: 1, tanh: 1,
  pow: 2, atan2: 2, min: 2, max: 2,
}
const FN_IMPL: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, log: Math.log, sqrt: Math.sqrt, abs: Math.abs,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  pow: Math.pow, atan2: Math.atan2, min: Math.min, max: Math.max,
}

const tokenizeExpr = (src: string): string[] => {
  const tokens: string[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      const m = src.slice(i).match(/^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/)
      if (!m) fail(`malformed number in expression '${src}'`)
      tokens.push(m[0]); i += m[0].length; continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)
      tokens.push(m![0]); i += m![0].length; continue
    }
    if ('+-*/^(),'.includes(ch)) { tokens.push(ch); i++; continue }
    fail(`unsupported character '${ch}' in expression '${src}'`)
  }
  return tokens
}

const parseExprAst = (src: string, extraVars: ReadonlySet<string> = new Set()): Ast => {
  const tok = tokenizeExpr(src)
  let p = 0
  const peek = () => tok[p]
  const eat = (t?: string) => {
    if (t !== undefined && tok[p] !== t) fail(`expected '${t}' in expression '${src}'`)
    return tok[p++]
  }
  const primary = (): Ast => {
    const t = eat()
    if (t === undefined) fail(`unexpected end of expression '${src}'`)
    if (t === '(') { const e = additive(); eat(')'); return e }
    if (t === '-') return { k: 'neg', a: primary() }
    if (t === '+') return primary()
    if (/^[0-9.]/.test(t)) return { k: 'num', v: Number(t) }
    if (t === 'pi') return { k: 'num', v: Math.PI }
    if (['t', 'x', 'y', 'z'].includes(t) || extraVars.has(t)) return { k: 'var', name: t }
    if (peek() === '(') {
      eat('(')
      const args: Ast[] = []
      if (peek() !== ')') { args.push(additive()); while (peek() === ',') { eat(','); args.push(additive()) } }
      eat(')')
      const arity = FN_ARITY[t]
      if (arity === undefined) fail(`unsupported function '${t}' in expression '${src}'`)
      if (args.length !== arity) fail(`function '${t}' expects ${arity} args in '${src}'`)
      return { k: 'call', fn: t, args }
    }
    fail(`unsupported symbol '${t}' in expression '${src}'`)
  }
  const power = (): Ast => {
    const base = primary()
    if (peek() === '^') { eat('^'); return { k: 'bin', op: '^', a: base, b: power() } }
    return base
  }
  const term = (): Ast => {
    let a = power()
    while (peek() === '*' || peek() === '/') { const op = eat() as '*' | '/'; a = { k: 'bin', op, a, b: power() } }
    return a
  }
  const additive = (): Ast => {
    let a = term()
    while (peek() === '+' || peek() === '-') { const op = eat() as '+' | '-'; a = { k: 'bin', op, a, b: term() } }
    return a
  }
  const ast = additive()
  if (p !== tok.length) fail(`trailing tokens in expression '${src}'`)
  return ast
}

const evalAst = (ast: Ast, vars: Record<string, number>): number => {
  switch (ast.k) {
    case 'num': return ast.v
    case 'var': return vars[ast.name] ?? 0
    case 'neg': return -evalAst(ast.a, vars)
    case 'bin': {
      const a = evalAst(ast.a, vars), b = evalAst(ast.b, vars)
      return ast.op === '+' ? a + b : ast.op === '-' ? a - b
        : ast.op === '*' ? a * b : ast.op === '/' ? a / b : Math.pow(a, b)
    }
    case 'call': return FN_IMPL[ast.fn]!(...ast.args.map(x => evalAst(x, vars)))
  }
}

/** Parse a MOOSE ParsedFunction expression into (vars)=>number, fail-closed.
 *  `extraVars` whitelists additional symbols (ParsedFunction symbol_names). */
export const parseMooseFunction = (
  expr: string,
  extraVars: readonly string[] = [],
): ((vars: Record<string, number>) => number) => {
  const ast = parseExprAst(expr, new Set(extraVars))
  return (vars) => evalAst(ast, vars)
}

export type MooseBoundary = 'left' | 'right' | 'top' | 'bottom'
const BOUNDARY_NAMES_2D: Record<string, MooseBoundary> = {
  left: 'left', right: 'right', top: 'top', bottom: 'bottom',
  // GeneratedMesh side-set ids.
  '0': 'left', '1': 'bottom', '2': 'right', '3': 'top',
}
// GeneratedMesh dim=1: only left (0) and right (1) side sets exist.
const BOUNDARY_NAMES_1D: Record<string, MooseBoundary> = {
  left: 'left', right: 'right', '0': 'left', '1': 'right',
}

export type MooseExecutioner =
  | { type: 'steady' }
  | { type: 'transient'; dt: number; numSteps: number; endTime: number }

export type MooseBc =
  | { boundary: MooseBoundary; type: 'dirichlet'; value: number }
  | { boundary: MooseBoundary; type: 'neumann'; value: number }
  | { boundary: MooseBoundary; type: 'dirichlet-fn'; fn: (t: number) => number; expr: string }
  | { boundary: MooseBoundary; type: 'robin'; h: number; tInf: number }

// Omit is not distributive over unions; without this, Omit<MooseBc,…> would
// collapse to the shared keys only and drop each variant's payload.
type DistributiveOmit<T, K extends keyof any> =
  T extends unknown ? Omit<T, K> : never

export type MooseDiffusionCase = {
  mesh: { dim: 1 | 2; xmin: number; xmax: number; ymin: number; ymax: number; nx: number; ny: number }
  variable: string
  order: string
  initial: number
  /** coefficient multiplying ∇²u (1 for Diffusion, coef for
   *  CoefDiffusion, thermal_conductivity for HeatConduction) */
  diffusionCoef: number
  /** coefficient multiplying u_t (1 for TimeDerivative, density·specific_heat
   *  for HeatConductionTimeDerivative) — effective diffusivity is
   *  diffusionCoef/timeCoef */
  timeCoef: number
  /** volumetric source added to the PDE (HeatSource kernel `function`/`value`,
   *  constants only); 0 when absent */
  source: number
  /** true when a TimeDerivative-family kernel acts on the variable */
  transient: boolean
  materials?: { thermalConductivity: number; specificHeat: number; density: number }
  bcs: MooseBc[]
  /** node ids requested by NodalVariableValue postprocessors */
  probeNodes: number[]
  /** [Functions] ParsedFunction blocks, name → evaluator over {t,x,y,z,symbols} */
  functions: Map<string, (vars: Record<string, number>) => number>
  executioner: MooseExecutioner
}

const ALLOWED_PARAMS: Record<string, Set<string>> = {
  mesh: new Set(['type', 'dim', 'nx', 'ny', 'xmin', 'xmax', 'ymin', 'ymax', 'elem_type', 'parallel_type', 'partitioner', 'uniform_refine']),
  variables: new Set(['order', 'family', 'initial_condition', 'scaling']),
  kernels: new Set(['type', 'variable', 'block', 'displacements', 'coef', 'diffusion_coefficient', 'function', 'value', 'thermal_conductivity']),
  bcs: new Set(['type', 'variable', 'boundary', 'value', 'function', 'displacements', 't_infinity', 'heat_transfer_coefficient', 'heat_transfer_coefficient_dt', 'htc']),
  materials: new Set(['type', 'prop_names', 'prop_values', 'block']),
  functions: new Set(['type', 'symbol_names', 'symbol_values', 'expression', 'value']),
  problem: new Set(['type', 'extra_tag_vectors', 'kernel_coverage_check', 'coverage_check_list', 'solve', 'coord_type']),
  postprocessors: new Set(['type', 'variable', 'nodeid', 'boundary', 'execute_on', 'function', 'diffusivity']),
  executioner: new Set(['type', 'solve_type', 'petsc_options', 'petsc_options_iname', 'petsc_options_value', 'nl_rel_tol', 'nl_abs_tol', 'l_tol', 'l_max_its', 'nl_max_its', 'line_search', 'automatic_scaling', 'num_steps', 'dt', 'end_time', 'scheme', 'start_time']),
}

const checkParams = (b: Block, what: string) => {
  const allowed = ALLOWED_PARAMS[what]
  if (!allowed) return
  for (const k of b.params.keys()) {
    if (!allowed.has(k)) fail(`unsupported ${what} parameter '${k}'`)
  }
}

export const parseMooseDiffusionInput = (source: string): MooseDiffusionCase => {
  const roots = parseBlocks(source)
  for (const r of roots) pruneInactive(r)
  const sections = new Map<string, Block>()
  for (const r of roots) {
    if (!SECTIONS.has(r.name)) fail(`unsupported top-level block [${r.name}]`)
    if (sections.has(r.name)) fail(`duplicate top-level block [${r.name}]`)
    if (IGNORED_BLOCKS.has(r.name)) checkParams(r, r.name)
    sections.set(r.name, r)
  }

  // ---- Mesh -------------------------------------------------------------
  const meshB = sections.get('mesh')
  if (!meshB) fail('missing [Mesh] block')
  let meshNode: Block | null = null
  if (meshB.params.has('type')) {
    meshNode = meshB
  } else {
    // New-style: [Mesh]/[./gmg] GeneratedMeshGenerator sub-block.
    const gens = meshB.blocks.filter(b => {
      const t = (blockParam(b, 'type') ?? '').toLowerCase()
      return t === 'generatedmeshgenerator' || t === 'generatedmesh'
    })
    if (gens.length !== 1 || meshB.blocks.length !== 1) {
      fail('expected exactly one GeneratedMesh sub-block in [Mesh]')
    }
    meshNode = gens[0]!
  }
  const meshType = (blockParam(meshNode, 'type') ?? 'generatedmesh').toLowerCase()
  if (meshType !== 'generatedmesh' && meshType !== 'generatedmeshgenerator') {
    fail(`unsupported mesh type '${meshType}' (only GeneratedMesh)`)
  }
  checkParams(meshNode, 'mesh')
  const dim = int(blockParam(meshNode, 'dim'), 'dim')
  if (dim !== 1 && dim !== 2) fail(`only 1D/2D meshes (dim=${dim})`)
  const elemType = (blockParam(meshNode, 'elem_type') ?? (dim === 1 ? 'EDGE2' : 'QUAD4')).toUpperCase()
  if (elemType !== (dim === 1 ? 'EDGE2' : 'QUAD4')) {
    fail(`unsupported elem_type '${elemType}' (only ${dim === 1 ? 'EDGE2' : 'QUAD4'} for dim=${dim})`)
  }
  if (blockParam(meshNode, 'uniform_refine') !== undefined &&
      num(blockParam(meshNode, 'uniform_refine'), 'uniform_refine') !== 0) {
    fail('uniform_refine > 0 not supported')
  }
  const mesh = {
    dim: dim as 1 | 2,
    xmin: num(blockParam(meshNode, 'xmin'), 'xmin', 0),
    xmax: num(blockParam(meshNode, 'xmax'), 'xmax', 1),
    ymin: dim === 2 ? num(blockParam(meshNode, 'ymin'), 'ymin', 0) : 0,
    ymax: dim === 2 ? num(blockParam(meshNode, 'ymax'), 'ymax', 1) : 0,
    nx: blockParam(meshNode, 'nx') === undefined ? 1 : int(blockParam(meshNode, 'nx'), 'nx'),
    ny: dim === 2 ? (blockParam(meshNode, 'ny') === undefined ? 1 : int(blockParam(meshNode, 'ny'), 'ny')) : 1,
  }
  if (!(mesh.xmax > mesh.xmin) || (dim === 2 && !(mesh.ymax > mesh.ymin))) fail('degenerate mesh extent')
  if (mesh.nx * mesh.ny > 1_000_000) fail(`mesh ${mesh.nx}x${mesh.ny} exceeds subset limit`)

  // ---- Variables ----------------------------------------------------------
  const varB = sections.get('variables')
  if (!varB || varB.blocks.length !== 1) {
    fail('expected exactly one variable in [Variables]')
  }
  const variable = varB.blocks[0]!.name
  checkParams(varB.blocks[0]!, 'variables')
  const order = (blockParam(varB.blocks[0]!, 'order') ?? 'first').toUpperCase()
  if (order !== 'FIRST') fail(`only FIRST-order variables (order=${order})`)
  if ((blockParam(varB.blocks[0]!, 'family') ?? 'lagrange').toUpperCase() !== 'LAGRANGE') {
    fail('only LAGRANGE variables')
  }
  const initial = num(blockParam(varB.blocks[0]!, 'initial_condition'), 'initial_condition', 0)

  // ---- Materials -----------------------------------------------------------
  let materials: MooseDiffusionCase['materials']
  const matB = sections.get('materials')
  if (matB) {
    const KNOWN: Record<string, keyof NonNullable<typeof materials>> = {
      thermal_conductivity: 'thermalConductivity',
      specific_heat: 'specificHeat',
      density: 'density',
    }
    const found: Record<string, number> = {}
    for (const m of matB.blocks) {
      checkParams(m, 'materials')
      if (requireType(m, `[Materials/${m.name}]`).toLowerCase() !== 'genericconstantmaterial') {
        fail(`unsupported material type (only GenericConstantMaterial)`)
      }
      const names = requireParam(m, 'prop_names', `[Materials/${m.name}]`).split(/\s+/)
      const values = requireParam(m, 'prop_values', `[Materials/${m.name}]`).split(/\s+/)
      if (names.length !== values.length) {
        fail(`prop_names/prop_values length mismatch in [Materials/${m.name}]`)
      }
      for (let i = 0; i < names.length; i++) {
        const key = KNOWN[names[i]!.toLowerCase()]
        if (!key) fail(`unsupported material property '${names[i]}'`)
        if (found[key] !== undefined) fail(`duplicate material property '${names[i]}'`)
        found[key] = num(values[i], `[Materials/${m.name}].prop_values[${names[i]}]`)
      }
    }
    if (found.thermalConductivity !== undefined || found.specificHeat !== undefined ||
        found.density !== undefined) {
      if (found.thermalConductivity === undefined || found.specificHeat === undefined ||
          found.density === undefined) {
        fail('materials must define thermal_conductivity, specific_heat and density together')
      }
      materials = found as NonNullable<typeof materials>
      if (!(materials.thermalConductivity > 0 && materials.specificHeat > 0 && materials.density > 0)) {
        fail('material properties must be positive')
      }
    }
  }

  // ---- Functions (ParsedFunction → evaluator over {t,x,y,z,symbols}) --------
  const functions = new Map<string, (vars: Record<string, number>) => number>()
  const fnB = sections.get('functions')
  if (fnB) {
    for (const f of fnB.blocks) {
      checkParams(f, 'functions')
      const ftype = requireType(f, `[Functions/${f.name}]`).toLowerCase()
      if (ftype === 'parsedfunction') {
        const names = (blockParam(f, 'symbol_names') ?? '').split(/\s+/).filter(Boolean)
        const values = (blockParam(f, 'symbol_values') ?? '').split(/\s+/).filter(Boolean)
        if (names.length !== values.length) {
          fail(`[Functions/${f.name}] symbol_names/symbol_values length mismatch`)
        }
        const symbols = values.map(v => num(v, `[Functions/${f.name}].symbol_values`))
        const expr = requireParam(f, 'expression', `[Functions/${f.name}]`)
        const fn = parseMooseFunction(expr, names)
        functions.set(f.name, (vars) => {
          const env: Record<string, number> = { ...vars }
          names.forEach((n, i) => { env[n] = symbols[i]! })
          return fn(env)
        })
      } else if (ftype === 'constantfunction') {
        const v = num(blockParam(f, 'value'), `[Functions/${f.name}].value`)
        functions.set(f.name, () => v)
      } else {
        fail(`unsupported function type '${ftype}' (only ParsedFunction/ConstantFunction)`)
      }
    }
  }

  // ---- Kernels ------------------------------------------------------------
  const kerB = sections.get('kernels')
  if (!kerB || kerB.blocks.length === 0) fail('missing [Kernels] sub-block')
  let diffusionCoef: number | null = null
  let timeCoef = 1
  let volSource = 0 // volumetric PDE source (HeatSource kernel)
  let transient = false
  for (const kernel of kerB.blocks) {
    checkParams(kernel, 'kernels')
    const ktype = requireType(kernel, `[Kernels/${kernel.name}]`).toLowerCase()
    if ((blockParam(kernel, 'variable') ?? variable) !== variable) {
      fail(`kernel acts on '${blockParam(kernel, 'variable')}', expected '${variable}'`)
    }
    if (ktype === 'diffusion' || ktype === 'coefdiffusion' || ktype === 'heatconduction') {
      if (diffusionCoef !== null) fail('multiple diffusion kernels')
      if (ktype === 'coefdiffusion') {
        diffusionCoef = num(blockParam(kernel, 'coef'), `[Kernels/${kernel.name}].coef`)
      } else if (ktype === 'heatconduction') {
        if (kernel.params.has('diffusion_coefficient')) {
          fail('HeatConduction diffusion_coefficient overrides not supported')
        }
        const tk = blockParam(kernel, 'thermal_conductivity')
        if (tk !== undefined) {
          diffusionCoef = num(tk, `[Kernels/${kernel.name}].thermal_conductivity`)
        } else {
          if (!materials) fail('HeatConduction requires thermal_conductivity (kernel param or [Materials])')
          diffusionCoef = materials.thermalConductivity
        }
      } else {
        diffusionCoef = 1
      }
      if (!(diffusionCoef > 0)) fail(`non-positive diffusion coefficient ${diffusionCoef}`)
    } else if (ktype === 'timederivative' || ktype === 'heatconductiontimederivative') {
      if (transient) fail('multiple TimeDerivative kernels')
      transient = true
      if (ktype === 'heatconductiontimederivative') {
        if (!materials) fail('HeatConductionTimeDerivative requires [Materials] density+specific_heat')
        timeCoef = materials.density * materials.specificHeat
      }
    } else if (ktype === 'heatsource') {
      if (volSource !== 0) fail('multiple HeatSource kernels')
      const fv = blockParam(kernel, 'function') ?? blockParam(kernel, 'value')
      if (fv === undefined) fail(`[Kernels/${kernel.name}] needs function or value`)
      if (functions.has(fv)) {
        const fn = functions.get(fv)!
        const probe = fn({ t: 0, x: 0, y: 0, z: 0 })
        const probe2 = fn({ t: 1, x: 1, y: 1, z: 1 })
        if (probe !== probe2) fail(`[Kernels/${kernel.name}] non-constant source function '${fv}'`)
        volSource = probe
      } else {
        volSource = num(fv, `[Kernels/${kernel.name}].function`)
      }
    } else {
      fail(`unsupported kernel type '${ktype}' (only Diffusion/CoefDiffusion/HeatConduction/TimeDerivative/HeatSource)`)
    }
  }
  if (diffusionCoef === null) fail('no diffusion kernel found')

  // ---- BCs ----------------------------------------------------------------
  const bcs: MooseDiffusionCase['bcs'] = []
  const seen = new Set<MooseBoundary>()
  const boundaryNames = dim === 1 ? BOUNDARY_NAMES_1D : BOUNDARY_NAMES_2D
  const bcsB = sections.get('bcs')
  if (bcsB) {
    for (const bc of bcsB.blocks) {
      checkParams(bc, 'bcs')
      const type = requireType(bc, `[BCs/${bc.name}]`).toLowerCase()
      if (type !== 'dirichletbc' && type !== 'neumannbc' && type !== 'functiondirichletbc' &&
          type !== 'convectiveheatfluxbc' && type !== 'coupledconvectiveheatfluxbc') {
        fail(`unsupported BC type '${type}' (only DirichletBC/NeumannBC/FunctionDirichletBC/ConvectiveHeatFluxBC/CoupledConvectiveHeatFluxBC)`)
      }
      if ((blockParam(bc, 'variable') ?? variable) !== variable) {
        fail(`BC '${bc.name}' acts on '${blockParam(bc, 'variable')}', expected '${variable}'`)
      }
      const names = requireParam(bc, 'boundary', `[BCs/${bc.name}]`).split(/\s+/)
      let entry: DistributiveOmit<MooseBc, 'boundary'>
      if (type === 'functiondirichletbc') {
        if (bc.params.has('value')) fail(`FunctionDirichletBC '${bc.name}' cannot set value`)
        const expr = requireParam(bc, 'function', `[BCs/${bc.name}]`)
        const fn = parseMooseFunction(expr)
        entry = { type: 'dirichlet-fn', fn: (t) => fn({ t }), expr }
      } else if (type === 'convectiveheatfluxbc' || type === 'coupledconvectiveheatfluxbc') {
        // −k ∂u/∂n = h·(u − T∞). heat_transfer_coefficient_dT is a Jacobian
        // perturbation hook; only the value-0 form maps to a Robin BC.
        // CoupledConvectiveHeatFluxBC normally reads htc from a coupled
        // variable; with a literal htc + T_infinity it is the same Robin BC.
        const dT = num(blockParam(bc, 'heat_transfer_coefficient_dt'), 'heat_transfer_coefficient_dT', 0)
        if (dT !== 0) fail(`ConvectiveHeatFluxBC '${bc.name}' heat_transfer_coefficient_dT must be 0`)
        entry = {
          type: 'robin',
          h: num(blockParam(bc, type === 'coupledconvectiveheatfluxbc' ? 'htc' : 'heat_transfer_coefficient'),
            `[BCs/${bc.name}].htc`),
          tInf: num(blockParam(bc, 't_infinity'), `[BCs/${bc.name}].t_infinity`),
        }
      } else {
        if (bc.params.has('function')) fail(`BC '${bc.name}' uses a function value (not supported)`)
        const value = num(blockParam(bc, 'value'), `[BCs/${bc.name}].value`)
        entry = { type: type === 'dirichletbc' ? 'dirichlet' : 'neumann', value }
      }
      for (const raw of names) {
        const side = boundaryNames[raw.toLowerCase()]
        if (!side) fail(`unknown boundary '${raw}' (expected left/right${dim === 2 ? '/top/bottom' : ''})`)
        if (seen.has(side)) fail(`duplicate BC on boundary '${side}'`)
        seen.add(side)
        bcs.push({ ...entry, boundary: side })
      }
    }
  }

  // ---- Postprocessors (probe locations only — output is not simulated) -----
  const probeNodes: number[] = []
  const IGNORED_PP = new Set(['elementl2error', 'averageelementsize', 'sidediffusivefluxaverage'])
  const ppB = sections.get('postprocessors')
  if (ppB) {
    for (const pp of ppB.blocks) {
      checkParams(pp, 'postprocessors')
      const ptype = requireType(pp, `[Postprocessors/${pp.name}]`).toLowerCase()
      if (IGNORED_PP.has(ptype)) continue // reference-output helpers, not simulated
      if (ptype !== 'nodalvariablevalue') {
        fail(`unsupported postprocessor type (only NodalVariableValue)`)
      }
      if ((blockParam(pp, 'variable') ?? variable) !== variable) {
        fail(`postprocessor '${pp.name}' acts on '${blockParam(pp, 'variable')}', expected '${variable}'`)
      }
      probeNodes.push(int(blockParam(pp, 'nodeid'), `[Postprocessors/${pp.name}].nodeid`))
    }
  }

  // ---- Executioner --------------------------------------------------------
  const exB = sections.get('executioner')
  if (!exB) fail('missing [Executioner] block')
  checkParams(exB, 'executioner')
  const exType = requireType(exB, '[Executioner]').toLowerCase()
  let executioner: MooseExecutioner
  if (exType === 'steady') {
    if (transient) fail('TimeDerivative kernel with a Steady executioner')
    executioner = { type: 'steady' }
  } else if (exType === 'transient') {
    // No TimeDerivative kernel → each step solves the stationary problem
    // (MOOSE semantics); `transient=false` tells callers to map to a steady
    // solve instead of a marching one.
    if (blockParam(exB, 'scheme') !== undefined &&
        blockParam(exB, 'scheme') !== 'implicit-euler') {
      fail(`unsupported time scheme '${blockParam(exB, 'scheme')}'`)
    }
    if (blockParam(exB, 'start_time') !== undefined &&
        num(blockParam(exB, 'start_time'), 'start_time') !== 0) {
      fail('non-zero start_time not supported')
    }
    // dt defaults to 1 in MOOSE; irrelevant for a stationary run.
    const dt = num(blockParam(exB, 'dt'), 'dt', transient ? undefined : 1)
    if (!(dt > 0)) fail(`non-positive dt ${dt}`)
    const numSteps = blockParam(exB, 'num_steps') !== undefined
      ? int(blockParam(exB, 'num_steps'), 'num_steps')
      : undefined
    const endTime = blockParam(exB, 'end_time') !== undefined
      ? num(blockParam(exB, 'end_time'), 'end_time')
      : undefined
    if (numSteps === undefined && endTime === undefined) {
      fail('Transient executioner needs num_steps or end_time')
    }
    const steps = numSteps ?? Math.round(endTime! / dt)
    if (numSteps !== undefined && endTime !== undefined &&
        Math.abs(numSteps * dt - endTime) > 1e-9 * Math.max(1, endTime)) {
      fail(`inconsistent num_steps*dt (${numSteps * dt}) vs end_time (${endTime})`)
    }
    if (steps > 1_000_000) fail(`num_steps ${steps} exceeds subset limit`)
    executioner = { type: 'transient', dt, numSteps: steps, endTime: steps * dt }
  } else {
    fail(`unsupported executioner '${exType}' (only Steady/Transient)`)
  }

  // Output-only blocks: parsed (syntax validated by the INI pass) then ignored.
  return { mesh, variable, order, initial, diffusionCoef, timeCoef, source: volSource, transient, materials, bcs, probeNodes, functions, executioner }
}
