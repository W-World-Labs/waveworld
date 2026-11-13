import { validateModuleInput, type SwModuleInput } from '../../lib/sim/module-compute'

export const ELMER_MESH_CONVERT_MODULE = 'sw-elmer-mesh-convert-b' as const
export const ELMER_MESH_CONVERT_METHOD = 'method-algo-elmergrid-convert' as const
export const MAX_ELMER_INLINE_CHARS = 1 << 20
export const MAX_ELMER_MESH_ROWS = 5_000_000

type ElmerMeshConvertInput = SwModuleInput & {
  module: typeof ELMER_MESH_CONVERT_MODULE
  backend: 'host'
  nodes: unknown[]
  elements: unknown[]
  extrude?: unknown
}

export interface ElmerMeshExportFiles {
  'mesh.header': string
  'mesh.nodes': string
  'mesh.elements': string
  'mesh.boundary': string
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Validate the current operation envelope without widening its input contract. */
export function parseElmerMeshInput(raw: string): ElmerMeshConvertInput | null {
  if (raw.length === 0 || raw.length > MAX_ELMER_INLINE_CHARS) return null
  try {
    const value: unknown = JSON.parse(raw)
    const input = record(value, 'input')
    if (input.module !== ELMER_MESH_CONVERT_MODULE || input.backend !== 'host') return null
    validateModuleInput(input)
    const mesh = input as unknown as ElmerMeshConvertInput

    const nodes = mesh.nodes
    const elements = mesh.elements
    if (!Array.isArray(nodes) || !Array.isArray(elements) || nodes.length === 0 || elements.length === 0) return null
    if (nodes.length > MAX_ELMER_MESH_ROWS || elements.length > MAX_ELMER_MESH_ROWS) return null

    let layers = 1
    if (mesh.extrude !== undefined && mesh.extrude !== null) {
      const extrude = record(mesh.extrude, 'extrude')
      const layerValue = extrude.layers
      if (layerValue !== undefined && layerValue !== null && typeof layerValue !== 'number') return null
      layers = layerValue === undefined || layerValue === null ? 1 : layerValue
      if (!Number.isSafeInteger(layers) || layers < 1 || layers > 1000) return null
    }
    if (nodes.length * (layers + (mesh.extrude ? 1 : 0)) > MAX_ELMER_MESH_ROWS) return null
    if (elements.length * layers > MAX_ELMER_MESH_ROWS) return null
    return mesh
  } catch {
    return null
  }
}

function textRows(value: unknown, path: string): string[][] {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be non-empty text`)
  const lines: string[] = value.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0 || lines.some((line: string) => line.trim() === '')) {
    throw new Error(`${path} contains an empty row`)
  }
  return lines.map((line: string) => line.trim().split(/\s+/))
}

/**
 * Validate the pinned native response and render the four-file native text
 * bundle. The pinned writer's header rows omit counts and its unused node
 * partition marker is 0, so those two text fields are normalized here.
 */
export function buildElmerMeshExportFiles(operationOutput: unknown): ElmerMeshExportFiles {
  const output = record(operationOutput, 'operation result')
  if (output.ok !== true || output.module !== ELMER_MESH_CONVERT_MODULE) {
    throw new Error('Native result does not match the Elmer mesh conversion operation.')
  }
  const result = record(output.result, 'operation result.result')
  if (result.ok !== true || result.methodId !== ELMER_MESH_CONVERT_METHOD) {
    throw new Error('Native result does not identify the ElmerGrid conversion method.')
  }
  const native = record(result.native, 'operation result.result.native')
  const nodeCount = result.nodeCount
  const elementCount = result.elementCount
  if (!Number.isSafeInteger(nodeCount) || (nodeCount as number) < 1 || (nodeCount as number) > MAX_ELMER_MESH_ROWS) {
    throw new Error('Native node count is outside the supported output bound.')
  }
  if (!Number.isSafeInteger(elementCount) || (elementCount as number) < 1 || (elementCount as number) > MAX_ELMER_MESH_ROWS) {
    throw new Error('Native element count is outside the supported output bound.')
  }

  const nodeRows = textRows(native.nodes, 'native.nodes')
  if (nodeRows.length !== nodeCount) throw new Error('Native node rows do not match the reported node count.')
  const normalizedNodes = nodeRows.map((row, index) => {
    if (row.length !== 5 || Number(row[0]) !== index + 1 || !Number.isSafeInteger(Number(row[1]))) {
      throw new Error(`Native node row ${index + 1} is malformed.`)
    }
    const xyz = row.slice(2).map(Number)
    if (xyz.some(value => !Number.isFinite(value))) throw new Error(`Native node row ${index + 1} has invalid coordinates.`)
    return `${index + 1} -1 ${row[2]} ${row[3]} ${row[4]}`
  }).join('\n') + '\n'

  const elementRows = textRows(native.elements, 'native.elements')
  if (elementRows.length !== elementCount) throw new Error('Native element rows do not match the reported element count.')
  const codeCounts = new Map<number, number>()
  const normalizedElements = elementRows.map((row, index) => {
    if (row.length < 4 || Number(row[0]) !== index + 1) throw new Error(`Native element row ${index + 1} is malformed.`)
    const body = Number(row[1])
    const code = Number(row[2])
    if (!Number.isSafeInteger(body) || body < 1 || !Number.isSafeInteger(code) || code < 101 || code > 899 || code % 100 < 1) {
      throw new Error(`Native element row ${index + 1} has an invalid body or element code.`)
    }
    if (row.length !== 3 + code % 100) throw new Error(`Native element row ${index + 1} has the wrong node count for code ${code}.`)
    for (const value of row.slice(3)) {
      const nodeId = Number(value)
      if (!Number.isSafeInteger(nodeId) || nodeId < 1 || nodeId > nodeCount) {
        throw new Error(`Native element row ${index + 1} references a node outside the output mesh.`)
      }
    }
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1)
    return row.join(' ')
  })

  const reportedCodes = result.elementCodes
  const codes = [...codeCounts.keys()].sort((a, b) => a - b)
  if (!Array.isArray(reportedCodes) || reportedCodes.length !== codes.length ||
    reportedCodes.some((code, index) => code !== codes[index])) {
    throw new Error('Native element codes do not match the returned element rows.')
  }

  const header = [
    `${nodeCount} ${elementCount} 0`,
    String(codes.length),
    ...codes.map(code => `${code} ${codeCounts.get(code)}`),
  ].join('\n') + '\n'
  return {
    'mesh.header': header,
    'mesh.nodes': normalizedNodes,
    'mesh.elements': normalizedElements.join('\n') + '\n',
    'mesh.boundary': '',
  }
}
