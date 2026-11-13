import type { AbaqusMaterialPointResult } from '../../lib/sim/abaqus-material-point-result'

export type AbaqusMaterialPointInput = {
  module: 'sw-calculix-plasticity'
  E: number
  nu: number
  yieldStress: number
  hardening?: number
  hardeningCurve?: [number, number][]
  strainIncrements: number[][]
}

type Props = { result: AbaqusMaterialPointResult; input: AbaqusMaterialPointInput; jobId: string | null }

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

const format = (value: number) => Number(value.toPrecision(7)).toString()

function csv({ input, result, jobId }: Props): string {
  const metadata = JSON.stringify({ jobId, input, result })
  const rows = result.history.map((item) => [
    item.step, ...item.totalStrain, ...item.stress, ...item.plasticStrain,
    item.equivalentPlasticStrain, item.vonMises, item.yielded,
  ].join(','))
  return `# ${metadata}\nstep,total_strain_11,total_strain_22,total_strain_33,total_strain_12,total_strain_13,total_strain_23,stress_11,stress_22,stress_33,stress_12,stress_13,stress_23,plastic_strain_11,plastic_strain_22,plastic_strain_33,plastic_strain_12,plastic_strain_13,plastic_strain_23,equivalent_plastic_strain,von_mises,yielded\n${rows.join('\n')}\n`
}

/** Shows the bounded native material-point calculation alongside its exact submitted snapshot. */
export function AbaqusMaterialPointResults({ result, input, jobId }: Props) {
  const last = result.history[result.history.length - 1]
  return (
    <section data-testid="abaqus-material-point-results" aria-labelledby="abaqus-material-point-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="abaqus-material-point-results-title" className="text-lg font-semibold">Material-point plasticity results</h2>
          <p className="mt-1 text-sm text-slate-400">Single material-point history returned by the existing W-Sim `sw-calculix-plasticity` operation.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" data-testid="abaqus-material-point-results-download-csv" className="btn border border-edge" onClick={() => download('abaqus-material-point-results.csv', csv({ input, result, jobId }), 'text/csv;charset=utf-8')}>Download CSV</button>
          <button type="button" data-testid="abaqus-material-point-results-download-json" className="btn border border-edge" onClick={() => download('abaqus-material-point-results.json', JSON.stringify({ jobId, input, result }, null, 2), 'application/json;charset=utf-8')}>Download JSON report</button>
        </div>
      </div>

      <p className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-400">This is a single material-point study. It does not model a structural mesh, boundary conditions, spatial stress concentrations, or general Abaqus execution, and it is not certified design evidence.</p>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-edge p-3"><dt className="text-xs text-slate-400">Final equivalent plastic strain (PEEQ)</dt><dd className="mt-1 font-semibold">{format(result.summary.finalEquivalentPlasticStrain)}</dd></div>
        <div className="rounded border border-edge p-3"><dt className="text-xs text-slate-400">Final von Mises stress</dt><dd className="mt-1 font-semibold">{format(result.summary.finalVonMises)}</dd><dd className="text-xs text-slate-500">Same stress units as E and yield stress</dd></div>
        <div className="rounded border border-edge p-3"><dt className="text-xs text-slate-400">Yielded steps</dt><dd className="mt-1 font-semibold">{result.summary.yieldedSteps} / {result.summary.steps}</dd></div>
      </dl>

      <details className="rounded border border-edge p-3">
        <summary className="cursor-pointer text-sm font-medium">Submitted material and loading snapshot</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-400">Young’s modulus E</dt><dd>{format(input.E)}</dd></div>
          <div><dt className="text-slate-400">Poisson ratio ν</dt><dd>{format(input.nu)}</dd></div>
          <div><dt className="text-slate-400">Initial yield stress</dt><dd>{format(input.yieldStress)}</dd></div>
          <div><dt className="text-slate-400">Job</dt><dd>{jobId || 'unavailable'}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Shear strain increments use the engineering convention γᵢⱼ = 2εᵢⱼ. The six-component vectors are ordered 11, 22, 33, 12, 13, 23. Stress outputs use the same stress units as E and yield stress.</p>
        <p className="mt-1 text-xs text-slate-500">Hardening: {input.hardening !== undefined ? (input.hardening === 0 ? 'perfectly plastic' : format(input.hardening)) : 'piecewise-linear isotropic curve'} · hardening curve points: {input.hardeningCurve?.map(([strain, stress]) => `(${format(strain)}, ${format(stress)})`).join(', ') || 'none'} · strain increments: {input.strainIncrements.map((increment) => `[${increment.map(format).join(', ')}]`).join(', ')}</p>
      </details>

      <div className="overflow-x-auto rounded border border-edge">
        <table className="w-full min-w-[840px] text-left text-xs">
          <thead className="bg-surface text-slate-400"><tr><th className="p-2">Step</th><th className="p-2">Total strain vector</th><th className="p-2">Stress vector</th><th className="p-2">Plastic strain vector</th><th className="p-2">PEEQ</th><th className="p-2">von Mises</th><th className="p-2">Yielded</th></tr></thead>
          <tbody>{result.history.map((item) => <tr key={item.step} className="border-t border-edge"><td className="p-2">{item.step}</td><td className="p-2 font-mono">{item.totalStrain.map(format).join(', ')}</td><td className="p-2 font-mono">{item.stress.map(format).join(', ')}</td><td className="p-2 font-mono">{item.plasticStrain.map(format).join(', ')}</td><td className="p-2">{format(item.equivalentPlasticStrain)}</td><td className="p-2">{format(item.vonMises)}</td><td className="p-2">{item.yielded ? 'Yes' : 'No'}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Returned history: {result.history.length} steps · final plastic strain tensor norm components: {last?.plasticStrain.map(format).join(', ')}</p>
    </section>
  )
}
