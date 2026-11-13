import { useContext, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ModuleComputeContext, useModuleCompute } from '../../lib/hooks/useModuleCompute'
import { useLocale } from '../../lib/i18n'
import type { ModuleComputeInput } from '../../lib/sim/module-compute'
import { importAbaqusMatrixPair } from '../../lib/sim/abaqus-matrix-import'
import type { AnsysModalNativeInput } from '../../lib/sim/ansys-modal-study-result'
import { parseAnsysModalNativeOutput } from '../../lib/sim/ansys-modal-study-result'
import { abaqusMatrixStudyCsv, abaqusMatrixStudyReport } from '../../lib/sim/abaqus-matrix-study-export'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_DOF = 16
const UNIT_ASSUMPTION = 'Abaqus .mtx text files carry no unit metadata. Stiffness and mass values are passed through unchanged under the assumption that K and M use a consistent unit system and time is in seconds; reported rad/s and Hz use that assumption. No unit conversion or filename inference is performed.'
const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink'

type ImportedPair = Extract<ReturnType<typeof importAbaqusMatrixPair>, { ok: true }>
type ModalInput = Extract<ModuleComputeInput, { module: `sw-${string}` }>

function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.freeze(item)
      for (const child of Object.values(item)) freeze(child)
    }
  }
  freeze(copy)
  return copy
}

