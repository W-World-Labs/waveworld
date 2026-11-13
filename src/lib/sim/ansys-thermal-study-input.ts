/** User-facing SI inputs for the pinned host-f64 Ansys thermal FEM operation. */
export type AnsysThermalStudyDraft = {
  analysis: 'steady' | 'transient'
  nodeCount: number
  lengthM: number
  crossSectionAreaM2: number
  conductivityWPerMK: number
  volumetricSourceWPerM3?: number
  leftTemperatureC: number
  rightTemperatureC: number
  initialTemperatureC?: number
  densityKgPerM3?: number
  specificHeatJPerKgK?: number
  timeStepS?: number
  steps?: number
  theta?: number
  capacity?: 'consistent' | 'lumped'
}

export type AnsysThermalStudyInput = {
  module: 'sw-ansys-thermal-fem'
  backend: 'host'
  analysis: 'steady' | 'transient'
  dimension: 1
  mesh: { element: 'bar'; nodes: [number][]; elements: [number, number][] }
  conductivity: number
  thickness: number
  sources?: number[]
  volumetricSource?: number
  dirichlet: { node: number; temperature: number }[]
  density?: number
  specificHeat?: number
  initialTemperature?: number[]
  timeStep?: number
  steps?: number
  theta?: number
  capacity?: 'consistent' | 'lumped'
}

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

const DRAFT_KEYS = [
  'analysis', 'nodeCount', 'lengthM', 'crossSectionAreaM2', 'conductivityWPerMK', 'volumetricSourceWPerM3',
  'leftTemperatureC', 'rightTemperatureC', 'initialTemperatureC', 'densityKgPerM3',
  'specificHeatJPerKgK', 'timeStepS', 'steps', 'theta', 'capacity',
] as const

function validateDraft(value: unknown): AnsysThermalStudyDraft {
  const draft = record(value, 'Ansys thermal study draft')
  exactKeys(draft, DRAFT_KEYS, 'Ansys thermal study draft')
  if (draft.analysis !== 'steady' && draft.analysis !== 'transient') fail('analysis must be steady or transient')
  const nodeCount = finite(draft.nodeCount, 'nodeCount', 2, 256)
  if (!Number.isInteger(nodeCount)) fail('nodeCount must be an integer')
  const common: AnsysThermalStudyDraft = {
    analysis: draft.analysis,
    nodeCount,
    lengthM: finite(draft.lengthM, 'lengthM (m)', 1e-6, 1e6),
    crossSectionAreaM2: finite(draft.crossSectionAreaM2, 'crossSectionAreaM2 (m²)', 1e-12, 1e6),
    conductivityWPerMK: finite(draft.conductivityWPerMK, 'conductivityWPerMK (W/(m·K))', 1e-6, 1e6),
    leftTemperatureC: finite(draft.leftTemperatureC, 'leftTemperatureC (°C)', -273.15, 2000),
    rightTemperatureC: finite(draft.rightTemperatureC, 'rightTemperatureC (°C)', -273.15, 2000),
    ...(draft.volumetricSourceWPerM3 === undefined ? {} : {
      volumetricSourceWPerM3: finite(draft.volumetricSourceWPerM3, 'volumetricSourceWPerM3 (W/m³)', -1e12, 1e12),
    }),
  }
  if (draft.analysis === 'steady') {
    for (const key of ['initialTemperatureC', 'densityKgPerM3', 'specificHeatJPerKgK', 'timeStepS', 'steps', 'theta', 'capacity'] as const) {
      if (draft[key] !== undefined) fail(`${key} is only valid for transient analysis`)
    }
    return common
  }

  const initialTemperatureC = finite(draft.initialTemperatureC, 'initialTemperatureC (°C)', -273.15, 2000)
  const densityKgPerM3 = finite(draft.densityKgPerM3, 'densityKgPerM3 (kg/m³)', 1e-6, 1e9)
  const specificHeatJPerKgK = finite(draft.specificHeatJPerKgK, 'specificHeatJPerKgK (J/(kg·K))', 1e-6, 1e9)
  const timeStepS = finite(draft.timeStepS, 'timeStepS (s)', 1e-9, 1e9)
  const steps = finite(draft.steps, 'steps', 1, 200_000)
  if (!Number.isInteger(steps)) fail('steps must be an integer')
  const transientWork = (nodeCount - 2) ** 2 * steps
  if (transientWork > 400_000_000) fail('transient work exceeds the native nFree^2*steps limit of 400000000')
  const theta = finite(draft.theta, 'theta', 0.5, 1)
  const capacity = draft.capacity
  if (capacity !== 'consistent' && capacity !== 'lumped') fail('capacity must be consistent or lumped')
  return { ...common, initialTemperatureC, densityKgPerM3, specificHeatJPerKgK, timeStepS, steps, theta, capacity }
}

