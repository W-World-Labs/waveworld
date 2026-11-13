import { useMemo, useState, type ChangeEvent } from 'react'
import { parseOpenModelicaMatResult, type MatResultSignal, type ModelicaMatResult } from '../../lib/sim/openModelicaMatResult'
import { resultToCsv, resultToJson } from '../../lib/sim/openModelicaMatExport'
import { useLocale } from '../../lib/i18n'

const MAX_FILE_BYTES = 16 * 1024 * 1024

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

function formatNumber(value: number | undefined) {
  return value === undefined ? '—' : String(value)
}

function SeriesPlot({ times, values, name }: { times: number[]; values: number[]; name: string }) {
  const points = useMemo(() => {
    const valid = times.map((time, index) => ({ time, value: values[index] }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    if (valid.length === 0) return ''
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const point of valid) {
      minX = Math.min(minX, point.time)
      maxX = Math.max(maxX, point.time)
      minY = Math.min(minY, point.value)
      maxY = Math.max(maxY, point.value)
    }
    const xSpan = maxX - minX || 1
    const ySpan = maxY - minY || 1
    return valid.map((point, index) => `${valid.length === 1 ? 450 : 40 + ((point.time - minX) / xSpan) * 410},${230 - ((point.value - minY) / ySpan) * 200}${index === valid.length - 1 ? '' : ' '}`).join('')
  }, [times, values])

  return (
    <div className="overflow-x-auto rounded border border-edge bg-panel p-2">
      <svg viewBox="0 0 500 260" role="img" aria-label={name} className="h-64 min-w-[420px] w-full">
        <path d="M40 30V230H460" fill="none" stroke="currentColor" strokeOpacity=".35" />
        {points && <polyline points={points} fill="none" stroke="#38bdf8" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  )
}

function describeSignal(signal: MatResultSignal, zh: boolean) {
  const type = signal.kind === 'time' ? (zh ? '时间' : 'time') : signal.kind === 'parameter' ? (zh ? '参数' : 'parameter') : (zh ? '采样序列' : 'sampled series')
  return `${signal.name} · ${type}${signal.description ? ` · ${signal.description}` : ''}`
}

/** Opt-in local-file browser for values decoded from OpenModelica MAT results. */
export function DymolaMatResultBrowser() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [result, setResult] = useState<ModelicaMatResult | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const selectedIndex = result?.signals.findIndex((signal, index) => `${signal.kind}:${signal.name}:${index}` === selectedKey) ?? -1
  const selected = selectedIndex >= 0 ? result?.signals[selectedIndex] ?? null : null

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    setError('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mat')) {
      setResult(null)
      setFileName('')
      setError(zh ? '请选择 .mat 结果文件。' : 'Choose a .mat result file.')
      input.value = ''
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setResult(null)
      setFileName('')
      setError(zh ? '文件超过 16 MiB 上限，未读取文件内容。' : 'File exceeds the 16 MiB limit; its contents were not read.')
      input.value = ''
      return
    }
    try {
      const parsed = parseOpenModelicaMatResult(await file.arrayBuffer())
      setResult(parsed)
      const firstIndex = Math.max(0, parsed.signals.findIndex((signal) => signal.kind === 'series'))
      const first = parsed.signals[firstIndex]
      setSelectedKey(first ? `${first.kind}:${first.name}:${firstIndex}` : '')
      setFileName(file.name)
    } catch {
      setResult(null)
      setFileName('')
      setError(zh ? '无法读取此 MAT 文件。格式可能不受支持，或文件内容已损坏。' : 'Could not read this MAT file. Its format may be unsupported or the file may be malformed.')
      input.value = ''
    }
  }

  return (
    <section className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4" aria-labelledby="dymola-mat-browser-title">
      <div>
        <h2 id="dymola-mat-browser-title" className="text-lg font-semibold">{zh ? '本地 MAT 结果浏览器' : 'Local MAT result browser'}</h2>
        <p className="mt-1 text-sm text-slate-400">{zh ? '在浏览器中读取 OpenModelica MAT 文件，单文件上限 16 MiB。' : 'Read an OpenModelica MAT file in your browser; maximum file size is 16 MiB.'}</p>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{zh ? '选择 .mat 文件' : 'Choose a .mat file'}</span>
        <input type="file" accept=".mat,application/octet-stream" onChange={onFileChange} className="block w-full text-sm text-slate-300 file:mr-3 file:rounded file:border file:border-edge file:bg-panel file:px-3 file:py-2 file:text-slate-100" />
      </label>
      {error && <p role="alert" className="rounded border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}

      {result && selected && <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="min-w-64 flex-1 text-sm">
            <span className="mb-1 block font-medium">{zh ? '变量' : 'Signal'}</span>
            <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100">
              {result.signals.map((signal, index) => {
                const key = `${signal.kind}:${signal.name}:${index}`
                return <option key={key} value={key}>{describeSignal(signal, zh)}</option>
              })}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn border border-edge" onClick={() => download('modelica-mat-result.csv', resultToCsv(result, selected.name), 'text/csv;charset=utf-8')}>{zh ? '下载 CSV' : 'Download CSV'}</button>
            <button type="button" className="btn border border-edge" onClick={() => download('modelica-mat-result.json', resultToJson(result, selected.name), 'application/json;charset=utf-8')}>{zh ? '下载 JSON' : 'Download JSON'}</button>
          </div>
        </div>

        <p className="text-xs text-slate-400">{zh ? `文件：${fileName} · 布局：${result.layout} · 样本：${result.sampleCount}` : `File: ${fileName} · Layout: ${result.layout} · Samples: ${result.sampleCount}`}</p>

        {selected.kind !== 'parameter' ? <>
          <SeriesPlot times={result.time} values={selected.values} name={selected.name} />
          <div className="max-h-80 overflow-auto rounded border border-edge">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-panel"><tr><th className="px-3 py-2">{zh ? '行' : 'Row'}</th><th className="px-3 py-2">time</th><th className="px-3 py-2">{selected.name}</th></tr></thead>
              <tbody>{result.time.map((time, index) => <tr key={index} className="border-t border-edge"><td className="px-3 py-1.5 text-slate-400">{index + 1}</td><td className="px-3 py-1.5">{formatNumber(time)}</td><td className="px-3 py-1.5">{formatNumber(selected.values[index])}</td></tr>)}</tbody>
            </table>
          </div>
        </> : <div className="rounded border border-edge">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel"><tr><th className="px-3 py-2">{zh ? '名称' : 'Name'}</th><th className="px-3 py-2">{zh ? '描述' : 'Description'}</th><th className="px-3 py-2">{zh ? '存储值 / 起始值' : 'Stored value / start'}</th><th className="px-3 py-2">{zh ? '结束值' : 'Stop'}</th></tr></thead>
            <tbody><tr className="border-t border-edge"><td className="px-3 py-2">{selected.name}</td><td className="px-3 py-2">{selected.description || '—'}</td><td className="px-3 py-2">{formatNumber(selected.values[0])}</td><td className="px-3 py-2">{selected.values.length > 1 ? formatNumber(selected.values[1]) : '—'}</td></tr></tbody>
          </table>
        </div>}
        <p className="text-xs text-amber-300">{zh ? '这些是从所选文件解析出的存储值；本浏览器不会运行求解器，也不验证求解结果。' : 'These are stored values parsed from the selected file. This browser does not run a solver or verify the results.'}</p>
      </>}
    </section>
  )
}
