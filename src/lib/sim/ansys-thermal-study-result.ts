import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { AnsysThermalStudyInput } from './ansys-thermal-study-input'

export type AnsysThermalSample = {
  step: number
  time: number
  minTemperature: number
  maxTemperature: number
  meanTemperature: number
}

export type AnsysThermalStudyResult = {
  module: 'sw-ansys-thermal-fem'
  method: 'method-algo-thermal-fem-theta'
  family: 'method-ansys-mechanical-thermal'
  backend: { id: 'w-sim-cuda-host'; kind: 'host-f64'; deviceName: 'w-sim-cuda-host'; [key: string]: unknown }
  scope: string
  result: {
    analysis: 'steady' | 'transient'
    element: 'bar'
    dimension: 1
    nNodes: number
    nElements: number
    temperatures: number[]
    minTemperature: number
    maxTemperature: number
    meanTemperature: number
    reactions: number[]
    heatBalance: { sourceTotal: number; robinHeatIn: number; dirichletHeatIn: number; balanceResidual: number }
    maxResidual: number
    transient?: { timeStep: number; steps: number; theta: number; capacity: string; finalTime: number; maxStepResidual: number; samples: AnsysThermalSample[]; [key: string]: unknown }
    [key: string]: unknown
  }
  [key: string]: unknown
}

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function integer(value: unknown, label: string, min: number): number {
  const n = finite(value, label)
  if (!Number.isInteger(n) || n < min) throw new Error(`${label} is out of range`)
  return n
}

function close(actual: number, expected: number, label: string, tolerance = 1e-8): void {
  if (Math.abs(actual - expected) > tolerance * Math.max(1, Math.abs(actual), Math.abs(expected))) throw new Error(`${label} is inconsistent`)
}

function numericArray(value: unknown, label: string, expectedLength?: number): number[] {
  if (!Array.isArray(value) || (expectedLength !== undefined && value.length !== expectedLength)) {
    throw new Error(`${label} must contain${expectedLength === undefined ? '' : ` exactly ${expectedLength}`} values`)
  }
  return value.map((entry, i) => finite(entry, `${label}[${i}]`))
}

/** Validate the job envelope, then the native host FEM result against the submitted bar mesh. */
export function parseAnsysThermalStudyResult(remote: JobResultV1, input: AnsysThermalStudyInput): AnsysThermalStudyResult {
  const output = readModuleResult(remote, input as unknown as ModuleComputeInput)
  return parseAnsysThermalNativeOutput(output, input)
}

