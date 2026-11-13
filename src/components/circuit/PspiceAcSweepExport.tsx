import type { PspiceAcSweepResultRow } from '../../lib/sim/pspice-ac-sweep'
import { useLocale } from '../../lib/i18n/LocaleContext'

type Props = { rows: readonly PspiceAcSweepResultRow[] }

const PSPICE_AC_NATIVE_PIN = 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14'

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function report(rows: readonly PspiceAcSweepResultRow[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    workflow: 'waveworld-pspice-ac-sweep',
    nativePin: PSPICE_AC_NATIVE_PIN,
    captureStatus: 'completed-points-only',
    points: rows.map(row => ({
      frequencyHz: row.frequencyHz,
      jobId: 'jobId' in row ? row.jobId : undefined,
      input: row.input,
      spec: row.spec,
      nodeMap: row.nodeMap,
      result: row.result,
      backend: row.result.backend,
    })),
    note: 'Only completed point captures are included; absent frequencies are not represented as successful results.',
  }, null, 2) + '\n'
}

function csv(rows: readonly PspiceAcSweepResultRow[]): string {
  const records: Array<Array<string | number>> = [[
    'frequency_hz', 'omega', 'node', 'magnitude', 'phase_rad', 'phase_deg',
  ]]
  for (const row of rows) {
    for (const [node, phasor] of Object.entries(row.result.nodePhasors)) {
      records.push([
        row.frequencyHz,
        row.result.omega,
        node,
        phasor.magnitude,
        phasor.phaseRad,
        phasor.phaseDeg,
      ])
    }
  }
  return records.map(record => record.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function PspiceAcSweepExport({ rows }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const disabled = rows.length === 0

  return (
    <div className="flex flex-wrap gap-2" aria-label={zh ? '导出交流扫描结果' : 'Export AC sweep results'}>
      <button
        type="button"
        data-testid="pspice-ac-sweep-json"
        disabled={disabled}
        onClick={() => download('waveworld-pspice-ac-sweep.json', report(rows), 'application/json;charset=utf-8')}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600"
      >
        {zh ? '下载 JSON' : 'Download JSON'}
      </button>
      <button
        type="button"
        data-testid="pspice-ac-sweep-csv"
        disabled={disabled}
        onClick={() => download('waveworld-pspice-ac-sweep.csv', csv(rows), 'text/csv;charset=utf-8')}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600"
      >
        {zh ? '下载 CSV' : 'Download CSV'}
      </button>
    </div>
  )
}