function finiteNumber(value: string): number {
  if (!value.trim()) return Number.NaN
  return Number(value)
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

export function AbaqusMatrixStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const execution = useContext(ModuleComputeContext)
  const [stiffnessFile, setStiffnessFile] = useState<File | null>(null)
  const [massFile, setMassFile] = useState<File | null>(null)
  const [imported, setImported] = useState<ImportedPair | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [numModes, setNumModes] = useState(1)
  const [shift, setShift] = useState(0)
  const [tolerance, setTolerance] = useState(1e-10)
  const [directionText, setDirectionText] = useState('')
  const [submittedInput, setSubmittedInput] = useState<ModalInput | null>(null)
  const [submittedFiles, setSubmittedFiles] = useState<Array<{ name: string; sizeBytes: number }> | null>(null)
  const submittedRef = useRef<ModalInput | null>(null)
  const importGeneration = useRef(0)

  const n = imported?.stiffness.length ?? 0
  const direction = useMemo(() => {
    if (!n) return []
    const raw = directionText.trim()
    if (!raw) return Array.from({ length: n }, () => 1)
    return raw.split(/[\s,]+/).map(finiteNumber)
  }, [directionText, n])
  const input = useMemo<ModalInput>(() => {
    if (!imported) return { module: 'sw-ansys-modal', backend: 'host', method: 'block-lanczos', stiffness: [[1]], mass: [[1]], numModes: 1, shift: 0, direction: [1], tolerance: 1e-10 } as ModalInput
    return {
      module: 'sw-ansys-modal',
      backend: 'host',
      method: 'block-lanczos',
      stiffness: imported.stiffness,
      mass: imported.mass,
      numModes,
      shift,
      direction,
      tolerance,
    } as ModalInput
  }, [imported, numModes, shift, direction, tolerance])
  const submittedCapture = () => submittedRef.current ?? input
  const compute = useModuleCompute(input, submittedCapture)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  const valid = !!imported
    && Number.isInteger(numModes) && numModes >= 1 && numModes <= n
    && Number.isFinite(shift) && Math.abs(shift) <= 1e100
    && Number.isFinite(tolerance) && tolerance >= 1e-14 && tolerance <= 1e-2
    && direction.length === n && direction.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)
    && direction.some(value => value !== 0)

  const clearRun = () => {
    submittedRef.current = null
    setSubmittedInput(null)
    setSubmittedFiles(null)
    execution?.clear()
  }

  const importFiles = async (stiffness: File | null, mass: File | null) => {
    const generation = ++importGeneration.current
    setImported(null)
    setImportError(null)
    setDirectionText('')
    clearRun()
    if (!stiffness || !mass) return
    try {
      for (const file of [stiffness, mass]) {
        if (!file.name.toLowerCase().endsWith('.mtx')) throw new Error(zh ? '请选择 .mtx 矩阵文本文件。' : 'Select .mtx matrix text files.')
        if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error(zh ? '每个文件必须为 1 字节至 2 MiB。' : 'Each file must be between 1 byte and 2 MiB.')
      }
      const [stiffnessText, massText] = await Promise.all([stiffness.text(), mass.text()])
      if (generation !== importGeneration.current) return
      const parsed = importAbaqusMatrixPair(stiffnessText, massText)
      if (!parsed.ok) throw new Error(parsed.diagnostics.join('; '))
      const count = parsed.stiffness.length
      if (count < 1 || count > MAX_DOF) throw new Error(zh ? `导入自由度必须为 1–${MAX_DOF}。` : `Imported DOF count must be between 1 and ${MAX_DOF}.`)
      setImported(parsed)
      setNumModes(1)
      setShift(0)
      setTolerance(1e-10)
    } catch (cause) {
      if (generation !== importGeneration.current) return
      setImportError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const selectFile = (kind: 'stiffness' | 'mass') => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null
    if (kind === 'stiffness') {
      setStiffnessFile(file)
      void importFiles(file, massFile)
    } else {
      setMassFile(file)
      void importFiles(stiffnessFile, file)
    }
  }

  const submit = () => {
    if (!valid || !execution || execution.target !== 'backend' || execution.busy || execution.cancelPending) return
    const snapshot = frozenCopy(input)
    submittedRef.current = snapshot
    setSubmittedInput(snapshot)
    setSubmittedFiles([
      { name: stiffnessFile!.name, sizeBytes: stiffnessFile!.size },
      { name: massFile!.name, sizeBytes: massFile!.size },
    ])
    void execution.start(true)
  }

  const reset = () => {
    importGeneration.current += 1
    setStiffnessFile(null)
    setMassFile(null)
    setImported(null)
    setImportError(null)
    setNumModes(1)
    setShift(0)
    setTolerance(1e-10)
    setDirectionText('')
    clearRun()
  }

  const setNumber = (setter: (value: number) => void) => (event: ChangeEvent<HTMLInputElement>) => setter(finiteNumber(event.currentTarget.value))
  let result: ReturnType<typeof parseAnsysModalNativeOutput> | null = null
  let resultError: string | null = null
  if (compute.result && submittedInput) {
    try { result = parseAnsysModalNativeOutput(compute.result, submittedInput as unknown as AnsysModalNativeInput) }
    catch (cause) { resultError = cause instanceof Error ? cause.message : String(cause) }
  }
  const mapping = imported?.dofMap
  const exportDofMap = mapping?.map(({ node, dof }) => ({ node, dof: String(dof) })) ?? []

  return <section data-testid="abaqus-matrix-study" className="mt-6 space-y-4 rounded-xl border border-cyan-400/25 bg-cyan-950/10 p-4" aria-labelledby="abaqus-matrix-study-title">
    <header>
      <h2 id="abaqus-matrix-study-title" className="text-lg font-semibold text-slate-100">{zh ? 'Abaqus 矩阵导入 · 模态研究' : 'Abaqus matrix import · modal study'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">{zh
        ? '导入已组装的刚度与质量 .mtx 矩阵，预览自由度映射后提交 W-Sim 原生 Host-f64 Block Lanczos。不会恢复几何/网格或约束，也不执行完整 Abaqus 输入文件或求解。'
        : 'Import assembled stiffness and mass .mtx matrices, preview their DOF mapping, then submit a W-Sim native Host-f64 Block Lanczos study. Geometry/mesh and constraints are not recovered; this does not solve a full Abaqus deck.'}</p>
    </header>

    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm text-ink" htmlFor="abaqus-matrix-stiffness-file">{zh ? '刚度矩阵 (.mtx)' : 'Stiffness matrix (.mtx)'}<input id="abaqus-matrix-stiffness-file" data-testid="abaqus-matrix-stiffness-file" type="file" accept=".mtx,text/plain" onChange={selectFile('stiffness')} className={`${fieldClass} file:mr-3 file:rounded file:border-0 file:bg-cyan-300 file:px-3 file:py-1 file:text-slate-950`} /></label>
      <label className="block text-sm text-ink" htmlFor="abaqus-matrix-mass-file">{zh ? '质量矩阵 (.mtx)' : 'Mass matrix (.mtx)'}<input id="abaqus-matrix-mass-file" data-testid="abaqus-matrix-mass-file" type="file" accept=".mtx,text/plain" onChange={selectFile('mass')} className={`${fieldClass} file:mr-3 file:rounded file:border-0 file:bg-cyan-300 file:px-3 file:py-1 file:text-slate-950`} /></label>
    </div>
    <p className="text-xs text-slate-400">{zh ? '每个文件上限 2 MiB；最多 16 个自由度。' : 'Files are limited to 2 MiB each; at most 16 DOFs are admitted.'}</p>
    <p data-testid="abaqus-matrix-unit-assumption" className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-300">{zh
      ? 'Abaqus .mtx 文件不含单位元数据。矩阵数值原样传递，假设 K/M 使用一致单位制且时间单位为秒；返回的 rad/s 与 Hz 按此假设解释。不依据文件名推断单位，也不进行转换。'
      : UNIT_ASSUMPTION}</p>

    {stiffnessFile && massFile && <dl data-testid="abaqus-matrix-preview" className="grid gap-2 rounded-lg border border-edge bg-surface p-3 text-sm sm:grid-cols-2">
      <div><dt className="text-slate-400">{zh ? '刚度文件' : 'Stiffness file'}</dt><dd className="break-all">{stiffnessFile.name} · {stiffnessFile.size.toLocaleString()} B</dd></div>
      <div><dt className="text-slate-400">{zh ? '质量文件' : 'Mass file'}</dt><dd className="break-all">{massFile.name} · {massFile.size.toLocaleString()} B</dd></div>
      {imported && <>
        <div><dt className="text-slate-400">{zh ? '自由度 / 存储' : 'DOFs / storage'}</dt><dd>{n} · K {imported.stiffnessStorage} ({imported.stiffnessEntries} {zh ? '项' : 'entries'}) · M {imported.massStorage} ({imported.massEntries} {zh ? '项' : 'entries'})</dd></div>
        <div><dt className="text-slate-400">{zh ? '自由度映射' : 'DOF mapping'}</dt><dd className="break-words">{JSON.stringify(mapping)}</dd></div>
      </>}
    </dl>}
    {importError && <p role="alert" data-testid="abaqus-matrix-import-error" className="rounded border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{importError}</p>}

    {imported && <fieldset className="space-y-3 rounded-lg border border-edge p-3">
      <legend className="px-1 text-sm font-semibold">{zh ? '模态求解参数' : 'Modal study inputs'}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm text-ink" htmlFor="abaqus-matrix-num-modes">{zh ? `模态数 (1–${n})` : `Number of modes (1–${n})`}<input id="abaqus-matrix-num-modes" data-testid="abaqus-matrix-num-modes" type="number" min="1" max={n} step="1" value={Number.isFinite(numModes) ? numModes : ''} onChange={setNumber(setNumModes)} className={fieldClass} /></label>
        <label className="text-sm text-ink" htmlFor="abaqus-matrix-shift">{zh ? '特征值位移' : 'Eigenvalue shift'}<input id="abaqus-matrix-shift" data-testid="abaqus-matrix-shift" type="number" step="any" value={Number.isFinite(shift) ? shift : ''} onChange={setNumber(setShift)} className={fieldClass} /></label>
        <label className="text-sm text-ink" htmlFor="abaqus-matrix-tolerance">{zh ? '收敛容差 (1e-14–1e-2)' : 'Tolerance (1e-14–1e-2)'}<input id="abaqus-matrix-tolerance" data-testid="abaqus-matrix-tolerance" type="number" min="1e-14" max="1e-2" step="any" value={Number.isFinite(tolerance) ? tolerance : ''} onChange={setNumber(setTolerance)} className={fieldClass} /></label>
        <label className="text-sm text-ink" htmlFor="abaqus-matrix-direction">{zh ? `方向向量 (${n} 项)` : `Direction vector (${n} values)`}<input id="abaqus-matrix-direction" data-testid="abaqus-matrix-direction" type="text" value={directionText} placeholder={Array.from({ length: n }, () => '1').join(', ')} onChange={event => setDirectionText(event.currentTarget.value)} className={fieldClass} /></label>
      </div>
      <p className="text-xs text-slate-400">{zh
        ? `方向默认每个导入自由度取 1；当前映射顺序 ${JSON.stringify(mapping)}。显式输入时按逗号或空格分隔，范围 ±1e6。位移范围 ±1e100。`
        : `The default direction is 1 for every imported DOF; the vector follows mapping order ${JSON.stringify(mapping)}. Enter explicit values separated by commas or spaces (bounded to ±1e6). Shift is bounded to ±1e100.`}</p>
      {!valid && <p role="alert" data-testid="abaqus-matrix-validation" className="text-sm text-amber-200">{zh ? '请检查自由度数、有限参数、容差范围以及与映射长度一致的非零方向向量。' : 'Check the mode count, finite parameter bounds, tolerance, and a non-zero direction vector matching the DOF mapping.'}</p>}
    </fieldset>}

    <div className="flex flex-wrap items-center gap-3">
      <button type="button" data-testid="abaqus-matrix-submit" disabled={!valid || !execution || execution.target !== 'backend' || execution.busy || execution.cancelPending} onClick={submit} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{execution?.busy ? (zh ? '提交中…' : 'Submitting…') : (zh ? '提交原生模态研究' : 'Submit native modal study')}</button>
      {execution?.busy && <button type="button" data-testid="abaqus-matrix-cancel" onClick={() => void execution.stop()} className="btn border border-edge text-slate-300">{zh ? '取消研究' : 'Cancel study'}</button>}
      <button type="button" data-testid="abaqus-matrix-reset" onClick={reset} className="btn border border-edge text-slate-300">{zh ? '重置' : 'Reset'}</button>
      {execution && <span data-testid="abaqus-matrix-status" role="status" className="text-xs text-slate-400" aria-live="polite">{execution.status}{execution.jobId ? ` · ${zh ? '任务' : 'Job'} ${execution.jobId}` : ''}</span>}
      {execution?.error && <span role="alert" className="text-sm text-rose-300">{execution.error}</span>}
      {resultError && <span role="alert" className="text-sm text-rose-300">{resultError}</span>}
    </div>

    {result && submittedInput && <section data-testid="abaqus-matrix-results" className="space-y-3 rounded-xl border border-edge bg-surface p-4">
      <h3 className="text-lg font-semibold">{zh ? 'W-Sim Host-f64 原生结果' : 'W-Sim Host-f64 native result'}</h3>
      <p className="text-xs text-slate-400">{zh ? '结果对应下方冻结的已提交输入快照。' : 'The result corresponds to this frozen submitted-input snapshot.'}</p>
      <p className="text-xs text-amber-200">{UNIT_ASSUMPTION}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="abaqus-matrix-download-csv" className="btn border border-edge" onClick={() => result && download('abaqus-matrix-modal-study.csv', abaqusMatrixStudyCsv({ result, dofMap: exportDofMap }), 'text/csv;charset=utf-8')}>{zh ? '下载 CSV' : 'Download CSV'}</button>
        <button type="button" data-testid="abaqus-matrix-download-json" className="btn border border-edge" onClick={() => result && submittedFiles && download('abaqus-matrix-modal-study.json', abaqusMatrixStudyReport({ input: submittedInput, dofMap: exportDofMap, files: submittedFiles, result, jobId: execution?.jobId ?? null }), 'application/json;charset=utf-8')}>{zh ? '下载 JSON 报告' : 'Download JSON report'}</button>
      </div>
      <div className="overflow-x-auto rounded border border-edge">
        <table className="min-w-full text-left text-xs"><thead className="bg-slate-900 text-slate-300"><tr><th className="p-2">{zh ? '模态' : 'Mode'}</th><th className="p-2">Hz</th><th className="p-2">rad/s</th><th className="p-2">{zh ? '振型分量（原始节点/自由度标签）' : 'Mode shape components (source node/DOF labels)'}</th></tr></thead>
          <tbody>{result.eigenvalues.map((eigenvalue, mode) => <tr key={`${mode}-${eigenvalue}`} className="border-t border-edge"><td className="p-2">{mode + 1}</td><td className="p-2">{result!.frequenciesHz[mode]}</td><td className="p-2">{result!.frequenciesRadS[mode]}</td><td className="p-2">{result!.modeShapes[mode].map((component, index) => <span key={`${exportDofMap[index]?.node}:${exportDofMap[index]?.dof}`} className="mr-3 inline-block">({exportDofMap[index]?.node}, {exportDofMap[index]?.dof}) = {component}</span>)}</td></tr>)}</tbody>
        </table>
      </div>
      <details open className="rounded border border-edge p-3"><summary className="cursor-pointer text-sm font-medium">{zh ? '提交输入' : 'Submitted input'}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify(submittedInput, null, 2)}</pre></details>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-edge p-3 text-xs text-slate-300">{JSON.stringify(result, null, 2)}</pre>
    </section>}
  </section>
}
