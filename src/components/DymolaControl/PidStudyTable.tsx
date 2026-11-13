import type { PidStudyResult } from '../../lib/sim/dymola-pid-study-result'

type Props = Pick<PidStudyResult, 'times' | 'output'>

function formatFinite(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return Number(value.toPrecision(7)).toString()
}

/** Shows the native PI study samples exactly as returned by the solver. */
export function PidStudyTable({ times, output }: Props) {
  const sampleCount = Math.max(times.length, output.length)

  return (
    <div data-testid="pid-study-table-container" className="overflow-x-auto">
      <table data-testid="pid-study-table" className="w-full border-collapse text-sm">
        <caption className="pb-2 text-left font-medium">Native PI response samples</caption>
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="px-2 py-1">Time (s)</th>
            <th scope="col" className="px-2 py-1">Output (process units)</th>
          </tr>
        </thead>
        <tbody>
          {sampleCount === 0 ? (
            <tr data-testid="pid-study-empty">
              <td className="px-2 py-2 text-muted-foreground" colSpan={2}>No native samples available.</td>
            </tr>
          ) : Array.from({ length: sampleCount }, (_, index) => (
            <tr key={index} data-testid="pid-study-sample" className="border-b">
              <td className="px-2 py-1">{formatFinite(times[index])}</td>
              <td className="px-2 py-1">{formatFinite(output[index])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