/** Validate an already-unwrapped thermal module result; this function never solves locally. */
export function parseAnsysThermalNativeOutput(nativeOutput: unknown, input: AnsysThermalStudyInput): AnsysThermalStudyResult {
  const submitted = input as unknown as RecordValue
  if (submitted.module !== 'sw-ansys-thermal-fem' || submitted.backend !== 'host' || submitted.dimension !== 1) throw new Error('unsupported ANSYS thermal study input')
  const mesh = object(submitted.mesh, 'submitted mesh')
  if (mesh.element !== 'bar') throw new Error('submitted thermal mesh must use bar elements')
  if (!Array.isArray(mesh.nodes) || mesh.nodes.length < 2 || !Array.isArray(mesh.elements) || mesh.elements.length < 1) throw new Error('submitted thermal mesh is invalid')
  if (mesh.nodes.some(node => !Array.isArray(node) || node.length !== 1 || typeof node[0] !== 'number' || !Number.isFinite(node[0]))) throw new Error('submitted bar mesh nodes must be one-dimensional')
  const nNodes = mesh.nodes.length
  const nElements = mesh.elements.length
  const analysis = submitted.analysis == null ? 'steady' : submitted.analysis
  if (analysis !== 'steady' && analysis !== 'transient') throw new Error('submitted thermal analysis is unsupported')

  const output = object(nativeOutput, 'ANSYS thermal module result')
  if (output.module !== 'sw-ansys-thermal-fem' || output.method !== 'method-algo-thermal-fem-theta' || output.family !== 'method-ansys-mechanical-thermal') throw new Error('thermal result identity does not match the submitted study')
  if (typeof output.scope !== 'string' || !output.scope.trim()) throw new Error('thermal result scope is missing')
  const backend = object(output.backend, 'thermal backend')
  if (backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64' || backend.deviceName !== 'w-sim-cuda-host') throw new Error('thermal result backend provenance is invalid')
  const result = object(output.result, 'thermal result payload')
  if (result.analysis !== analysis || result.element !== 'bar' || result.dimension !== 1) throw new Error('thermal result model does not match the submitted bar study')
  if (integer(result.nNodes, 'thermal node count', 2) !== nNodes || integer(result.nElements, 'thermal element count', 1) !== nElements) throw new Error('thermal result mesh counts do not match the submitted mesh')

  const temperatures = numericArray(result.temperatures, 'temperatures', nNodes)
  if (!Array.isArray(submitted.dirichlet)) throw new Error('submitted Dirichlet conditions are invalid')
  for (const [index, rawCondition] of submitted.dirichlet.entries()) {
    const condition = object(rawCondition, `submitted Dirichlet condition ${index}`)
    const node = integer(condition.node, `submitted Dirichlet node ${index}`, 0)
    if (node >= nNodes) throw new Error(`submitted Dirichlet node ${index} is out of range`)
    close(temperatures[node], finite(condition.temperature, `submitted Dirichlet temperature ${index}`), `temperature at Dirichlet node ${node}`)
  }
  const minTemperature = finite(result.minTemperature, 'minimum temperature')
  const maxTemperature = finite(result.maxTemperature, 'maximum temperature')
  const meanTemperature = finite(result.meanTemperature, 'mean temperature')
  close(minTemperature, Math.min(...temperatures), 'minimum temperature')
  close(maxTemperature, Math.max(...temperatures), 'maximum temperature')
  close(meanTemperature, temperatures.reduce((sum, value) => sum + value, 0) / nNodes, 'mean temperature')
  const reactions = numericArray(result.reactions, 'reactions', nNodes)
  const heat = object(result.heatBalance, 'heat balance')
  const sourceTotal = finite(heat.sourceTotal, 'heat source total')
  const robinHeatIn = finite(heat.robinHeatIn, 'Robin heat input')
  const dirichletHeatIn = finite(heat.dirichletHeatIn, 'Dirichlet heat input')
  const balanceResidual = finite(heat.balanceResidual, 'heat balance residual')
  close(balanceResidual, sourceTotal + robinHeatIn + dirichletHeatIn, 'heat balance residual')
  const maxResidual = finite(result.maxResidual, 'maximum residual')
  if (maxResidual < 0) throw new Error('maximum residual is out of range')

  let transient: AnsysThermalStudyResult['result']['transient']
  if (analysis === 'transient') {
    const raw = object(result.transient, 'transient result')
    const timeStep = finite(raw.timeStep, 'time step')
    const steps = integer(raw.steps, 'transient step count', 1)
    const theta = finite(raw.theta, 'theta')
    const finalTime = finite(raw.finalTime, 'final time')
    const maxStepResidual = finite(raw.maxStepResidual, 'maximum step residual')
    if (timeStep <= 0 || theta < 0.5 || theta > 1 || maxStepResidual < 0) throw new Error('transient result parameters are out of range')
    if (typeof raw.capacity !== 'string' || !['consistent', 'lumped'].includes(raw.capacity)) throw new Error('transient capacity is invalid')
    if (submitted.timeStep !== undefined) close(timeStep, finite(submitted.timeStep, 'submitted time step'), 'time step')
    if (submitted.steps !== undefined && steps !== integer(submitted.steps, 'submitted steps', 1)) throw new Error('transient step count does not match the submitted study')
    if (submitted.theta !== undefined) close(theta, finite(submitted.theta, 'submitted theta'), 'theta')
    if (submitted.capacity !== undefined && raw.capacity !== submitted.capacity) throw new Error('transient capacity does not match the submitted study')
    close(finalTime, timeStep * steps, 'final time')
    // The native limit is 1000 requested output intervals plus the required t=0 sample.
    if (!Array.isArray(raw.samples) || raw.samples.length < 1 || raw.samples.length > 1001) throw new Error('transient samples must be a bounded array')
    let previousStep = -1
    const samples = raw.samples.map((sample, index): AnsysThermalSample => {
      const row = object(sample, `transient sample ${index}`)
      const step = integer(row.step, `sample ${index} step`, 0)
      const time = finite(row.time, `sample ${index} time`)
      const min = finite(row.minTemperature, `sample ${index} minimum temperature`)
      const max = finite(row.maxTemperature, `sample ${index} maximum temperature`)
      const mean = finite(row.meanTemperature, `sample ${index} mean temperature`)
      if (step <= previousStep || step > steps || min > mean || mean > max) throw new Error(`transient sample ${index} is inconsistent`)
      close(time, step * timeStep, `sample ${index} time`)
      previousStep = step
      return { step, time, minTemperature: min, maxTemperature: max, meanTemperature: mean }
    })
    if (samples[0].step !== 0 || samples[samples.length - 1].step !== steps) throw new Error('transient samples must include the initial and final aggregate states')
    if (submitted.initialTemperature !== undefined) {
      const initial = numericArray(submitted.initialTemperature, 'submitted initial temperatures', nNodes)
      for (const rawCondition of submitted.dirichlet) {
        const condition = rawCondition as RecordValue
        const node = integer(condition.node, 'submitted Dirichlet node', 0)
        initial[node] = finite(condition.temperature, `submitted Dirichlet temperature at node ${node}`)
      }
      close(samples[0].minTemperature, Math.min(...initial), 'initial sample minimum temperature')
      close(samples[0].maxTemperature, Math.max(...initial), 'initial sample maximum temperature')
      close(samples[0].meanTemperature, initial.reduce((sum, value) => sum + value, 0) / nNodes, 'initial sample mean temperature')
    }
    const finalSample = samples[samples.length - 1]
    close(finalSample.minTemperature, minTemperature, 'final sample minimum temperature')
    close(finalSample.maxTemperature, maxTemperature, 'final sample maximum temperature')
    close(finalSample.meanTemperature, meanTemperature, 'final sample mean temperature')
    transient = { ...raw, timeStep, steps, theta, capacity: raw.capacity, finalTime, maxStepResidual, samples }
  } else if (result.transient !== undefined) {
    throw new Error('steady thermal result must not include transient data')
  }

  return {
    ...output,
    module: 'sw-ansys-thermal-fem', method: 'method-algo-thermal-fem-theta', family: 'method-ansys-mechanical-thermal',
    backend: backend as AnsysThermalStudyResult['backend'], scope: output.scope,
    result: {
      ...result, analysis, element: 'bar', dimension: 1, nNodes, nElements, temperatures,
      minTemperature, maxTemperature, meanTemperature, reactions,
      heatBalance: { ...heat, sourceTotal, robinHeatIn, dirichletHeatIn, balanceResidual }, maxResidual,
      ...(transient ? { transient } : {}),
    },
  } as AnsysThermalStudyResult
}