export function createDefaultAnsysThermalStudy(): AnsysThermalStudyDraft {
  return {
    analysis: 'steady', nodeCount: 21, lengthM: 1, conductivityWPerMK: 15,
    crossSectionAreaM2: 1,
    leftTemperatureC: 100, rightTemperatureC: 0,
  }
}

/** Validate a direct-caller payload against the exact supported native input shape. */
export function validateAnsysThermalStudyInput(input: unknown): AnsysThermalStudyInput {
  const value = record(input, 'Ansys thermal FEM input')
  const transient = value.analysis === 'transient'
  const baseKeys = ['module', 'backend', 'analysis', 'dimension', 'mesh', 'conductivity', 'thickness', 'sources', 'volumetricSource', 'dirichlet']
  const transientKeys = ['density', 'specificHeat', 'initialTemperature', 'timeStep', 'steps', 'theta', 'capacity']
  exactKeys(value, transient ? [...baseKeys, ...transientKeys] : baseKeys, 'Ansys thermal FEM input')
  if (value.module !== 'sw-ansys-thermal-fem' || value.backend !== 'host' || (value.analysis !== 'steady' && !transient) || value.dimension !== 1) {
    fail('input must select sw-ansys-thermal-fem on host with dimension 1 and steady or transient analysis')
  }
  const mesh = record(value.mesh, 'mesh')
  exactKeys(mesh, ['element', 'nodes', 'elements'], 'mesh')
  if (mesh.element !== 'bar' || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.elements)) fail('mesh must contain bar nodes and elements arrays')
  if (mesh.nodes.length < 2 || mesh.nodes.length > 256 || mesh.elements.length !== mesh.nodes.length - 1) fail('mesh must be a connected bar with 2 to 256 nodes')
  const nodes = mesh.nodes.map((node, i) => {
    if (!Array.isArray(node) || node.length !== 1) fail(`mesh.nodes[${i}] must contain one coordinate`)
    return [finite(node[0], `mesh.nodes[${i}][0] (m)`, -1e6, 1e6)] as [number]
  })
  for (let i = 1; i < nodes.length; i += 1) {
    if (!(nodes[i][0] > nodes[i - 1][0])) fail('mesh nodes must form a strictly increasing 1D bar')
  }
  const elements = mesh.elements.map((element, i) => {
    if (!Array.isArray(element) || element.length !== 2 || element[0] !== i || element[1] !== i + 1) fail('mesh elements must connect each adjacent node in order')
    return [i, i + 1] as [number, number]
  })
  const conductivity = finite(value.conductivity, 'conductivity (W/(m·K))', 1e-6, 1e6)
  const thickness = finite(value.thickness, 'crossSectionArea (m²)', 1e-12, 1e6)
  const sources = value.sources === undefined ? undefined : (() => {
    if (!Array.isArray(value.sources) || value.sources.length !== nodes.length) fail('sources must contain one nodal heat load per mesh node')
    return value.sources.map((item, i) => finite(item, `sources[${i}] (W)`, -1e12, 1e12))
  })()
  const volumetricSource = value.volumetricSource === undefined ? undefined : finite(value.volumetricSource, 'volumetricSource (W/m³)', -1e12, 1e12)
  if (!Array.isArray(value.dirichlet) || value.dirichlet.length !== 2) fail('dirichlet must contain the two endpoint temperatures')
  const dirichlet = value.dirichlet.map((bc, i) => {
    const item = record(bc, `dirichlet[${i}]`)
    exactKeys(item, ['node', 'temperature'], `dirichlet[${i}]`)
    const node = finite(item.node, `dirichlet[${i}].node`, 0, nodes.length - 1)
    if (!Number.isInteger(node) || node !== (i === 0 ? 0 : nodes.length - 1)) fail('dirichlet must constrain the left and right endpoint nodes in order')
    return { node, temperature: finite(item.temperature, `dirichlet[${i}].temperature (°C)`, -273.15, 2000) }
  })
  const base = {
    module: 'sw-ansys-thermal-fem' as const, backend: 'host' as const,
    analysis: value.analysis as 'steady' | 'transient', dimension: 1 as const,
    mesh: { element: 'bar' as const, nodes, elements }, conductivity, thickness, dirichlet,
    ...(sources === undefined ? {} : { sources }),
    ...(volumetricSource === undefined ? {} : { volumetricSource }),
  }
  if (!transient) return base
  const density = finite(value.density, 'density (kg/m³)', 1e-6, 1e9)
  const specificHeat = finite(value.specificHeat, 'specificHeat (J/(kg·K))', 1e-6, 1e9)
  const timeStep = finite(value.timeStep, 'timeStep (s)', 1e-9, 1e9)
  const steps = finite(value.steps, 'steps', 1, 200_000)
  if (!Number.isInteger(steps)) fail('steps must be an integer')
  const transientWork = (nodes.length - 2) ** 2 * steps
  if (transientWork > 400_000_000) fail('transient work exceeds the native nFree^2*steps limit of 400000000')
  const theta = finite(value.theta, 'theta', 0.5, 1)
  if (value.capacity !== 'consistent' && value.capacity !== 'lumped') fail('capacity must be consistent or lumped')
  if (!Array.isArray(value.initialTemperature) || value.initialTemperature.length !== nodes.length) fail('initialTemperature must have one value per node')
  const initialTemperature = value.initialTemperature.map((item, i) => finite(item, `initialTemperature[${i}] (°C)`, -273.15, 2000))
  return { ...base, density, specificHeat, timeStep, steps, theta, capacity: value.capacity, initialTemperature }
}

