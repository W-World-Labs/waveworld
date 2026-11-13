import type { LensSurfaceDraft } from '../../lib/sim/lens-study-input'

type Props = {
  surfaces: LensSurfaceDraft[]
  onChange: (next: LensSurfaceDraft[]) => void
}

const fieldClass = 'w-24 rounded border border-edge bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60'

function numericValue(value: string): number {
  // Keep an empty or incomplete field invalid; validation belongs to the draft
  // builder, and an empty field must never turn into a valid zero by accident.
  return value.trim() === '' ? Number.NaN : Number(value)
}

function displayNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : ''
}

/** Bounded sequential prescription editor for plane and spherical surfaces. */
export function LensSurfaceEditor({ surfaces, onChange }: Props) {
  function update(index: number, patch: Partial<LensSurfaceDraft>) {
    onChange(surfaces.map((surface, row) => row === index ? { ...surface, ...patch } : surface))
  }

  function addSurface() {
    if (surfaces.length >= 8) return
    const next = surfaces.map((surface, index) => index === surfaces.length - 1
      ? { ...surface, thickness: 5 }
      : { ...surface })
    next.push({ type: 'plane', radius: 0, aperture: 5, thickness: 0, nAfter: 1 })
    onChange(next)
  }

  function removeSurface(index: number) {
    if (surfaces.length <= 1) return
    const next = surfaces.filter((_, row) => row !== index).map((surface) => ({ ...surface }))
    next[next.length - 1] = { ...next[next.length - 1], thickness: 0 }
    onChange(next)
  }

  return (
    <section data-testid="lens-surface-editor" className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Sequential lens surfaces; refractive index before each row follows from the preceding medium.</caption>
          <thead>
            <tr className="border-b border-edge text-xs text-muted">
              <th scope="col" className="p-2">Surface</th>
              <th scope="col" className="p-2">Type</th>
              <th scope="col" className="p-2">Radius (mm)</th>
              <th scope="col" className="p-2">Aperture (mm)</th>
              <th scope="col" className="p-2">Gap after (mm)</th>
              <th scope="col" className="p-2">Index after</th>
              <th scope="col" className="p-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {surfaces.map((surface, index) => {
              const last = index === surfaces.length - 1
              return (
                <tr key={index} className="border-b border-edge/60">
                  <th scope="row" className="p-2 font-medium">{index + 1}</th>
                  <td className="p-2">
                    <select
                      data-testid={`lens-surface-type-${index}`}
                      aria-label={`Surface ${index + 1} type`}
                      value={surface.type}
                      onChange={(event) => update(index, { type: event.target.value as LensSurfaceDraft['type'] })}
                      className={fieldClass}
                    >
                      <option value="plane">Plane</option>
                      <option value="spherical">Spherical</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      data-testid={`lens-radius-${index}`}
                      aria-label={`Surface ${index + 1} radius (mm)`}
                      type="number" step="any" value={displayNumber(surface.radius)}
                      disabled={surface.type === 'plane'}
                      onChange={(event) => update(index, { radius: numericValue(event.target.value) })}
                      className={fieldClass}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      data-testid={`lens-aperture-${index}`}
                      aria-label={`Surface ${index + 1} aperture (mm)`}
                      type="number" min="0" step="any" value={displayNumber(surface.aperture)}
                      onChange={(event) => update(index, { aperture: numericValue(event.target.value) })}
                      className={fieldClass}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      data-testid={`lens-thickness-${index}`}
                      aria-label={`Surface ${index + 1} gap after (mm)`}
                      type="number" min="0" step="any" value={last ? '0' : displayNumber(surface.thickness)}
                      disabled={last}
                      onChange={(event) => update(index, { thickness: numericValue(event.target.value) })}
                      className={fieldClass}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      data-testid={`lens-index-${index}`}
                      aria-label={`Refractive index after surface ${index + 1}`}
                      type="number" min="1" step="any" value={displayNumber(surface.nAfter)}
                      onChange={(event) => update(index, { nAfter: numericValue(event.target.value) })}
                      className={fieldClass}
                    />
                  </td>
                  <td className="p-2">
                    <button
                      type="button" data-testid={`lens-remove-surface-${index}`}
                      aria-label={`Remove surface ${index + 1}`}
                      disabled={surfaces.length <= 1}
                      onClick={() => removeSurface(index)}
                      className="rounded border border-edge px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >Remove</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button" data-testid="lens-add-surface" onClick={addSurface}
        disabled={surfaces.length >= 8}
        className="rounded border border-edge px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >Add surface</button>
      <p className="text-xs text-muted">Plane surfaces use no radius. Each row’s incoming index follows the previous row; the final gap is fixed at 0 mm.</p>
    </section>
  )
}
