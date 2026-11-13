export type AbaqusMaterialPointStep = {
  step: number
  totalStrain: number[]
  stress: number[]
  plasticStrain: number[]
  equivalentPlasticStrain: number
  vonMises: number
  yielded: boolean
  plasticMultiplier?: number
  plasticDissipationIncrement?: number
  plasticDissipation?: number
}

export type AbaqusMaterialPointResult = {
  module: 'sw-calculix-plasticity'
  backend?: Record<string, unknown>
  material?: Record<string, unknown>
  history: AbaqusMaterialPointStep[]
  summary: {
    steps: number
    yieldedSteps: number
    finalEquivalentPlasticStrain: number
    finalVonMises: number
    finalStress?: number[]
    finalPlasticStrain?: number[]
    finalPlasticDissipation?: number
  }
}

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function vector(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length !== 6) throw new Error(`${label} must contain six components`)
  return value.map((component, index) => finite(component, `${label}[${index}]`))
}

/** Validate the material-point history returned by W-Sim, ignoring unrelated fields. */
export function parseAbaqusMaterialPointResult(raw: unknown, expectedSteps: number): AbaqusMaterialPointResult {
  if (!Number.isInteger(expectedSteps) || expectedSteps < 1) throw new Error('Expected material-point steps must be a positive integer')
  const payload = object(raw, 'Material-point result')
  if (payload.module !== 'sw-calculix-plasticity') throw new Error('Material-point result module does not match sw-calculix-plasticity')
  if (!Array.isArray(payload.history) || payload.history.length !== expectedSteps) throw new Error('Material-point history length does not match the submitted step count')
  const history = payload.history.map((entry, index): AbaqusMaterialPointStep => {
    const item = object(entry, `History step ${index + 1}`)
    const step = finite(item.step, `History step ${index + 1} number`)
    if (!Number.isInteger(step) || step !== index) throw new Error('Material-point history steps must be sequential and match the submitted step count')
    if (typeof item.yielded !== 'boolean') throw new Error(`History step ${step} yielded flag must be boolean`)
    const parsed: AbaqusMaterialPointStep = {
      step,
      totalStrain: vector(item.totalStrain, `History step ${step} total strain`),
      stress: vector(item.stress, `History step ${step} stress`),
      plasticStrain: vector(item.plasticStrain, `History step ${step} plastic strain`),
      equivalentPlasticStrain: finite(item.equivalentPlasticStrain, `History step ${step} equivalent plastic strain`),
      vonMises: finite(item.vonMises, `History step ${step} von Mises stress`),
      yielded: item.yielded,
    }
    for (const key of ['plasticMultiplier', 'plasticDissipationIncrement', 'plasticDissipation'] as const) {
      if (item[key] !== undefined) parsed[key] = finite(item[key], `History step ${step} ${key}`)
    }
    return parsed
  })
  const summary = object(payload.summary, 'Material-point summary')
  const steps = finite(summary.steps, 'Summary steps')
  const yieldedSteps = finite(summary.yieldedSteps, 'Summary yielded steps')
  if (!Number.isInteger(steps) || steps !== expectedSteps || !Number.isInteger(yieldedSteps) || yieldedSteps < 0 || yieldedSteps > steps) throw new Error('Material-point summary step counts do not match the returned history')
  const finalEquivalentPlasticStrain = finite(summary.finalEquivalentPlasticStrain, 'Summary final equivalent plastic strain')
  const finalVonMises = finite(summary.finalVonMises, 'Summary final von Mises stress')
  const last = history[history.length - 1]!
  if (finalEquivalentPlasticStrain !== last.equivalentPlasticStrain || finalVonMises !== last.vonMises || yieldedSteps !== history.filter((item) => item.yielded).length) throw new Error('Material-point summary does not match the returned history')
  const parsedSummary: AbaqusMaterialPointResult['summary'] = { steps, yieldedSteps, finalEquivalentPlasticStrain, finalVonMises }
  if (summary.finalStress !== undefined) parsedSummary.finalStress = vector(summary.finalStress, 'Summary final stress')
  if (summary.finalPlasticStrain !== undefined) parsedSummary.finalPlasticStrain = vector(summary.finalPlasticStrain, 'Summary final plastic strain')
  if (summary.finalPlasticDissipation !== undefined) parsedSummary.finalPlasticDissipation = finite(summary.finalPlasticDissipation, 'Summary final plastic dissipation')
  const backend = payload.backend === undefined ? undefined : object(payload.backend, 'Material-point backend')
  const material = payload.material === undefined ? undefined : object(payload.material, 'Material-point material')
  return { module: 'sw-calculix-plasticity', ...(backend ? { backend } : {}), ...(material ? { material } : {}), history, summary: parsedSummary }
}
