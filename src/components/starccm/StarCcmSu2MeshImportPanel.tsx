import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ModuleComputeContext, useModuleCompute, useModuleExecution } from '../../lib/hooks/useModuleCompute'
import { useLocale } from '../../lib/i18n'
import { createModuleJobSpec, type ModuleComputeInput, type SwModuleInput } from '../../lib/sim/module-compute'
import { preflightSu2MeshSource, MAX_SU2_MESH_SOURCE_BYTES } from './su2MeshPreflight'
import { validateSu2MeshResult, type ValidatedSu2MeshResult } from './su2MeshResult'
import { StarCcmSu2MeshSummary } from './StarCcmSu2MeshSummary'

const MODULE_ID = 'sw-su2-mesh-import' as const
const INLINE_INPUT_MAX = 1 << 20
const FALLBACK_INPUT: SwModuleInput & { mesh: string } = { module: MODULE_ID, backend: 'host', mesh: '' }

type SavedImport = {
  input: SwModuleInput & { mesh: string }
  sourceText: string
  submittedMeshText: string
  result: ValidatedSu2MeshResult
  jobId: string
}

type Candidate = {
  input: (SwModuleInput & { mesh: string }) | null
  error: string | null
}

export function StarCcmSu2MeshImportPanel() {
  const execution = useModuleExecution()
  return <ModuleComputeContext.Provider value={execution}><StarCcmSu2MeshImportPanelContent /></ModuleComputeContext.Provider>
}