export function createAnsysThermalStudyInput(draftValue: unknown): AnsysThermalStudyInput {
  const draft = validateDraft(draftValue)
  const nodes = Array.from({ length: draft.nodeCount }, (_, i) => [draft.lengthM * i / (draft.nodeCount - 1)] as [number])
  const input = {
    module: 'sw-ansys-thermal-fem', backend: 'host', analysis: draft.analysis, dimension: 1,
    mesh: { element: 'bar', nodes, elements: nodes.slice(0, -1).map((_, i) => [i, i + 1]) },
    conductivity: draft.conductivityWPerMK,
    thickness: draft.crossSectionAreaM2,
    ...(draft.volumetricSourceWPerM3 === undefined ? {} : { volumetricSource: draft.volumetricSourceWPerM3 }),
    dirichlet: [
      { node: 0, temperature: draft.leftTemperatureC },
      { node: draft.nodeCount - 1, temperature: draft.rightTemperatureC },
    ],
    ...(draft.analysis === 'transient' ? {
      density: draft.densityKgPerM3,
      specificHeat: draft.specificHeatJPerKgK,
      initialTemperature: Array(draft.nodeCount).fill(draft.initialTemperatureC),
      timeStep: draft.timeStepS,
      steps: draft.steps,
      theta: draft.theta,
      capacity: draft.capacity,
    } : {}),
  }
  return validateAnsysThermalStudyInput(input)
}
