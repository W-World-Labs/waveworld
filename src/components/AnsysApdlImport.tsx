import { useState, type ChangeEvent } from 'react'
import { parseAnsysApdlThermalInput, type AnsysApdlThermalImport } from '../lib/sim/ansys-apdl-thermal-input'

type Props = {
  onImport: (result: AnsysApdlThermalImport) => void
  onSourceChange?: () => void
  onClear?: () => void
}

/** Import the supported MAPDL APDL thermal-bar subset into the native study input. */
export function AnsysApdlImport({ onImport, onSourceChange, onClear }: Props) {
  const [source, setSource] = useState('')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<AnsysApdlThermalImport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const changeSource = (value: string) => {
    onSourceChange?.()
    setSource(value)
    setParsed(null)
    setError(null)
  }

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    onSourceChange?.()
    setFileName(file.name)
    setSource('')
    setParsed(null)
    setError(null)
    try {
      if (file.size > 65_536) throw new Error('APDL file exceeds 65,536 bytes')
      changeSource(await file.text())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      // Allow selecting the same file again after correcting an import problem.
      input.value = ''
    }
  }

  const parse = () => {
    setParsed(null)
    setError(null)
    try {
      setParsed(parseAnsysApdlThermalInput(source))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const clear = () => {
    setSource('')
    setFileName('')
    setParsed(null)
    setError(null)
    onClear?.()
  }

  return <section data-testid="ansys-apdl-import" className="space-y-3 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="ansys-apdl-title">
    <header>
      <h2 id="ansys-apdl-title" className="text-lg font-semibold text-slate-100">Ansys MAPDL APDL thermal import / Ansys MAPDL APDL 热学导入</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-400">Paste supported APDL text or load a plain-text .inp/.ans file, then inspect the translated native solver input. / 粘贴受支持的 APDL 文本，或加载纯文本 .inp/.ans 文件，然后检查转换后的原生求解器输入。</p>
    </header>

    <label className="block text-sm text-slate-300" htmlFor="ansys-apdl-file">APDL file (.inp, .ans) / APDL 文件 (.inp、.ans)
      <input id="ansys-apdl-file" data-testid="ansys-apdl-file" type="file" accept=".inp,.ans,text/plain" onChange={event => void selectFile(event)} className="mt-1 block w-full text-sm" />
    </label>

    <label className="block text-sm text-slate-300" htmlFor="ansys-apdl-source">APDL source text / APDL 源文本
      <textarea id="ansys-apdl-source" data-testid="ansys-apdl-source" value={source} onChange={event => changeSource(event.currentTarget.value)} rows={12} spellCheck={false} placeholder="Paste APDL commands here. / 在此粘贴 APDL 命令。" className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 font-mono text-xs text-slate-100" />
    </label>
    {fileName && <p className="text-xs text-slate-400" data-testid="ansys-apdl-filename">Source file / 源文件: {fileName}</p>}

    <div className="flex flex-wrap gap-2">
      <button type="button" data-testid="ansys-apdl-parse" onClick={parse} disabled={!source.trim()} className="btn bg-cyan-300 text-slate-950 disabled:opacity-50">Parse APDL / 解析 APDL</button>
      <button type="button" data-testid="ansys-apdl-clear" onClick={clear} className="btn border border-edge text-slate-300">Clear / 清除</button>
    </div>

    {error && <div data-testid="ansys-apdl-error" role="alert" className="rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}</div>}

    {parsed && <div data-testid="ansys-apdl-preview" className="space-y-3 rounded-lg border border-edge bg-surface p-3 text-sm text-slate-300">
      <h3 className="font-semibold text-slate-100">Import preview / 导入预览</h3>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-slate-400">Nodes / 节点</dt><dd>{parsed.summary.nodeCount}</dd></div>
        <div><dt className="text-slate-400">Elements / 单元</dt><dd>{parsed.summary.elementCount}</dd></div>
        <div><dt className="text-slate-400">Imported area / 导入面积</dt><dd>{parsed.summary.areaM2} m²</dd></div>
        <div><dt className="text-slate-400">Conductivity / 导热系数</dt><dd>{parsed.summary.conductivityWPerMK} W/(m·K)</dd></div>
      </dl>
      <details className="rounded border border-edge p-3">
        <summary className="cursor-pointer text-sm font-medium">Native solver input JSON / 原生求解器输入 JSON</summary>
        <pre data-testid="ansys-apdl-native-input" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(parsed.input, null, 2)}</pre>
      </details>
      <details className="rounded border border-edge p-3">
        <summary className="cursor-pointer text-sm font-medium">External node labels / 外部节点标签</summary>
        <pre data-testid="ansys-apdl-external-labels" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(parsed.externalNodeLabels, null, 2)}</pre>
      </details>
      <button type="button" data-testid="ansys-apdl-submit" onClick={() => onImport(parsed)} className="btn bg-cyan-300 text-slate-950">Use imported input / 使用导入输入</button>
    </div>}
  </section>
}
