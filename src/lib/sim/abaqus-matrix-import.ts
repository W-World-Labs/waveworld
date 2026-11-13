/** Strict reader for literal Abaqus assembled symmetric STIF/MASS matrix exports. */

export type AbaqusMatrixStorage = 'lower' | 'upper' | 'full' | 'diagonal'

export type AbaqusMatrixImportResult =
  | {
      ok: true
      stiffness: number[][]
      mass: number[][]
      dofMap: { index: number; node: number; dof: number }[]
      stiffnessStorage: AbaqusMatrixStorage
      massStorage: AbaqusMatrixStorage
      stiffnessEntries: number
      massEntries: number
    }
  | { ok: false; diagnostics: string[] }

type Coordinate = { node: number; dof: number }
type Entry = Coordinate & { colNode: number; colDof: number; value: number }
type ParsedMatrix = { entries: Entry[]; storage: AbaqusMatrixStorage; coordinates: Coordinate[] }

const MAX_BYTES = 2 * 1024 * 1024
const MAX_LINES = 100_000
const MAX_DOFS = 16

function coordinateKey(node: number, dof: number): string {
  return `${node}:${dof}`
}

function compareCoordinate(a: Coordinate, b: Coordinate): number {
  return a.node - b.node || a.dof - b.dof
}

function parseMatrix(text: string, label: string): ParsedMatrix {
  if (typeof text !== 'string') throw new Error(`${label}: input must be text`)
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error(`${label}: input exceeds ${MAX_BYTES} bytes`)
  const lines = text.split(/\r?\n/)
  if (lines.length > MAX_LINES) throw new Error(`${label}: input exceeds ${MAX_LINES} lines`)

  const entries: Entry[] = []
  const seen = new Set<string>()
  const coordinateSet = new Map<string, Coordinate>()
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim()
    if (line === '') continue
    const fields = line.split(',').map((field) => field.trim())
    if (fields.length !== 5) throw new Error(`${label}: line ${lineIndex + 1} must contain exactly five CSV fields`)
    const [nodeText, dofText, colNodeText, colDofText, valueText] = fields
    const node = Number(nodeText)
    const dof = Number(dofText)
    const colNode = Number(colNodeText)
    const colDof = Number(colDofText)
    const value = Number(valueText)
    if (!/^\d+$/.test(nodeText) || !Number.isSafeInteger(node) || node <= 0 ||
        !/^\d+$/.test(colNodeText) || !Number.isSafeInteger(colNode) || colNode <= 0) {
      throw new Error(`${label}: line ${lineIndex + 1} node labels must be positive safe integers`)
    }
    if (!/^[1-6]$/.test(dofText) || !/^[1-6]$/.test(colDofText)) {
      throw new Error(`${label}: line ${lineIndex + 1} DOF values must be integers from 1 through 6`)
    }
    if (valueText === '' || !Number.isFinite(value)) throw new Error(`${label}: line ${lineIndex + 1} coefficient must be finite`)

    const key = `${node}:${dof}:${colNode}:${colDof}`
    if (seen.has(key)) throw new Error(`${label}: duplicate matrix entry at line ${lineIndex + 1}`)
    seen.add(key)
    const row = { node, dof }
    const col = { node: colNode, dof: colDof }
    coordinateSet.set(coordinateKey(node, dof), row)
    coordinateSet.set(coordinateKey(colNode, colDof), col)
    entries.push({ node, dof, colNode, colDof, value })
  }
  if (entries.length === 0) throw new Error(`${label}: matrix contains no entries`)

  let hasLower = false
  let hasUpper = false
  for (const entry of entries) {
    const order = compareCoordinate({ node: entry.node, dof: entry.dof }, { node: entry.colNode, dof: entry.colDof })
    if (order > 0) hasLower = true
    if (order < 0) hasUpper = true
  }
  if (hasLower && hasUpper) {
    const entryMap = new Map(entries.map((entry) => [
      `${entry.node}:${entry.dof}:${entry.colNode}:${entry.colDof}`,
      entry.value,
    ]))
    for (const entry of entries) {
      if (entry.node === entry.colNode && entry.dof === entry.colDof) continue
      const mirrorKey = `${entry.colNode}:${entry.colDof}:${entry.node}:${entry.dof}`
      const mirrorValue = entryMap.get(mirrorKey)
      if (mirrorValue === undefined || mirrorValue !== entry.value) {
        throw new Error(`${label}: full storage must contain exact matching mirrored coefficients`)
      }
    }
  }

  const storage: AbaqusMatrixStorage = !hasLower && !hasUpper
    ? 'diagonal'
    : hasLower && hasUpper
      ? 'full'
      : hasLower ? 'lower' : 'upper'
  return {
    entries,
    storage,
    coordinates: [...coordinateSet.values()].sort(compareCoordinate),
  }
}

export function importAbaqusMatrixPair(stiffnessText: string, massText: string): AbaqusMatrixImportResult {
  try {
    const stiffnessParsed = parseMatrix(stiffnessText, 'STIF')
    const massParsed = parseMatrix(massText, 'MASS')
    const coordinates = massParsed.coordinates
    if (coordinates.length > MAX_DOFS) throw new Error(`MASS: mapped DOF count exceeds ${MAX_DOFS}`)
    const indexByKey = new Map(coordinates.map((coordinate, index) => [coordinateKey(coordinate.node, coordinate.dof), index]))
    const massDiagonal = new Set(massParsed.entries
      .filter((entry) => entry.node === entry.colNode && entry.dof === entry.colDof)
      .map((entry) => coordinateKey(entry.node, entry.dof)))
    for (const coordinate of coordinates) {
      if (!massDiagonal.has(coordinateKey(coordinate.node, coordinate.dof))) {
        throw new Error(`MASS: missing diagonal entry for node ${coordinate.node}, DOF ${coordinate.dof}`)
      }
    }
    for (const entry of stiffnessParsed.entries) {
      if (!indexByKey.has(coordinateKey(entry.node, entry.dof)) || !indexByKey.has(coordinateKey(entry.colNode, entry.colDof))) {
        throw new Error(`STIF: node/DOF coordinates must be a subset of the MASS map`)
      }
    }

    const size = coordinates.length
    const stiffness = Array.from({ length: size }, () => Array<number>(size).fill(0))
    const mass = Array.from({ length: size }, () => Array<number>(size).fill(0))
    const fill = (parsed: ParsedMatrix, matrix: number[][]): void => {
      for (const entry of parsed.entries) {
        const row = indexByKey.get(coordinateKey(entry.node, entry.dof))!
        const col = indexByKey.get(coordinateKey(entry.colNode, entry.colDof))!
        matrix[row][col] = entry.value
        matrix[col][row] = entry.value
      }
    }
    fill(stiffnessParsed, stiffness)
    fill(massParsed, mass)

    return {
      ok: true,
      stiffness,
      mass,
      dofMap: coordinates.map((coordinate, index) => ({ index, ...coordinate })),
      stiffnessStorage: stiffnessParsed.storage,
      massStorage: massParsed.storage,
      stiffnessEntries: stiffnessParsed.entries.length,
      massEntries: massParsed.entries.length,
    }
  } catch (error) {
    return { ok: false, diagnostics: [error instanceof Error ? error.message : 'Abaqus matrix import failed'] }
  }
}
