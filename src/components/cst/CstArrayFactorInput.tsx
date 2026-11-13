import type { ChangeEvent } from 'react'

export type CstArrayFactorInputValue = {
  module: 'antenna-l2'
  backend: 'host'
  operation: 'cst-array-factor'
  freqHz: number
  positionsM: [number, number, number][]
  weights: [number, number][]
  directionsRad: [number, number][]
}

type Props = {
  value: CstArrayFactorInputValue
  onChange: (value: CstArrayFactorInputValue) => void
  disabled?: boolean
}

const MAX_ELEMENTS = 256
const MAX_DIRECTIONS = 4096
const MAX_EVALUATIONS = 1_048_576

function NumberField({ label, value, onChange, disabled, step = 'any', min, max }: {
  label: string
  value: number
  onChange: (value: number) => void
  disabled: boolean
  step?: string
  min?: number
  max?: number
}) {
  return <label className="block text-sm text-ink">
    <span className="mb-1 block">{label}</span>
    <input aria-label={label} type="number" value={value} step={step} min={min} max={max} disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const next = event.currentTarget.valueAsNumber
        if (Number.isFinite(next)) onChange(next)
      }}
      className="w-full rounded-lg border border-edge bg-surface px-2 py-1.5 disabled:opacity-60" />
  </label>
}

/** Editor for the bounded, uncoupled isotropic array-factor request. */
export function CstArrayFactorInput({ value, onChange, disabled = false }: Props) {
  const canAddElement = value.positionsM.length < MAX_ELEMENTS
    && (value.positionsM.length + 1) * value.directionsRad.length <= MAX_EVALUATIONS
  const canAddDirection = value.directionsRad.length < MAX_DIRECTIONS
    && value.positionsM.length * (value.directionsRad.length + 1) <= MAX_EVALUATIONS
  const update = (patch: Partial<CstArrayFactorInputValue>) => onChange({ ...value, ...patch })
  const updatePosition = (row: number, axis: number, next: number) => {
    const positionsM = value.positionsM.map(position => [...position] as [number, number, number])
    positionsM[row]![axis] = next
    update({ positionsM })
  }
  const updateWeight = (row: number, part: number, next: number) => {
    const weights = value.weights.map(weight => [...weight] as [number, number])
    weights[row]![part] = next
    update({ weights })
  }
  const updateDirection = (row: number, part: number, degrees: number) => {
    const directionsRad = value.directionsRad.map(direction => [...direction] as [number, number])
    const boundedDegrees = part === 0 ? Math.min(180, Math.max(0, degrees)) : Math.min(180, Math.max(-180, degrees))
    directionsRad[row]![part] = boundedDegrees * Math.PI / 180
    update({ directionsRad })
  }

  return <section aria-label="CST 3D array-factor inputs" className="space-y-4 rounded-xl border border-edge p-4">
    <div>
      <h3 className="font-semibold text-ink">3D array factor</h3>
      <p className="mt-1 text-sm text-muted">Isotropic, uncoupled point elements only. This computes the array factor; it does not model element patterns, mutual coupling, feed networks, or a full CST field solution.</p>
    </div>
    <NumberField label="Frequency (Hz)" value={value.freqHz} min={Number.MIN_VALUE} onChange={freqHz => update({ freqHz })} disabled={disabled} />

    <fieldset disabled={disabled} className="space-y-3">
      <legend className="font-medium text-ink">Element positions and complex voltage weights</legend>
      <p id="cst-array-element-limit" className="text-xs text-muted">Position uses meters. Weight is real + j·imaginary voltage; one weight is required per element. The editor allows up to {MAX_ELEMENTS} elements and {MAX_EVALUATIONS.toLocaleString()} position-direction evaluations.</p>
      <div className="max-h-[32rem] space-y-2 overflow-y-auto" aria-label="Array elements">
      {value.positionsM.map((position, index) => <div key={index} className="rounded-lg bg-surface-muted p-3">
        <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-medium">Element {index + 1}</h4>
          <button type="button" disabled={disabled || value.positionsM.length <= 1} aria-label={`Remove element ${index + 1}`}
            onClick={() => update({ positionsM: value.positionsM.filter((_, i) => i !== index), weights: value.weights.filter((_, i) => i !== index) })}
            className="text-sm text-danger disabled:opacity-50">Remove</button></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(['x', 'y', 'z'] as const).map((axis, axisIndex) => <NumberField key={axis} label={`Element ${index + 1} ${axis} (m)`} value={position[axisIndex]!}
            onChange={next => updatePosition(index, axisIndex, next)} disabled={disabled} />)}
          <NumberField label={`Element ${index + 1} weight real`} value={value.weights[index]?.[0] ?? 1} onChange={next => updateWeight(index, 0, next)} disabled={disabled} />
          <NumberField label={`Element ${index + 1} weight imaginary`} value={value.weights[index]?.[1] ?? 0} onChange={next => updateWeight(index, 1, next)} disabled={disabled} />
        </div>
      </div>)}
      <button type="button" aria-describedby="cst-array-element-limit" disabled={disabled || !canAddElement} onClick={() => update({
        positionsM: [...value.positionsM, [0, 0, 0]], weights: [...value.weights, [1, 0]],
      })} className="rounded-lg border border-edge px-3 py-2 text-sm disabled:opacity-50">Add element</button>
      </div>
    </fieldset>

    <fieldset disabled={disabled} className="space-y-3">
      <legend className="font-medium text-ink">Observation directions</legend>
      <p id="cst-array-direction-limit" className="text-xs text-muted">Enter theta (0–180°) and phi (−180–180°); values are bounded to those ranges, then stored in radians. Up to {MAX_DIRECTIONS.toLocaleString()} directions are allowed, subject to a maximum of {MAX_EVALUATIONS.toLocaleString()} position-direction evaluations.</p>
      <div className="max-h-[32rem] space-y-2 overflow-y-auto" aria-label="Observation directions">
      {value.directionsRad.map(([theta, phi], index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <NumberField label={`Direction ${index + 1} theta (degrees)`} value={theta * 180 / Math.PI} min={0} max={180} onChange={next => updateDirection(index, 0, next)} disabled={disabled} />
        <NumberField label={`Direction ${index + 1} phi (degrees)`} value={phi * 180 / Math.PI} min={-180} max={180} onChange={next => updateDirection(index, 1, next)} disabled={disabled} />
        <button type="button" disabled={disabled || value.directionsRad.length <= 1} aria-label={`Remove direction ${index + 1}`}
          onClick={() => update({ directionsRad: value.directionsRad.filter((_, i) => i !== index) })}
          className="rounded-lg border border-edge px-2 py-1.5 text-sm disabled:opacity-50">Remove</button>
      </div>)}
      <button type="button" aria-describedby="cst-array-direction-limit" disabled={disabled || !canAddDirection} onClick={() => update({ directionsRad: [...value.directionsRad, [Math.PI / 2, 0]] })}
        className="rounded-lg border border-edge px-3 py-2 text-sm disabled:opacity-50">Add direction</button>
      </div>
    </fieldset>
  </section>
}
