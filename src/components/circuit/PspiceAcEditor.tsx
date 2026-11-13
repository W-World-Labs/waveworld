import { useMemo, useState } from 'react'
import { createPspiceAcJob, type PspiceAcStudyInput } from '../../lib/sim/pspice-ac-adapter'
import { buildPspiceAcSweepPlan, type PspiceAcSweepStudyInput } from '../../lib/sim/pspice-ac-sweep'
import { useLocale } from '../../lib/i18n'

type ElementKind = 'resistor' | 'capacitor' | 'inductor' | 'voltageSource' | 'currentSource'
type DraftElement = { id: string; kind: ElementKind; a: number; b: number; value: number }

type Props = {
  onRun: (input: PspiceAcStudyInput | PspiceAcSweepStudyInput) => void
  running: boolean
  onInputChange?: () => void
  onCancel?: () => void
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink'
const initialRows: DraftElement[] = [
  { id: 'R1', kind: 'resistor', a: 1, b: 2, value: 1000 },
  { id: 'R2', kind: 'resistor', a: 2, b: 0, value: 1000 },
  { id: 'V1', kind: 'voltageSource', a: 1, b: 0, value: 1 },
]

function readNumber(raw: string) { return raw.trim() === '' ? Number.NaN : Number(raw) }

/** A structured single-frequency MNA circuit editor; no text netlist is accepted. */
export function PspiceAcEditor({ onRun, running, onInputChange, onCancel }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [frequencyHz, setFrequencyHz] = useState(1000)
  const [sweepEnabled, setSweepEnabled] = useState(false)
  const [sweepScale, setSweepScale] = useState<'linear' | 'log'>('log')
  const [sweepStartFrequencyHz, setSweepStartFrequencyHz] = useState(10)
  const [sweepStopFrequencyHz, setSweepStopFrequencyHz] = useState(100000)
  const [sweepPoints, setSweepPoints] = useState(11)
  const [nodeCount, setNodeCount] = useState(2)
  const [rows, setRows] = useState(initialRows)
  const [error, setError] = useState('')
  const nodes = useMemo(() => Array.from({ length: Number.isInteger(nodeCount) && nodeCount >= 1 && nodeCount <= 64 ? nodeCount : 1 }, (_, i) => i + 1), [nodeCount])
  const nodeOptions = [0, ...nodes]
  const label = (kind: ElementKind) => ({
    resistor: zh ? '电阻' : 'Resistor', capacitor: zh ? '电容' : 'Capacitor', inductor: zh ? '电感' : 'Inductor',
    voltageSource: zh ? '电压源' : 'Voltage source', currentSource: zh ? '电流源' : 'Current source',
  })[kind]
  const unit = (kind: ElementKind) => ({ resistor: 'Ω', capacitor: 'F', inductor: 'H', voltageSource: 'V', currentSource: 'A' })[kind]
  const add = (kind: ElementKind) => {
    if (rows.length >= 512) return
    const prefix = ({ resistor: 'R', capacitor: 'C', inductor: 'L', voltageSource: 'V', currentSource: 'I' })[kind]
    const serial = rows.filter(row => row.kind === kind).length + 1
    onInputChange?.()
    setRows(current => [...current, { id: `${prefix}${serial}`, kind, a: 1, b: 0, value: kind === 'resistor' ? 1000 : kind === 'voltageSource' ? 1 : kind === 'currentSource' ? 0.001 : 1e-6 }])
    setError('')
  }
  const update = (id: string, patch: Partial<DraftElement>) => {
    onInputChange?.()
    setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row))
  }
  const run = () => {
    setError('')
    try {
      const nodeLabels = nodes.map((node) => `N${node}`)
      const circuit = {
        nodes: nodeCount,
        resistors: rows.filter(row => row.kind === 'resistor').map(row => ({ a: row.a, b: row.b, r: row.value })),
        capacitors: rows.filter(row => row.kind === 'capacitor').map(row => ({ a: row.a, b: row.b, c: row.value })),
        inductors: rows.filter(row => row.kind === 'inductor').map(row => ({ a: row.a, b: row.b, l: row.value })),
        vSources: rows.filter(row => row.kind === 'voltageSource').map(row => ({ a: row.a, b: row.b, v: row.value })),
        iSources: rows.filter(row => row.kind === 'currentSource').map(row => ({ a: row.a, b: row.b, i: row.value })),
      }
      if (sweepEnabled) {
        const input: PspiceAcSweepStudyInput = {
          circuit,
          nodeLabels,
          sweep: { scale: sweepScale, startFrequencyHz: sweepStartFrequencyHz, stopFrequencyHz: sweepStopFrequencyHz, points: sweepPoints },
        }
        buildPspiceAcSweepPlan(input)
        onRun(input)
      } else {
        const input: PspiceAcStudyInput = { frequencyHz, nodeLabels, circuit }
        createPspiceAcJob(input)
        onRun(input)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '电路输入无效。' : 'Circuit input is invalid.'))
    }
  }

  return (
    <section id="pspice-ac-editor" data-testid="pspice-ac-editor" className="space-y-5 rounded-xl border border-edge bg-surface p-4" aria-labelledby="pspice-ac-title">
      <div>
        <h2 id="pspice-ac-title" className="text-lg font-semibold text-ink">{zh ? '交流相量研究' : 'AC phasor study'}</h2>
        <p className="mt-1 text-sm text-muted">{zh ? '直接编辑线性元件和节点。节点 0 表示地；电源幅值按相量峰值输入。默认使用单频分析。' : 'Edit linear elements and nodes directly. Node 0 is ground; source amplitudes are entered as phasor peak values. Single-frequency analysis is the default.'}</p>
      </div>
      <button id="pspice-ac-reset" data-testid="pspice-ac-reset" type="button" onClick={() => {
        onInputChange?.()
        setFrequencyHz(1000)
        setSweepEnabled(false)
        setSweepScale('log')
        setSweepStartFrequencyHz(10)
        setSweepStopFrequencyHz(100000)
        setSweepPoints(11)
        setNodeCount(2)
        setRows(initialRows)
        setError('')
      }} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink">{zh ? '重置输入' : 'Reset inputs'}</button>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-ink"><span>{zh ? '频率 (Hz)' : 'Frequency (Hz)'}</span><input id="pspice-ac-frequency-hz" data-testid="pspice-ac-frequency-hz" aria-label={zh ? '频率 (Hz)' : 'Frequency (Hz)'} type="number" min="0.000001" max="1000000000000" step="any" value={frequencyHz} onChange={e => { onInputChange?.(); setFrequencyHz(readNumber(e.target.value)) }} className={fieldClass} /></label>
        <label className="block text-sm text-ink"><span>{zh ? '非地节点数 (1–64)' : 'Non-ground nodes (1–64)'}</span><input id="pspice-ac-node-count" data-testid="pspice-ac-node-count" aria-label={zh ? '非地节点数' : 'Non-ground nodes'} type="number" min="1" max="64" step="1" value={Number.isFinite(nodeCount) ? nodeCount : ''} onChange={e => { onInputChange?.(); setNodeCount(readNumber(e.target.value)) }} className={fieldClass} /></label>
      </div>
      <fieldset className="space-y-3 rounded-lg border border-edge p-3">
        <legend className="px-1 text-sm font-medium text-ink">{zh ? '频率扫描（可选）' : 'Frequency sweep (optional)'}</legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input id="pspice-ac-sweep-enabled" data-testid="pspice-ac-sweep-enabled" type="checkbox" checked={sweepEnabled} onChange={e => { onInputChange?.(); setSweepEnabled(e.target.checked) }} />
          {zh ? '扫描频率范围' : 'Sweep a frequency range'}
        </label>
        {sweepEnabled && <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-ink"><span>{zh ? '扫描方式' : 'Sweep scale'}</span><select id="pspice-ac-sweep-scale" data-testid="pspice-ac-sweep-scale" aria-label={zh ? '扫描方式' : 'Sweep scale'} value={sweepScale} onChange={e => { onInputChange?.(); setSweepScale(e.target.value as 'linear' | 'log') }} className={fieldClass}><option value="linear">{zh ? '线性' : 'Linear'}</option><option value="log">{zh ? '对数' : 'Logarithmic'}</option></select></label>
          <label className="block text-sm text-ink"><span>{zh ? '起始频率 (Hz)' : 'Start frequency (Hz)'}</span><input id="pspice-ac-sweep-start-hz" data-testid="pspice-ac-sweep-start-hz" aria-label={zh ? '起始频率 (Hz)' : 'Start frequency (Hz)'} type="number" min="0.000001" max="1000000000000" step="any" value={sweepStartFrequencyHz} onChange={e => { onInputChange?.(); setSweepStartFrequencyHz(readNumber(e.target.value)) }} className={fieldClass} /></label>
          <label className="block text-sm text-ink"><span>{zh ? '终止频率 (Hz)' : 'Stop frequency (Hz)'}</span><input id="pspice-ac-sweep-stop-hz" data-testid="pspice-ac-sweep-stop-hz" aria-label={zh ? '终止频率 (Hz)' : 'Stop frequency (Hz)'} type="number" min="0.000001" max="1000000000000" step="any" value={sweepStopFrequencyHz} onChange={e => { onInputChange?.(); setSweepStopFrequencyHz(readNumber(e.target.value)) }} className={fieldClass} /></label>
          <label className="block text-sm text-ink"><span>{zh ? '扫描点数 (2–31)' : 'Points (2–31)'}</span><input id="pspice-ac-sweep-points" data-testid="pspice-ac-sweep-points" aria-label={zh ? '扫描点数 (2–31)' : 'Points (2–31)'} type="number" min="2" max="31" step="1" value={Number.isFinite(sweepPoints) ? sweepPoints : ''} onChange={e => { onInputChange?.(); setSweepPoints(readNumber(e.target.value)) }} className={fieldClass} /></label>
        </div>}
      </fieldset>
      <div className="space-y-3">
        {rows.map((row, index) => {
          const kindIndex = rows.slice(0, index + 1).filter(item => item.kind === row.kind).length
          return <div key={`${row.id}-${index}`} data-testid={`pspice-ac-row-${row.kind}-${kindIndex}`} className="grid items-end gap-3 rounded-lg border border-edge p-3 sm:grid-cols-[1fr_1fr_1fr_1.2fr_auto]">
          <label className="block text-sm text-ink"><span>{zh ? '元件' : 'Element'}</span><select id={`pspice-ac-${row.kind}-${kindIndex}-type`} data-testid={`pspice-ac-${row.kind}-${kindIndex}-type`} aria-label={`${label(row.kind)} ${index + 1}`} value={row.kind} onChange={e => update(row.id, { kind: e.target.value as ElementKind })} className={fieldClass}>{(['resistor', 'capacitor', 'inductor', 'voltageSource', 'currentSource'] as ElementKind[]).map(kind => <option key={kind} value={kind}>{label(kind)}</option>)}</select></label>
          <label className="block text-sm text-ink"><span>{zh ? '节点 A' : 'Node A'}</span><select id={row.kind === 'resistor' ? `pspice-ac-resistor-${kindIndex}-a` : row.kind === 'voltageSource' ? `pspice-ac-source-${kindIndex}-a` : undefined} data-testid={row.kind === 'resistor' ? `pspice-ac-resistor-${kindIndex}-a` : row.kind === 'voltageSource' ? `pspice-ac-source-${kindIndex}-a` : undefined} aria-label={`${zh ? '节点 A' : 'Node A'} ${kindIndex}`} value={row.a} onChange={e => update(row.id, { a: Number(e.target.value) })} className={fieldClass}>{nodeOptions.map(node => <option key={node} value={node}>{node === 0 ? '0 · GND' : `N${node}`}</option>)}</select></label>
          <label className="block text-sm text-ink"><span>{zh ? '节点 B' : 'Node B'}</span><select id={row.kind === 'resistor' ? `pspice-ac-resistor-${kindIndex}-b` : row.kind === 'voltageSource' ? `pspice-ac-source-${kindIndex}-b` : undefined} data-testid={row.kind === 'resistor' ? `pspice-ac-resistor-${kindIndex}-b` : row.kind === 'voltageSource' ? `pspice-ac-source-${kindIndex}-b` : undefined} aria-label={`${zh ? '节点 B' : 'Node B'} ${kindIndex}`} value={row.b} onChange={e => update(row.id, { b: Number(e.target.value) })} className={fieldClass}>{nodeOptions.map(node => <option key={node} value={node}>{node === 0 ? '0 · GND' : `N${node}`}</option>)}</select></label>
          <label className="block text-sm text-ink"><span>{label(row.kind)} ({unit(row.kind)})</span><input id={row.kind === 'resistor' ? `pspice-ac-resistor-${kindIndex}-ohms` : row.kind === 'voltageSource' ? `pspice-ac-source-${kindIndex}-volts` : undefined} data-testid={row.kind === 'resistor' ? `pspice-ac-resistor-${kindIndex}-ohms` : row.kind === 'voltageSource' ? `pspice-ac-source-${kindIndex}-volts` : undefined} aria-label={`${label(row.kind)} ${unit(row.kind)} ${kindIndex}`} type="number" step="any" value={Number.isFinite(row.value) ? row.value : ''} onChange={e => update(row.id, { value: readNumber(e.target.value) })} className={fieldClass} /></label>
          <button type="button" disabled={rows.length <= 1} onClick={() => { onInputChange?.(); setRows(current => current.filter(item => item !== row)) }} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink disabled:opacity-50">{zh ? '移除' : 'Remove'}</button>
        </div>})}
      </div>
      <div className="flex flex-wrap gap-2">{(['resistor', 'capacitor', 'inductor', 'voltageSource', 'currentSource'] as ElementKind[]).map(kind => <button type="button" key={kind} disabled={rows.length >= 512} onClick={() => add(kind)} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink disabled:opacity-50">{zh ? `添加${label(kind)}` : `Add ${label(kind)}`}</button>)}</div>
      <p className="text-xs text-muted">{zh ? '采用 1 kΩ + 1 kΩ 电阻分压器作为起始示例。R、L、C 必须为正值；频率范围 1e−6 至 1e12 Hz；最多 512 个元件。' : 'Starts with a 1 kΩ + 1 kΩ resistive divider. R, L, and C must be positive; frequency range is 1e−6 to 1e12 Hz; up to 512 elements.'}</p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {running ? <button id="pspice-ac-cancel" data-testid="pspice-ac-cancel" type="button" onClick={onCancel} disabled={!onCancel} className="rounded-lg border border-edge px-4 py-2 font-medium text-ink disabled:opacity-50">{zh ? '取消' : 'Cancel'}</button> : <button id="pspice-ac-run" data-testid="pspice-ac-run" type="button" onClick={run} disabled={(!sweepEnabled && (!Number.isFinite(frequencyHz) || frequencyHz < 1e-6 || frequencyHz > 1e12)) || (sweepEnabled && (!Number.isFinite(sweepStartFrequencyHz) || !Number.isFinite(sweepStopFrequencyHz) || sweepStartFrequencyHz < 1e-6 || sweepStartFrequencyHz > 1e12 || sweepStopFrequencyHz < 1e-6 || sweepStopFrequencyHz > 1e12 || sweepStartFrequencyHz >= sweepStopFrequencyHz || !Number.isInteger(sweepPoints) || sweepPoints < 2 || sweepPoints > 31)) || !Number.isInteger(nodeCount) || nodeCount < 1 || nodeCount > 64 || rows.length === 0 || rows.length > 512} className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-50">{sweepEnabled ? (zh ? '运行频率扫描' : 'Run frequency sweep') : (zh ? '运行相量研究' : 'Run phasor study')}</button>}
    </section>
  )
}

export default PspiceAcEditor