export function StarCcmSu2MeshImportPanelContent() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const execution = useContext(ModuleComputeContext)
  const [sourceText, setSourceText] = useState('')
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState<SavedImport | null>(null)
  const readGeneration = useRef(0)
  const pending = useRef<{ inputJson: string; sourceText: string; submittedMeshText: string } | null>(null)

  const preflight = useMemo(() => preflightSu2MeshSource(sourceText), [sourceText])
  const candidate = useMemo<Candidate>(() => {
    if (!preflight.ok) return { input: null, error: sourceText ? preflight.error : null }
    const input = { module: MODULE_ID, backend: 'host', mesh: preflight.normalizedText } as const
    if (JSON.stringify(input).length > INLINE_INPUT_MAX) {
      return { input: null, error: zh ? '序列化内联输入超过共享的 1 MiB 限制。' : 'Serialized inline input exceeds the shared 1 MiB limit.' }
    }
    return { input, error: null }
  }, [preflight, sourceText, zh])
  const compute = useModuleCompute(candidate.input ?? FALLBACK_INPUT, () => candidate.input ?? FALLBACK_INPUT)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  useEffect(() => {
    const submission = pending.current
    if (!submission || execution?.status !== 'succeeded') return
    if (!compute.result || !compute.submittedInput || !execution.jobId) return
    if (JSON.stringify(compute.submittedInput) !== submission.inputJson) {
      pending.current = null
      setError(zh ? '忽略了与本次提交输入不匹配的旧结果。' : 'Ignored a stale result that does not match this submission.')
      return
    }
    // useModuleCompute already unwraps the Host envelope via readModuleResult.
    const checked = validateSu2MeshResult({ moduleResult: compute.result })
    if (!checked.ok) {
      pending.current = null
      setSaved(null)
      setError(checked.errors.join(' '))
      return
    }
    setSaved({
      input: compute.submittedInput as SwModuleInput & { mesh: string },
      sourceText: submission.sourceText,
      submittedMeshText: submission.submittedMeshText,
      result: checked.result,
      jobId: execution.jobId,
    })
    pending.current = null
    setError('')
    setNotice(zh ? `已保存 Host 任务 ${execution.jobId} 的 SU2 网格读取摘要。` : `Saved SU2 mesh import summary from Host job ${execution.jobId}.`)
  }, [compute.result, compute.submittedInput, execution?.jobId, execution?.status, zh])

  useEffect(() => {
    if (execution?.status === 'failed' || execution?.status === 'cancelled') pending.current = null
  }, [execution?.status])

  const changeSource = (value: string) => {
    readGeneration.current++
    setSourceText(value)
    setSaved(null)
    setError('')
    setNotice('')
    pending.current = null
  }

  const readFile = async (file?: File) => {
    if (!file) return
    const generation = ++readGeneration.current
    setFilename(file.name)
    setSaved(null)
    setError('')
    setNotice('')
    pending.current = null
    if (!file.name.toLowerCase().endsWith('.su2')) {
      setSourceText('')
      setError(zh ? '请选择扩展名为 .su2 的 ASCII 网格文件。' : 'Choose an ASCII mesh file with the .su2 extension.')
      return
    }
    if (file.size > MAX_SU2_MESH_SOURCE_BYTES) {
      setSourceText('')
      setError(zh ? 'SU2 ASCII 文件超过 1 MiB。' : 'SU2 ASCII file exceeds 1 MiB.')
      return
    }
    try {
      const text = await file.text()
      if (generation !== readGeneration.current) return
      setSourceText(text)
    } catch (cause) {
      if (generation !== readGeneration.current) return
      setSourceText('')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const submit = () => {
    const input = candidate.input
    if (!input || !execution || execution.target !== 'backend' || !execution.connected || execution.busy || execution.cancelPending) return
    try {
      createModuleJobSpec(input as ModuleComputeInput)
      const inputJson = JSON.stringify(input)
      if (inputJson.length > INLINE_INPUT_MAX) throw new Error('sw-* inline model exceeds the 1 MiB bound')
      pending.current = { inputJson, sourceText, submittedMeshText: input.mesh }
      setSaved(null)
      setError('')
      setNotice('')
      void execution.start(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      execution.reportLocalError(cause)
    }
  }

  const cancel = () => {
    pending.current = null
    setNotice('')
    void execution?.stop()
  }

  return <section data-testid="starccm-su2-mesh-import" className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4" aria-label={zh ? 'SU2 ASCII 网格导入与准备' : 'SU2 ASCII mesh import and preparation'}>
    <header className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-100">{zh ? '独立工作流：SU2 ASCII 网格导入与准备' : 'Separate workflow: SU2 ASCII mesh import and preparation'}</h2>
      <p className="max-w-4xl text-sm leading-relaxed text-slate-300">{zh
        ? '读取有界的 SU2 原生 ASCII 网格，预检节点、线性单元和边界标签，然后提交到现有固定版本 W-Sim 原生 SU2 网格导入操作。结果仅是校验与几何摘要。'
        : 'Preflight a bounded SU2 native ASCII mesh, its points, linear cells, and boundary tags, then submit it to the existing pinned W-Sim native SU2 mesh-import operation. The result is a validation and geometry summary only.'}</p>
      <p className="text-xs leading-relaxed text-amber-200/90">{zh
        ? '不读取 STAR-CCM+ 专有 .sim，不运行 CFD 求解器，也不声明完整网格互通或数值等价。'
        : 'This does not read proprietary STAR-CCM+ .sim files, run a CFD solver, or claim full mesh interoperability or numerical equivalence.'}</p>
    </header>

    <div className="space-y-2 rounded border border-edge bg-slate-950/40 p-3 text-xs leading-relaxed text-slate-300">
      <p>{zh ? '支持 ASCII NDIME 2/3、VTK 线性类型 1、3、5、9、10、12、13、14 和命名 NMARK 标签。标准 NPOIN 在 NELEM 前；为兼容固定原生版本，提交前只移动完整 NPOIN / NELEM 区块，不修改坐标、连接或标签。' : 'Supports ASCII NDIME 2/3, VTK linear types 1, 3, 5, 9, 10, 12, 13, and 14, plus named NMARK tags. Standard input places NPOIN before NELEM; for the pinned native version, preflight moves only the complete NPOIN / NELEM blocks before submission and does not alter coordinates, connectivity, or tags.'}</p>
      <p>{zh ? '本地来源上限 1 MiB，另受共享 1 MiB 序列化 Host 输入限制；原生读入器有自己的 8 MiB 文本限制。多区、二进制、CGNS、高阶/未知单元和额外区段均不支持。' : 'The local source cap is 1 MiB and the serialized Host input also has the shared 1 MiB cap; the native reader has its own 8 MiB text cap. Multizone, binary, CGNS, higher-order/unknown cells, and extra sections are unsupported.'}</p>
    </div>

    <label className="block text-sm text-slate-300">{zh ? '选择 SU2 文件' : 'Choose SU2 file'}
      <input type="file" accept=".su2,text/plain" disabled={execution?.busy} onChange={event => { void readFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border file:border-edge file:bg-surface file:px-3 file:py-2" />
    </label>
    {filename && <p className="text-xs text-slate-400">{zh ? '文件名' : 'Filename'}: {filename}</p>}
    <label className="block text-sm text-slate-300">{zh ? '粘贴 SU2 原生 ASCII 网格' : 'SU2 native mesh text'}
      <textarea aria-label="SU2 native mesh text" value={sourceText} disabled={execution?.busy} onChange={event => changeSource(event.currentTarget.value)} spellCheck={false} rows={10} className="mt-1 block w-full rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs text-slate-100 disabled:opacity-60" />
    </label>

    {preflight.ok && <div className="rounded border border-emerald-400/20 bg-emerald-950/20 p-3 text-xs text-slate-300" role="status">
      <p>{zh ? '本地预检通过' : 'Local preflight passed'}: NDIME {preflight.report.ndime} · {preflight.report.nodeCount} {zh ? '节点' : 'points'} · {preflight.report.elementCount} {zh ? '单元' : 'cells'} · {preflight.report.markerCount} {zh ? '边界标签' : 'boundary tags'}</p>
      {preflight.report.tags.length > 0 && <p className="mt-1 break-all">{zh ? '标签' : 'Tags'}: {preflight.report.tags.join(', ')}</p>}
      {candidate.input && candidate.input.mesh !== sourceText && <p className="mt-1">{zh ? '提交前已按固定读入器区段顺序移动 NPOIN / NELEM 区块。' : 'The NPOIN / NELEM blocks were reordered to match the pinned reader before submission.'}</p>}
    </div>}
    {(error || candidate.error || (!preflight.ok && sourceText)) && <p role="alert" className="text-sm text-rose-300">{error || candidate.error || (!preflight.ok ? preflight.error : '')}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn bg-cyan-300 text-slate-950 disabled:opacity-50" disabled={!candidate.input || !execution?.connected || execution.target !== 'backend' || execution.busy || execution.cancelPending} onClick={submit}>{execution?.busy ? (zh ? '任务运行中…' : 'Host job running…') : (zh ? '提交 SU2 网格到 Host' : 'Submit SU2 mesh to Host')}</button>
      {execution?.busy && <button type="button" className="btn border border-edge" onClick={cancel}>{zh ? '取消 SU2 网格任务' : 'Cancel SU2 mesh job'}</button>}
      {execution?.status && <span role="status" className="text-xs text-slate-400">{execution.status}</span>}
    </div>
    {execution?.loginRequired && <p role="alert" className="text-sm text-amber-200">{zh ? '请登录后提交此 Host 任务。' : 'Sign in to submit this Host job.'}</p>}
    {execution?.error && <p role="alert" className="text-sm text-rose-300">{execution.error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
    {saved && <StarCcmSu2MeshSummary result={saved.result} sourceText={saved.sourceText} submittedMeshText={saved.submittedMeshText} jobId={saved.jobId} />}
  </section>
}
