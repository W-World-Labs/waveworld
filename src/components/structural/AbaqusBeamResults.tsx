import type { AbaqusBeamStudyDraft, AbaqusBeamStudyInput } from '../../lib/sim/abaqus-beam-study-input'
import { abaqusBeamStudyCsv, abaqusBeamStudyReport } from '../../lib/sim/abaqus-beam-study-export'
import type { AbaqusBeamStudyResult } from '../../lib/sim/abaqus-beam-study-result'
import { AbaqusBeamPlot } from './AbaqusBeamPlot'
import { AbaqusBeamTable } from './AbaqusBeamTable'

type Props = {
  draft: AbaqusBeamStudyDraft
  input: AbaqusBeamStudyInput
  result: AbaqusBeamStudyResult
  jobId: string | null
}

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : '—'
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Presents native W-Sim results paired with the exact immutable study snapshot. */
export function AbaqusBeamResults({ draft, input, result, jobId }: Props) {
  const backend = result.backend
  const loadUnit = input.load.type === 'point' ? 'N' : 'N/m'
  const loadName = input.load.type === 'point' ? 'Tip point force' : 'Uniform distributed load'

  return (
    <section data-testid="abaqus-beam-results" aria-labelledby="abaqus-beam-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="abaqus-beam-results-title" className="text-lg font-semibold">Native B31 beam results</h2>
          <p className="mt-1 text-sm text-slate-400">Abaqus-mapped study using the W-Sim native host calculation. Values below are returned by the pinned native module.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="abaqus-beam-download-csv" className="btn border border-edge" onClick={() => download('abaqus-b31-beam-study.csv', abaqusBeamStudyCsv({ draft, input, result, jobId }), 'text/csv;charset=utf-8')}>Download CSV</button>
          <button type="button" data-testid="abaqus-beam-download-json" className="btn border border-edge" onClick={() => download('abaqus-b31-beam-study.json', abaqusBeamStudyReport({ draft, input, result, jobId }), 'application/json;charset=utf-8')}>Download JSON report</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-edge p-3 text-sm" aria-label="Native solver provenance">
          <div><span className="text-slate-400">Calculation: </span><strong className="font-medium">W-Sim native host-f64 (CPU)</strong></div>
          <div className="mt-1 break-all text-xs text-slate-400">Module: {result.module} · {result.methodId}</div>
          <div className="mt-1 break-all text-xs text-slate-400">Family: {result.familyId} · element: {result.element}</div>
          <div className="mt-1 break-all text-xs text-slate-400">Returned backend: {backend.id} ({backend.kind}; {backend.deviceName})</div>
          <div className="mt-1 break-all text-xs text-slate-400">Native module pin: dda2f6f1</div>
        </div>
        <div className="rounded border border-edge p-3 text-sm"><span className="text-slate-400">Submitted job: </span><span className="font-medium">{jobId || 'unavailable'}</span></div>
      </div>

      <details className="rounded border border-edge p-3" open>
        <summary className="cursor-pointer text-sm font-medium">Submitted configuration snapshot</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-slate-400">Element / boundary</dt><dd>{input.element} · {input.boundary}</dd></div>
          <div><dt className="text-slate-400">Length</dt><dd>{format(input.length)} m</dd></div>
          <div><dt className="text-slate-400">Elements</dt><dd>{input.elements}</dd></div>
          <div><dt className="text-slate-400">Young’s modulus E</dt><dd>{format(input.section.E)} Pa</dd></div>
          <div><dt className="text-slate-400">Area A</dt><dd>{format(input.section.A)} m²</dd></div>
          <div><dt className="text-slate-400">Second moment I</dt><dd>{format(input.section.I)} m⁴</dd></div>
          <div><dt className="text-slate-400">Poisson ratio ν</dt><dd>{format(input.section.nu)}</dd></div>
          <div><dt className="text-slate-400">Shear correction k</dt><dd>{format(input.section.k)}</dd></div>
          <div><dt className="text-slate-400">{loadName}</dt><dd>{format(input.load.value)} {loadUnit}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Editor snapshot: {format(draft.length)} m · {draft.elements} elements · {draft.load.type} load {format(draft.load.value)} {draft.load.type === 'point' ? 'N' : 'N/m'}</p>
      </details>

      <div className="grid gap-3 sm:grid-cols-2">
        <p className="rounded border border-edge p-3 text-sm"><span className="text-slate-400">Maximum returned transverse displacement: </span><strong>{format(result.maxDeflection)} m</strong><span className="mt-1 block text-xs text-slate-400">Free-end probe: v = {format(result.probe.v)} m, θ = {format(result.probe.theta)} rad</span></p>
        <p className="rounded border border-edge p-3 text-sm"><span className="text-slate-400">Maximum returned moment: </span><strong>{format(result.maxMoment)} N·m</strong></p>
      </div>

      <AbaqusBeamPlot nodes={result.nodes} />
      <AbaqusBeamTable result={result} />

      <details className="rounded border border-edge p-3">
        <summary className="cursor-pointer text-sm font-medium">Native closedForm textbook check</summary>
        {result.closedForm === null ? (
          <p className="mt-2 text-sm text-slate-400">The native result did not report a closed-form comparison for this load case.</p>
        ) : (
          <dl data-testid="abaqus-beam-closed-form" className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-400">Textbook deflection</dt><dd>{format(result.closedForm.deflection)} m</dd></div>
            <div><dt className="text-slate-400">Textbook rotation</dt><dd>{format(result.closedForm.rotation)} rad</dd></div>
            <div><dt className="text-slate-400">Textbook maximum moment</dt><dd>{format(result.closedForm.maxMoment)} N·m</dd></div>
          </dl>
        )}
        <p className="mt-2 text-xs text-slate-500">This is the native module’s textbook comparison for its supported canonical load case. It is not an Abaqus result or validation oracle.</p>
      </details>

      <p className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-400">Scope: linear-elastic 2D, 2-node B31 Timoshenko cantilever with a uniform section and one positive transverse tip force or uniform load. No Abaqus execution, general .inp import, full vendor parity, or certified design is represented. Springs, axial or moment loads, other boundaries, B32, 3D frames, nonlinear and dynamic cases are outside this study.</p>
    </section>
  )
}
