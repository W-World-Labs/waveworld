import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createModuleJobSpec, readModuleJobInput, readModuleResult, type SwModuleInput } from '../../lib/sim/module-compute'

const MODULE_ID = 'sw-gromacs-inputdeck' as const
const MAX_GRO_BYTES = 16 * 1024 * 1024

type GroAtomPreview = {
  resid: number
  resname: string
  atom: string
  number: number
  posNm: [number, number, number]
  velNmPs: [number, number, number] | null
}

type GroPreview = {
  title: string
  natoms: number
  boxNm: number[]
  nVelocities: number
  atomsPreview: GroAtomPreview[]
}

type SavedPreview = { source: string; result: GroPreview; jobId: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

function fixedWidthPreflight(source: string, zh: boolean): string | null {
  const lines = source.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
  if (lines.length < 3) return zh ? '文件必须包含标题、原子数和盒子行。' : 'The file must contain a title, atom count, and box line.'
  const countText = lines[1].trim()
  if (!/^\d+$/.test(countText)) return zh ? '原子数行必须是正整数。' : 'The atom count line must be a positive integer.'
  const atomCount = Number(countText)
  if (!Number.isSafeInteger(atomCount) || atomCount < 1 || atomCount > 200_000) {
    return zh ? '原子数必须在 1 到 200,000 之间。' : 'Atom count must be between 1 and 200,000.'
  }
  if (lines.length < atomCount + 3) return zh ? '声明的原子数超过文件中的原子行数。' : 'The declared atom count exceeds the atom rows in the file.'
  if (lines.slice(atomCount + 3).some(line => line.trim() !== '')) {
    return zh ? '当前读取器仅支持单帧 .gro 文件。' : 'This reader supports one .gro frame at a time.'
  }
  let rowWidth: number | null = null
  for (let index = 0; index < atomCount; index += 1) {
    const width = lines[index + 2].length
    if (width !== 44 && width !== 68) {
      return zh
        ? `原子行 ${index + 1} 有 ${width} 列；当前读取器仅支持 44 列位置或 68 列位置与速度格式。`
        : `Atom row ${index + 1} has ${width} columns; this reader supports only 44-column position or 68-column position-and-velocity rows.`
    }
    if (rowWidth !== null && width !== rowWidth) {
      return zh ? '同一帧的原子行必须全部提供速度或全部省略速度。' : 'Atom rows in one frame must either all include velocities or all omit them.'
    }
    rowWidth = width
  }
  return null
}

function parseGroPreview(value: unknown): GroPreview {
  if (!isRecord(value) || !isRecord(value.files) || !isRecord(value.files.gro)) {
    throw new Error('The native result did not contain a GROMACS .gro preview.')
  }
  const gro = value.files.gro
  if (typeof gro.title !== 'string' || typeof gro.natoms !== 'number' || !Number.isSafeInteger(gro.natoms) || gro.natoms < 1 ||
      !Array.isArray(gro.boxNm) || (gro.boxNm.length !== 3 && gro.boxNm.length !== 9) ||
      !gro.boxNm.every(item => typeof item === 'number' && Number.isFinite(item)) ||
      typeof gro.nVelocities !== 'number' || !Number.isSafeInteger(gro.nVelocities) || !Array.isArray(gro.atomsPreview) || gro.atomsPreview.length > 5) {
    throw new Error('The native .gro preview has an unsupported shape; refusing to render it.')
  }
  const atoms = gro.atomsPreview.map((item): GroAtomPreview => {
    if (!isRecord(item) || !Number.isSafeInteger(item.resid) || typeof item.resname !== 'string' ||
        typeof item.atom !== 'string' || !Number.isSafeInteger(item.number) || !finiteTriple(item.posNm) ||
        !(item.velNmPs === null || finiteTriple(item.velNmPs))) {
      throw new Error('The native .gro atom preview has an unsupported shape; refusing to render it.')
    }
    return {
      resid: item.resid as number,
      resname: item.resname,
      atom: item.atom,
      number: item.number as number,
      posNm: item.posNm,
      velNmPs: item.velNmPs,
    }
  })
  if (gro.nVelocities < 0 || gro.nVelocities > gro.natoms) throw new Error('The native .gro velocity count is invalid.')
  return {
    title: gro.title,
    natoms: gro.natoms as number,
    boxNm: gro.boxNm as number[],
    nVelocities: gro.nVelocities as number,
    atomsPreview: atoms,
  }
}

function downloadGro(source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'chemical/x-gromacs-gro;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'coordinates.gro'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Imports and previews the bounded atomsPreview emitted by sw-gromacs-inputdeck. */
export function GromacsGroPreview() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [source, setSource] = useState('')
  const [saved, setSaved] = useState<SavedPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const generation = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [])

  const resetForEdit = (text: string, name = '') => {
    generation.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    setStatus('idle')
    setError(null)
    setSaved(null)
    setSource(text)
    setFileName(name)
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.gro')) {
      setError(zh ? '请选择 .gro 坐标文件。' : 'Choose a .gro coordinate file.')
      return
    }
    if (file.size > MAX_GRO_BYTES) {
      setError(zh ? '文件超过 16 MiB 上限。' : 'The file exceeds the 16 MiB limit.')
      return
    }
    try {
      const text = await file.text()
      if (new Blob([text]).size > MAX_GRO_BYTES) throw new Error(zh ? '文件超过 16 MiB 上限。' : 'The file exceeds the 16 MiB limit.')
      resetForEdit(text, file.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const run = async () => {
    if (busy || !source.trim() || new Blob([source]).size > MAX_GRO_BYTES) return
    const preflightError = fixedWidthPreflight(source, zh)
    if (preflightError) { setError(preflightError); setStatus('failed'); setSaved(null); return }
    const current = ++generation.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setSaved(null)
    setError(null)
    setStatus('submitting')
    const input: SwModuleInput = { module: MODULE_ID, backend: 'host', gro: source }
    let jobSpec: ReturnType<typeof createModuleJobSpec>
    try {
      // Reuse the same shared input reader that enforces the 1 MiB serialized
      // inline-model bound before requiring a user or creating a Host job.
      jobSpec = createModuleJobSpec(input)
      readModuleJobInput(jobSpec)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message.includes('1 MiB bound')
        ? label('Serialized GROMACS input exceeds the shared 1 MiB Host submission limit; choose a smaller .gro file.', '序列化后的 GROMACS 输入超过共享 Host 提交的 1 MiB 限制；请选择较小的 .gro 文件。')
        : message)
      setStatus('failed')
      setSaved(null)
      return
    }
    let jobId: string | null = null
    const isCurrent = () => mounted.current && generation.current === current && controllerRef.current === controller
    try {
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      await client.requireUser(controller.signal)
      if (!isCurrent()) return
      const remote = await runRemoteJob(client, jobSpec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (isCurrent()) { jobId = id; setStatus(next) }
        },
      })
      if (!isCurrent()) return
      const output = readModuleResult(remote as JobResultV1, input)
      if (!isRecord(output) || output.module !== MODULE_ID) throw new Error('The native result module identity did not match the requested GROMACS operation.')
      const preview = parseGroPreview(output.result)
      if (!isCurrent()) return
      setSaved({ source, result: preview, jobId })
      setStatus('succeeded')
    } catch (cause) {
      if (!isCurrent() || controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('failed')
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (mounted.current && generation.current === current) setBusy(false)
      }
    }
  }

  const size = new Blob([source]).size
  const result = saved?.result
  const label = (en: string, cn: string) => zh ? cn : en
  const vector = (items: number[]) => items.map(String).join(', ')

  return <section className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="gromacs-gro-preview-title">
    <header className="mb-4">
      <h2 id="gromacs-gro-preview-title" className="text-lg font-semibold">{label('GROMACS .gro coordinate preview', 'GROMACS .gro 坐标预览')}</h2>
      <p className="mt-1 text-sm text-slate-500">{label(
        'Uses the existing sw-gromacs-inputdeck host operation. It accepts fixed-width 44-column position rows or 68-column position-and-velocity rows, displays up to five returned atoms, and downloads the exact imported text; no topology or simulation is created.',
        '使用现有 sw-gromacs-inputdeck 主机操作。仅接受固定宽度的 44 列位置行或 68 列位置与速度行，显示最多五个返回原子并下载原始文本；不会创建拓扑或运行模拟。',
      )}</p>
    </header>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <label className="text-sm">{label('Import .gro', '导入 .gro')}
        <input className="ml-2 max-w-full text-sm" type="file" accept=".gro,text/plain" onChange={event => void importFile(event)} />
      </label>
      {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
      <span className="text-xs text-slate-500">{(size / 1024 / 1024).toFixed(2)} MiB · {label('16 MiB file cap; 1 MiB serialized Host submission cap', '文件上限 16 MiB；Host 序列化提交上限 1 MiB')}</span>
    </div>
    <label className="block text-sm font-medium" htmlFor="gromacs-gro-source">{label('Coordinate file text', '坐标文件文本')}</label>
    <textarea id="gromacs-gro-source" className="mt-1 min-h-48 w-full rounded-lg border border-edge bg-background p-3 font-mono text-xs" value={source} maxLength={MAX_GRO_BYTES} spellCheck={false} onChange={event => resetForEdit(event.target.value)} aria-describedby="gromacs-gro-limit" />
    <p id="gromacs-gro-limit" className="mt-1 text-xs text-slate-500">{label('File picker cap: 16 MiB. Host submission has a shared 1 MiB serialized inline-input bound, including JSON framing, so the effective .gro limit is smaller and is checked before Host submission. One frame only; atom rows must consistently use either the standard 44-column position-only width or 68-column position-and-velocity width. The native reader admits up to 200,000 atoms and returns five preview rows.', '文件选择上限：16 MiB。Host 提交共享 1 MiB 序列化内联输入限制（包括 JSON 封装），因此 .gro 实际上限更小，并会在提交 Host 前检查。仅支持单帧；原子行须统一使用标准 44 列位置格式或 68 列位置与速度格式。原生读取器最多接收 200,000 个原子并返回五行预览。')}</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || size === 0 || size > MAX_GRO_BYTES} onClick={() => void run()}>
        {busy ? label('Reading…', '读取中…') : label('Read coordinates', '读取坐标')}
      </button>
      {status === 'succeeded' && <span role="status" className="text-sm text-emerald-700">{label('Preview ready', '预览已就绪')}{saved?.jobId ? ` · ${saved.jobId}` : ''}</span>}
      {busy && <button type="button" className="text-sm underline" onClick={() => { generation.current += 1; controllerRef.current?.abort(); controllerRef.current = null; setBusy(false); setStatus('cancelled') }}>{label('Cancel', '取消')}</button>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {result && saved && <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{result.title}</h3>
          <p className="text-sm text-slate-500">{result.natoms.toLocaleString()} {label('atoms', '个原子')} · {result.nVelocities.toLocaleString()} {label('velocities', '个速度记录')} · {label('box', '盒子')} ({result.boxNm.length} {label('components', '个分量')}, nm): {vector(result.boxNm)}</p>
          <p className="text-xs text-slate-500">{result.boxNm.length === 3 ? label('Orthorhombic box (x, y, z)', '正交盒（x、y、z）') : label('Triclinic box in native .gro 9-component order', '三斜盒，采用原生 .gro 九分量顺序')}</p>
        </div>
        <button type="button" className="rounded-lg border border-edge px-3 py-2 text-sm" onClick={() => downloadGro(saved.source)}>{label('Download original .gro', '下载原始 .gro')}</button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">{label('First five atoms returned by the native GROMACS input-deck operation', '原生 GROMACS 输入读取操作返回的前五个原子')}</caption>
          <thead className="bg-panel text-xs"><tr>
            {[label('Residue', '残基'), label('Atom', '原子'), label('Number', '编号'), 'x (nm)', 'y (nm)', 'z (nm)', 'vx (nm/ps)', 'vy (nm/ps)', 'vz (nm/ps)'].map(name => <th key={name} className="px-3 py-2 font-medium">{name}</th>)}
          </tr></thead>
          <tbody>{result.atomsPreview.map((atom, index) => <tr key={`${atom.number}-${index}`} className="border-t border-edge">
            <td className="px-3 py-2">{atom.resid} {atom.resname}</td><td className="px-3 py-2">{atom.atom}</td><td className="px-3 py-2">{atom.number}</td>
            {atom.posNm.map((coordinate, i) => <td key={`p${i}`} className="px-3 py-2 tabular-nums">{String(coordinate)}</td>)}
            {atom.velNmPs ? atom.velNmPs.map((velocity, i) => <td key={`v${i}`} className="px-3 py-2 tabular-nums">{String(velocity)}</td>) : <td className="px-3 py-2 text-slate-400" colSpan={3}>—</td>}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{label('Coordinate values are shown as returned in nm; available velocities are shown in nm/ps. Missing velocities remain blank. The download preserves the original text and numeric precision.', '坐标按返回值以 nm 显示；可用速度以 nm/ps 显示。缺失速度保持空白。下载保留原始文本和数值精度。')}</p>
    </div>}
  </section>
}
