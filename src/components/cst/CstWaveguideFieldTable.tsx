export type CstWaveguideFieldSample = {
  x: number
  y: number
  exMagnitude: number
  eyMagnitude: number
  ezMagnitude: number
}

type Props<Row extends CstWaveguideFieldSample = CstWaveguideFieldSample> = {
  rows: readonly Row[]
  family: string
  normalization: string
}

function display(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : '—'
}

/** Displays native waveguide field samples without deriving field values. */
export function CstWaveguideFieldTable<Row extends CstWaveguideFieldSample>({
  rows,
  family,
  normalization,
}: Props<Row>) {
  return <section className="mt-4 rounded-lg border border-edge bg-panel p-4" aria-labelledby="cst-waveguide-fields-title">
    <div className="mb-3">
      <h3 id="cst-waveguide-fields-title" className="text-sm font-semibold text-slate-100">Waveguide electric-field samples</h3>
      <p className="mt-1 text-xs text-slate-400">{family} mode · normalization: {normalization}</p>
    </div>
    <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Waveguide field samples table (scrollable)">
      <table className="w-full whitespace-nowrap text-right text-xs" aria-label={`${family} waveguide electric-field samples`}>
        <caption className="sr-only">Native-returned electric-field magnitudes at sampled waveguide coordinates</caption>
        <thead className="sticky top-0 bg-panel text-slate-300">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">x / m</th>
            <th scope="col" className="px-3 py-2 font-medium">y / m</th>
            <th scope="col" className="px-3 py-2 font-medium">|Ex| / V/m</th>
            <th scope="col" className="px-3 py-2 font-medium">|Ey| / V/m</th>
            <th scope="col" className="px-3 py-2 font-medium">|Ez| / V/m</th>
          </tr>
        </thead>
        <tbody className="font-mono text-slate-300">
          {rows.map((row, index) => <tr key={`${row.x}-${row.y}-${index}`} className="border-t border-edge">
            <td className="px-3 py-2">{display(row.x)}</td>
            <td className="px-3 py-2">{display(row.y)}</td>
            <td className="px-3 py-2">{display(row.exMagnitude)}</td>
            <td className="px-3 py-2">{display(row.eyMagnitude)}</td>
            <td className="px-3 py-2">{display(row.ezMagnitude)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>
}
