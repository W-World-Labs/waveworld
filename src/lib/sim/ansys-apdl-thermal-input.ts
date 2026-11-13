import {
  validateAnsysThermalStudyInput,
  type AnsysThermalStudyInput,
} from './ansys-thermal-study-input'

const MAX_TEXT_BYTES = 65_536
const MAX_COMMANDS = 2_048
const MAX_NODES = 256
const MAX_ELEMENTS = 255
const MAX_NUMERIC_MAGNITUDE = 1e12

type NodeRecord = { label: number; x: number }
type ElementRecord = { label: number; first: number; second: number }

export type AnsysApdlThermalImport = {
  sourceText: string
  input: AnsysThermalStudyInput
  externalNodeLabels: number[]
  summary: { nodeCount: number; elementCount: number; areaM2: number; conductivityWPerMK: number }
}

function fail(message: string): never {
  throw new Error(`Invalid Ansys APDL thermal input: ${message}`)
}

function parseNumber(token: string, name: string): number {
  // APDL's decimal/scientific literal form only. This deliberately excludes
  // expressions, parameter names, and command substitution.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(token)) {
    fail(`${name} must be a numeric literal`)
  }
  const value = Number(token)
  if (!Number.isFinite(value) || Math.abs(value) > MAX_NUMERIC_MAGNITUDE) {
    fail(`${name} exceeds the numeric magnitude limit`)
  }
  return value
}

function parseInteger(token: string, name: string): number {
  const value = parseNumber(token, name)
  if (!Number.isSafeInteger(value)) fail(`${name} must be a safe integer`)
  return value
}

function exactFieldCount(fields: string[], count: number, command: string): void {
  if (fields.length !== count) fail(`${command} requires exactly ${count - 1} field${count === 2 ? '' : 's'}`)
}

function requireLiteral(fields: string[], index: number, expected: string, command: string): void {
  if (fields[index]?.toUpperCase() !== expected) fail(`${command} supports only ${expected} in field ${index + 1}`)
}

