import type { AnsysModalStudyDraft } from '../lib/sim/ansys-modal-study-input'

type AnsysModalSetupProps = {
  draft: AnsysModalStudyDraft
  onChange(next: AnsysModalStudyDraft): void
  validationMessage?: string
}

function numericValue(value: string): number {
  return value === '' ? Number.NaN : Number(value)
}

export function AnsysModalSetup({ draft, onChange, validationMessage }: AnsysModalSetupProps) {
  const updateStiffness = (key: keyof AnsysModalStudyDraft['stiffness'], value: string) => {
    onChange({ ...draft, stiffness: { ...draft.stiffness, [key]: numericValue(value) } })
  }
  const updateMass = (key: keyof AnsysModalStudyDraft['mass'], value: string) => {
    onChange({ ...draft, mass: { ...draft.mass, [key]: numericValue(value) } })
  }
  const updateDirection = (index: 0 | 1, value: string) => {
    const direction: [number, number] = [...draft.direction]
    direction[index] = numericValue(value)
    onChange({ ...draft, direction })
  }

  return <section data-testid="ansys-modal-setup" className="space-y-4 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="ansys-modal-setup-title">
    <header>
      <h2 id="ansys-modal-setup-title" className="text-lg font-semibold text-slate-100">Ansys modal study setup</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-400">
        Enter a 2-DOF system with explicit symmetric positive-definite stiffness and mass matrices. This setup uses matrices directly and does not import a mesh.
      </p>
    </header>

    <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="sr-only">Stiffness matrix</legend>
      {([
        ['k11', 'Stiffness k₁₁'],
        ['k12', 'Stiffness k₁₂ (symmetric off-diagonal)'],
        ['k22', 'Stiffness k₂₂'],
      ] as const).map(([key, label]) => <label key={key} className="text-sm text-slate-300">{label}
        <input data-testid={`ansys-modal-${key}`} aria-label={label} type="number" step="any" value={Number.isFinite(draft.stiffness[key]) ? draft.stiffness[key] : ''} onChange={event => updateStiffness(key, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>)}
    </fieldset>

    <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="sr-only">Mass matrix</legend>
      {([
        ['m11', 'Mass m₁₁'],
        ['m12', 'Mass m₁₂ (symmetric off-diagonal)'],
        ['m22', 'Mass m₂₂'],
      ] as const).map(([key, label]) => <label key={key} className="text-sm text-slate-300">{label}
        <input data-testid={`ansys-modal-${key}`} aria-label={label} type="number" step="any" value={Number.isFinite(draft.mass[key]) ? draft.mass[key] : ''} onChange={event => updateMass(key, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>)}
    </fieldset>

    <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="sr-only">Excitation direction and mode count</legend>
      <label className="text-sm text-slate-300">Direction x₁
        <input data-testid="ansys-modal-direction-0" aria-label="Direction x₁" type="number" step="any" value={Number.isFinite(draft.direction[0]) ? draft.direction[0] : ''} onChange={event => updateDirection(0, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">Direction x₂
        <input data-testid="ansys-modal-direction-1" aria-label="Direction x₂" type="number" step="any" value={Number.isFinite(draft.direction[1]) ? draft.direction[1] : ''} onChange={event => updateDirection(1, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">Number of modes
        <select data-testid="ansys-modal-num-modes" aria-label="Number of modes" value={draft.numModes} onChange={event => onChange({ ...draft, numModes: Number(event.currentTarget.value) as 1 | 2 })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2">
          <option value={1}>1</option>
          <option value={2}>2</option>
        </select>
      </label>
    </fieldset>

    {validationMessage && <p data-testid="ansys-modal-validation" role="alert" className="rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{validationMessage}</p>}
  </section>
}