/** Parse the bounded literal APDL subset used by the Ansys thermal bar importer. */
export function parseAnsysApdlThermalInput(source: string): AnsysApdlThermalImport {
  if (typeof source !== 'string') fail('source must be text')
  if (new TextEncoder().encode(source).byteLength > MAX_TEXT_BYTES) fail(`file exceeds ${MAX_TEXT_BYTES} bytes`)

  const nodesByLabel = new Map<number, NodeRecord>()
  const elements: ElementRecord[] = []
  const fixedTemperatures = new Map<number, number>()
  const heatLoads = new Map<number, number>()
  let area: number | undefined
  let conductivity: number | undefined
  let sawElementType = false
  let mode: 'outside' | 'prep' | 'solution' = 'outside'
  let sawPrep = false
  let sawSolution = false
  let sawStatic = false
  let selectedType = false
  let selectedReal = false
  let selectedMaterial = false
  let sawSolve = false
  let commandCount = 0

  const lines = source.split(/\r\n|\n|\r/)
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineNumber = lineIndex + 1
    const line = lines[lineIndex]
    const uncommented = line.split('!', 1)[0].trim()
    if (!uncommented) continue
    commandCount += 1
    if (commandCount > MAX_COMMANDS) fail(`command count exceeds ${MAX_COMMANDS}`)

    const fields = uncommented.split(',').map((field) => field.trim())
    if (fields.some((field) => field.length === 0)) fail(`line ${lineNumber} contains an empty command field`)
    const command = fields[0].toUpperCase()
    const lineError = (message: string): never => fail(`line ${lineNumber}: ${message}`)

    try {
      if (sawSolve && command !== 'FINISH') fail('no commands are supported after SOLVE')
      if (command === '/PREP7') {
        exactFieldCount(fields, 1, '/PREP7')
        if (mode !== 'outside' || sawPrep) fail('/PREP7 must appear once before model definitions')
        mode = 'prep'
        sawPrep = true
      } else if (command === '/SOLU') {
        exactFieldCount(fields, 1, '/SOLU')
        if (mode !== 'outside' || !sawPrep || sawSolution) fail('/SOLU must follow the completed /PREP7 section')
        mode = 'solution'
        sawSolution = true
      } else if (command === 'FINISH') {
        exactFieldCount(fields, 1, 'FINISH')
        if (mode !== 'prep' && mode !== 'solution') fail('FINISH must close an active APDL section')
        mode = 'outside'
      } else if (command === 'ANTYPE') {
        if (mode !== 'solution' && mode !== 'prep') fail('ANTYPE is allowed only in /PREP7 or /SOLU')
        exactFieldCount(fields, 2, 'ANTYPE')
        requireLiteral(fields, 1, 'STATIC', 'ANTYPE')
        if (sawStatic) fail('only one ANTYPE,STATIC command is supported')
        sawStatic = true
      } else if (command === 'ET') {
        if (mode !== 'prep') fail('ET is allowed only in /PREP7')
        exactFieldCount(fields, 3, 'ET')
        if (parseInteger(fields[1], 'element type ID') !== 1) fail('only element type 1 is supported')
        requireLiteral(fields, 2, 'LINK33', 'ET')
        if (sawElementType) fail('only one element type definition is supported')
        sawElementType = true
      } else if (command === 'R') {
        if (mode !== 'prep') fail('R is allowed only in /PREP7')
        exactFieldCount(fields, 3, 'R')
        if (parseInteger(fields[1], 'real constant ID') !== 1) fail('only real constant set 1 is supported')
        if (area !== undefined) fail('only one area definition is supported')
        area = parseNumber(fields[2], 'cross-section area')
      } else if (command === 'MP') {
        if (mode !== 'prep') fail('MP is allowed only in /PREP7')
        exactFieldCount(fields, 4, 'MP')
        requireLiteral(fields, 1, 'KXX', 'MP')
        if (parseInteger(fields[2], 'material ID') !== 1) fail('only material 1 is supported')
        if (conductivity !== undefined) fail('only one conductivity definition is supported')
        conductivity = parseNumber(fields[3], 'conductivity')
      } else if (command === 'N') {
        if (mode !== 'prep') fail('N is allowed only in /PREP7')
        exactFieldCount(fields, 5, 'N')
        if (nodesByLabel.size >= MAX_NODES) fail(`node count exceeds ${MAX_NODES}`)
        const label = parseInteger(fields[1], 'node label')
        if (label <= 0 || nodesByLabel.has(label)) fail('node labels must be unique positive integers')
        const x = parseNumber(fields[2], 'node x coordinate')
        const y = parseNumber(fields[3], 'node y coordinate')
        const z = parseNumber(fields[4], 'node z coordinate')
        if (y !== 0 || z !== 0) fail('only nodes on the x-axis (y=z=0) are supported')
        nodesByLabel.set(label, { label, x })
      } else if (command === 'E' || command === 'EN') {
        if (mode !== 'prep') fail(`${command} is allowed only in /PREP7`)
        if (!sawElementType || area === undefined || conductivity === undefined || !selectedType || !selectedReal || !selectedMaterial) {
          fail('ET,1,LINK33, R,1,area, MP,KXX,1,conductivity and TYPE/REAL/MAT,1 must precede elements')
        }
        if (elements.length >= MAX_ELEMENTS) fail(`element count exceeds ${MAX_ELEMENTS}`)
        const explicit = command === 'EN'
        exactFieldCount(fields, explicit ? 4 : 3, command)
        const label = explicit
          ? parseInteger(fields[1], 'element label')
          : (elements.reduce((max, element) => Math.max(max, element.label), 0) + 1)
        const offset = explicit ? 2 : 1
        const first = parseInteger(fields[offset], 'element first node label')
        const second = parseInteger(fields[offset + 1], 'element second node label')
        if (label <= 0 || elements.some((element) => element.label === label)) fail('element labels must be unique positive integers')
        elements.push({ label, first, second })
      } else if (command === 'TYPE' || command === 'REAL' || command === 'MAT') {
        if (mode !== 'prep') fail(`${command} is allowed only in /PREP7`)
        exactFieldCount(fields, 2, command)
        if (parseInteger(fields[1], `${command} reference`) !== 1) fail(`only ${command.toLowerCase()} set 1 is supported`)
        if (command === 'TYPE') selectedType = true
        if (command === 'REAL') selectedReal = true
        if (command === 'MAT') selectedMaterial = true
      } else if (command === 'D') {
        if (mode !== 'solution') fail('D is allowed only in /SOLU')
        if (!sawStatic) fail('ANTYPE,STATIC must precede thermal loads')
        exactFieldCount(fields, 4, 'D')
        const node = parseInteger(fields[1], 'temperature boundary node')
        requireLiteral(fields, 2, 'TEMP', 'D')
        const temperature = parseNumber(fields[3], 'temperature')
        if (fixedTemperatures.has(node)) fail('duplicate temperature boundary condition')
        fixedTemperatures.set(node, temperature)
      } else if (command === 'F') {
        if (mode !== 'solution') fail('F is allowed only in /SOLU')
        if (!sawStatic) fail('ANTYPE,STATIC must precede thermal loads')
        exactFieldCount(fields, 4, 'F')
        const node = parseInteger(fields[1], 'heat-load node')
        requireLiteral(fields, 2, 'HEAT', 'F')
        const heat = parseNumber(fields[3], 'nodal heat')
        if (heatLoads.has(node)) fail('duplicate nodal heat load')
        heatLoads.set(node, heat)
      } else if (command === 'SOLVE') {
        if (mode !== 'solution') fail('SOLVE is allowed only in /SOLU')
        if (!sawStatic) fail('SOLVE requires ANTYPE,STATIC')
        exactFieldCount(fields, 1, 'SOLVE')
        if (sawSolve) fail('only one SOLVE command is supported')
        sawSolve = true
      } else {
        fail(`unsupported command ${fields[0]}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Add a line number once, while retaining the specific failure reason.
      if (message.startsWith('Invalid Ansys APDL thermal input: line ')) throw error
      lineError(message.replace(/^Invalid Ansys APDL thermal input: /, ''))
    }
  }

  if (!sawPrep || !sawSolution || mode !== 'outside') fail('input must contain completed /PREP7 and /SOLU sections')
  if (!sawStatic) fail('input must contain ANTYPE,STATIC')
  if (!sawSolve) fail('input must contain SOLVE')
  if (!sawElementType || area === undefined || conductivity === undefined) fail('input must define ET,1,LINK33; R,1,area; and MP,KXX,1,conductivity')
  if (nodesByLabel.size < 2) fail('input must define between 2 and 256 nodes')
  if (elements.length !== nodesByLabel.size - 1) fail('elements must form a connected chain across all nodes')

  const orderedNodes = [...nodesByLabel.values()].sort((a, b) => a.x - b.x)
  for (let i = 1; i < orderedNodes.length; i += 1) {
    if (!(orderedNodes[i].x > orderedNodes[i - 1].x)) fail('node x coordinates must be strictly increasing and unique')
  }
  const orderedLabels = orderedNodes.map((node) => node.label)
  const labelToIndex = new Map(orderedLabels.map((label, index) => [label, index]))
  const adjacency = new Set<string>()
  for (const element of elements) {
    const first = labelToIndex.get(element.first)
    const second = labelToIndex.get(element.second)
    if (first === undefined || second === undefined) fail('every element must reference defined nodes')
    if (Math.abs(first - second) !== 1) fail('elements must connect adjacent nodes in geometric order')
    const edge = `${Math.min(first, second)}:${Math.max(first, second)}`
    if (adjacency.has(edge)) fail('duplicate elements are not supported')
    adjacency.add(edge)
  }
  for (let i = 0; i < orderedNodes.length - 1; i += 1) {
    if (!adjacency.has(`${i}:${i + 1}`)) fail('elements must connect the complete adjacent node chain')
  }

  if (fixedTemperatures.size !== 2 || !fixedTemperatures.has(orderedLabels[0]) || !fixedTemperatures.has(orderedLabels[orderedLabels.length - 1])) {
    fail('both geometric endpoint nodes must have fixed TEMP boundary conditions')
  }
  for (const label of [...fixedTemperatures.keys(), ...heatLoads.keys()]) {
    if (!nodesByLabel.has(label)) fail(`boundary condition references undefined node ${label}`)
  }

  const inputValue = {
    module: 'sw-ansys-thermal-fem',
    backend: 'host',
    analysis: 'steady',
    dimension: 1,
    mesh: {
      element: 'bar',
      nodes: orderedNodes.map(({ x }) => [x]),
      elements: orderedNodes.slice(0, -1).map((_, index) => [index, index + 1]),
    },
    conductivity,
    thickness: area,
    dirichlet: [
      { node: 0, temperature: fixedTemperatures.get(orderedLabels[0]) },
      { node: orderedNodes.length - 1, temperature: fixedTemperatures.get(orderedLabels[orderedLabels.length - 1]) },
    ],
    ...(heatLoads.size > 0 ? {
      sources: orderedLabels.map((label) => heatLoads.get(label) ?? 0),
    } : {}),
  }
  const input = validateAnsysThermalStudyInput(inputValue)
  return {
    sourceText: source,
    input,
    externalNodeLabels: orderedLabels,
    summary: {
      nodeCount: orderedNodes.length,
      elementCount: elements.length,
      areaM2: area,
      conductivityWPerMK: conductivity,
    },
  }
}
