import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import {
  fetchHostJob,
  hostApiBase,
  fetchHostJobResult,
  createJobShare,
  createPathComparison,
  createResearchPublication,
  submitPathExperiment,
  importHostEvidence,
  fetchHostEvidence,
  fetchPathModelCatalog,
  fetchMyProjects,
  type HostEvidenceRecord,
  type HostJobDetail,
  type HostJobStoredResult,
  type HostPathEvidence,
  type HostPathExperimentResult,
  type HostPathExperimentSpec,
  type HostPathModelCatalogEntry,
  type HostPathComparison,
  type HostPublication,
  type HostProject,
} from '../lib/hostApi'
import { bytesToBase64, evidenceBinding, mapPathExperimentView, parseCalibrationCsv, parseCompareJobIds } from '../lib/pathExperimentView'

type Loaded = { job: HostJobDetail; stored: HostJobStoredResult | null; resultError?: string }
function idsFromQuery(value: string | null): string[] {
  return parseCompareJobIds(value)
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function entries(value: unknown): [string, unknown][] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
    : []
}

export function PathExperiments() {
  const [params, setParams] = useSearchParams()
  const queryIds = useMemo(() => idsFromQuery(params.get('jobs') ?? params.get('compare')), [params])
  const shareToken = params.get('share')
  const [input, setInput] = useState('')
  const [loaded, setLoaded] = useState<Loaded[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [researchBusy, setResearchBusy] = useState(false)
  const [comparison, setComparison] = useState<HostPathComparison | null>(null)
  const [publication, setPublication] = useState<HostPublication | null>(null)
  const [publicationTitle, setPublicationTitle] = useState('Ir 超声激发三线态活性氧路径研究')
  const [publicationPublic, setPublicationPublic] = useState(false)
  const [evidencePolicies, setEvidencePolicies] = useState<Record<string, 'embed' | 'external' | 'exclude'>>({})
  const [form, setForm] = useState({ complex: 'Ir(III) 配合物', oxygen: '0.21', excitation: '1.0', quenching: '0.08', isc: '0.85', modelId: 'photosensitization-rk4', modelVersion: '1.0.0', modelChecksum: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<HostEvidenceRecord[]>([])
  const [projects, setProjects] = useState<HostProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [bindings, setBindings] = useState<Record<string, HostPathEvidence>>({})
  const [evidenceBusy, setEvidenceBusy] = useState(false)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const [literature, setLiterature] = useState({ title: '', doi: '', citation: '' })
  const [bind, setBind] = useState({ evidenceId: '', target: 'O2', locator: '', transform: 'identity' })
  const [observations, setObservations] = useState<{ time: number[]; T1?: number[]; singletO2?: number[] } | null>(null)
  const [observationEvidence, setObservationEvidence] = useState<HostPathEvidence | null>(null)
  const [analysis, setAnalysis] = useState({ calibration: false, uncertainty: false, seed: '20260802', samples: '100' })
  const [modelCatalog, setModelCatalog] = useState<HostPathModelCatalogEntry[]>([])
  const [modelCatalogState, setModelCatalogState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchHostEvidence(), fetchMyProjects()]).then(([records, availableProjects]) => {
      if (!active) return
      setEvidence(records); setProjects(availableProjects)
      setEvidencePolicies(Object.fromEntries(records.map((record) => [record.id, defaultEvidencePolicy(record)])))
      if (records[0]) setBind((current) => current.evidenceId ? current : { ...current, evidenceId: records[0].id })
    }).catch((reason) => {
      if (active) setEvidenceError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setModelCatalogState('loading'); setModelCatalogError(null)
    const load = (initial: boolean) => fetchPathModelCatalog().then((models) => {
      if (!active) return
      setModelCatalog(models); setModelCatalogState('ready')
      setModelCatalogError(null)
      if (initial) {
        const available = models.filter((model) => model.available)
        setForm((current) => {
          const selected = available.find((model) => model.id === current.modelId && model.version === current.modelVersion) ?? available[0]
          return selected ? { ...current, modelId: selected.id, modelVersion: selected.version, modelChecksum: selected.implementationSha256 ?? '' } : current
        })
      }
    }).catch((reason) => {
      if (!active) return
      if (initial) setModelCatalog([])
      setModelCatalogState('error')
      setModelCatalogError(reason instanceof Error ? reason.message : String(reason))
    })
    void load(true)
    const refresh = window.setInterval(() => { void load(false) }, 30_000)
    return () => { active = false; window.clearInterval(refresh) }
  }, [])

  const selectedModel = modelCatalog.find((model) => model.id === form.modelId && model.version === form.modelVersion)
  const availableModels = modelCatalog.filter((model) => model.available)
  const supportsCalibration = selectedModel?.analyses?.includes('calibration') ?? false
  const supportsUncertainty = selectedModel?.analyses?.includes('uncertainty') ?? false

  useEffect(() => {
    setAnalysis((current) => ({
      ...current,
      calibration: supportsCalibration ? current.calibration : false,
      uncertainty: supportsUncertainty ? current.uncertainty : false,
    }))
  }, [supportsCalibration, supportsUncertainty])

  useEffect(() => {
    let active = true
    if (!queryIds.length) {
      setLoaded([])
      setError(null)
      return () => { active = false }
    }
    setLoading(true)
    setError(null)
    Promise.all(queryIds.map(async (id): Promise<Loaded> => {
      const job = await fetchHostJob(id, undefined, shareToken)
      if (job.status !== 'succeeded') return { job, stored: null }
      try {
        return { job, stored: await fetchHostJobResult(id, undefined, shareToken) }
      } catch (reason) {
        return { job, stored: null, resultError: reason instanceof Error ? reason.message : String(reason) }
      }
    })).then((items) => {
      if (active) setLoaded(items)
    }).catch((reason) => {
      if (active) {
        setLoaded([])
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [queryIds.join(','), shareToken])

  const add = () => {
    const additions = idsFromQuery(input)
    const next = [...new Set([...queryIds, ...additions])].slice(0, 8)
    if (next.length) setParams({ jobs: next.join(','), ...(shareToken ? { share: shareToken } : {}) })
    setInput('')
  }
  const remove = (id: string) => {
    const next = queryIds.filter((item) => item !== id)
    setParams(next.length ? { jobs: next.join(','), ...(shareToken ? { share: shareToken } : {}) } : {})
  }
  const share = async () => {
    try {
      const grant = await createJobShare(queryIds)
      const url = new URL(window.location.href)
      url.search = ''
      url.searchParams.set('jobs', queryIds.join(','))
      url.searchParams.set('share', grant.token)
      await navigator.clipboard.writeText(url.toString()); setCopied(true)
    } catch (reason) {
      setCopied(false); setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const compare = async () => {
    setResearchBusy(true); setError(null)
    try { setComparison(await createPathComparison(queryIds)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setResearchBusy(false) }
  }
  const publish = async () => {
    setResearchBusy(true); setError(null)
    try {
      const policies = Object.fromEntries(evidence.map((record) => {
        const mode = evidencePolicies[record.id] ?? defaultEvidencePolicy(record)
        const locator = evidenceLocator(record)
        return [record.id, mode === 'embed' ? { mode } : mode === 'external'
          ? { mode, ...(locator ? { locator } : {}) }
          : { mode, reason: '研究者选择不在发布包中分发此证据。' }]
      }))
      setPublication(await createResearchPublication(queryIds, publicationTitle.trim(), publicationPublic, undefined, policies))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setResearchBusy(false) }
  }
  const submit = async () => {
    setSubmitting(true); setSubmitError(null)
    try {
      const experiment = buildIrExperiment(form, bindings, buildAnalysis(analysis, observations, observationEvidence))
      const { job } = await submitPathExperiment(experiment, { ...(projectId ? { projectId } : {}) })
      const next = [...new Set([...queryIds, job.id])].slice(0, 8)
      setParams({ jobs: next.join(',') })
    } catch (reason) { setSubmitError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSubmitting(false) }
  }
  const importMeasured = async (file: File) => {
    setEvidenceBusy(true); setEvidenceError(null)
    try {
      const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'
      const bytes = new Uint8Array(await file.arrayBuffer())
      const record = await importHostEvidence({ kind: 'measured', title: file.name, format, contentType: file.type || undefined, contentBase64: bytesToBase64(bytes), ...(projectId ? { projectId } : {}) })
      setEvidence((items) => [record, ...items]); setEvidencePolicies((items) => ({ ...items, [record.id]: defaultEvidencePolicy(record) })); setBind((current) => ({ ...current, evidenceId: record.id }))
      if (format === 'csv') {
        const parsed = parseCalibrationCsv(new TextDecoder().decode(bytes))
        if (parsed) { setObservations(parsed); setObservationEvidence(evidenceBinding(record, 'columns=time,T1|singletO2', 'CSV numeric parse v1')); setAnalysis((current) => ({ ...current, calibration: true })) }
      }
    } catch (reason) { setEvidenceError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setEvidenceBusy(false) }
  }
  const importLiterature = async () => {
    setEvidenceBusy(true); setEvidenceError(null)
    try {
      const record = await importHostEvidence({ kind: 'literature', title: literature.title, doi: literature.doi || undefined, citation: literature.citation || undefined, ...(projectId ? { projectId } : {}) })
      setEvidence((items) => [record, ...items]); setEvidencePolicies((items) => ({ ...items, [record.id]: defaultEvidencePolicy(record) })); setBind((current) => ({ ...current, evidenceId: record.id })); setLiterature({ title: '', doi: '', citation: '' })
    } catch (reason) { setEvidenceError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setEvidenceBusy(false) }
  }
  const bindEvidence = () => {
    const record = evidence.find((item) => item.id === bind.evidenceId)
    if (!record) return
    setBindings((current) => ({ ...current, [bind.target]: evidenceBinding(record, bind.locator, bind.transform) }))
  }

  return (
    <div>
      <PageHeader icon="🧪" title="路径实验分享与比较" subtitle="用稳定任务 ID 恢复不可变规格与数据库缓存结果；分享链接不内嵌或伪造计算结果。" />
      <div className="card mb-5 p-4">
        <div className="flex flex-wrap gap-2">
          <input className="min-w-72 flex-1 rounded border border-edge bg-edge/30 px-3 py-2 text-sm text-slate-200" value={input}
            onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add() }}
            placeholder="输入 job ID；多个 ID 用逗号分隔" aria-label="任务 ID" />
          <button className="btn border border-wave/40 text-wave" onClick={add}>加入比较</button>
          <button className="btn border border-edge text-slate-300" disabled={!queryIds.length} onClick={share}>{copied ? '✓ 已复制' : '🔗 复制分享链接'}</button>
          <button className="btn border border-cyan-500/40 text-cyan-300" disabled={researchBusy || queryIds.length < 2 || !!shareToken} onClick={compare}>生成审计比较 Artifact</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">链接只携带 job IDs；页面每次都从 Host <code>/api/v1/jobs/:id</code> 与 <code>/result</code> 加载权威记录。</p>
        {!!queryIds.length && <div className="mt-3 flex flex-wrap gap-2">{queryIds.map((id) => <span key={id} className="rounded-full bg-wave/10 px-2 py-1 font-mono text-xs text-wave">{id}<button className="ml-2 text-slate-500 hover:text-white" onClick={() => remove(id)} aria-label={`移除 ${id}`}>×</button></span>)}</div>}
        <div className="mt-3 flex flex-wrap items-center gap-2"><input className="min-w-72 flex-1 rounded border border-edge bg-edge/30 px-3 py-2 text-xs text-slate-200" value={publicationTitle} onChange={(event) => setPublicationTitle(event.target.value)} placeholder="Publication 标题" /><label className="text-xs text-slate-400"><input className="mr-1" type="checkbox" checked={publicationPublic} onChange={(event) => setPublicationPublic(event.target.checked)} />允许匿名公开下载</label><button className="btn border border-emerald-500/40 text-emerald-300" disabled={researchBusy || !queryIds.length || !publicationTitle.trim() || !!shareToken} onClick={publish}>发布不可变科研 Bundle</button></div>
        {comparison && <div className="mt-3 rounded border border-cyan-500/20 bg-cyan-950/20 p-3 text-xs text-slate-300"><p className="font-semibold text-cyan-300">Comparison Artifact {comparison.id}</p><p className="mt-1 font-mono text-[10px] text-slate-500">manifest {comparison.envelope.manifestSha256}</p><div className="mt-2 overflow-x-auto"><table className="min-w-full text-left"><thead><tr><th className="pr-4">指标</th>{queryIds.map((id) => <th className="pr-4" key={id}>{id.slice(0, 8)}</th>)}</tr></thead><tbody>{comparison.envelope.manifest.result.metrics.slice(0, 12).map((metric) => <tr key={metric.key}><td className="pr-4">{metric.key} {metric.unit ?? ''}</td>{metric.values.map((value) => <td className="pr-4 font-mono" key={value.jobId}>{value.value.toPrecision(5)} <span className="text-slate-500">Δ {value.absoluteDelta.toPrecision(3)}</span></td>)}</tr>)}</tbody></table></div><p className="mt-2 text-slate-500">UQ 对齐指标：{comparison.envelope.manifest.result.uncertainty.length}</p>{comparison.envelope.manifest.result.differences && <div className="mt-3 border-t border-cyan-500/20 pt-3"><p className="font-semibold text-cyan-200">完整路径结构差异</p><div className="mt-2 grid gap-2 md:grid-cols-2">{comparison.envelope.manifest.result.differences.map((diff) => <div key={diff.jobId} className="rounded bg-edge/30 p-2"><p className="font-mono text-[10px]">{diff.jobId.slice(0, 8)} · +{diff.added.length} / −{diff.removed.length} / Δ{diff.changed.length}</p>{[...diff.added.map((item) => `+ ${item.path}`), ...diff.removed.map((item) => `− ${item.path}`), ...diff.changed.map((item) => `Δ ${item.path}`)].slice(0, 12).map((line) => <p key={line} className="truncate font-mono text-[10px] text-slate-500" title={line}>{line}</p>)}</div>)}</div><p className="mt-2 text-[10px] text-slate-500">比较覆盖模型、材料、步骤顺序/机理/假说、参数与证据锚点；完整快照保存在可验证 Artifact 中。</p></div>}</div>}
        {publication && <div className="mt-3 rounded border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs"><p className="font-semibold text-emerald-300">已发布 {publication.publicId} · v{publication.version}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">bundle SHA-256 {publication.bundleSha256}</p><a className="mt-2 inline-block text-emerald-300 underline" href={`${hostApiBase()}/api/v1/publications/${publication.publicId}/download?version=${publication.version}`}>下载并离线验证 Publication Bundle</a></div>}
      </div>
      <section className="card mb-5 p-4">
        <h2 className="text-sm font-semibold text-slate-200">新建 Ir 三线态 → ROS 路径任务</h2>
        <p className="mt-1 text-xs text-slate-500">预设仅提供可编辑初值；提交的是完整实验规格，不包含写死的结果。</p>
        <label className="mt-3 block max-w-xl text-xs text-slate-400"><span className="mb-1 block">项目归属（控制任务、证据与发布权限）</span><select className="w-full rounded border border-edge bg-edge/30 px-2 py-1.5 text-slate-200" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">个人研究空间</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Ir 配合物名称" value={form.complex} onChange={(complex) => setForm({ ...form, complex })} />
          <Field label="氧浓度 O₂" value={form.oxygen} unit="mM" onChange={(oxygen) => setForm({ ...form, oxygen })} />
          <Field label="激发速率 kexc" value={form.excitation} unit="s⁻¹" onChange={(excitation) => setForm({ ...form, excitation })} />
          <Field label="猝灭速率 kq" value={form.quenching} unit="s⁻¹" onChange={(quenching) => setForm({ ...form, quenching })} />
          <Field label="ISC 速率 kisc" value={form.isc} unit="s⁻¹" onChange={(isc) => setForm({ ...form, isc })} />
          <label className="text-xs text-slate-400"><span className="mb-1 block">模型插件与版本</span><select className="w-full rounded border border-edge bg-edge/30 px-2 py-1.5 text-slate-200" value={`${form.modelId}@${form.modelVersion}`} disabled={modelCatalogState !== 'ready' || !availableModels.length} onChange={(event) => { const model = availableModels.find((item) => `${item.id}@${item.version}` === event.target.value); if (model) setForm({ ...form, modelId: model.id, modelVersion: model.version, modelChecksum: model.implementationSha256 ?? '' }) }}>
            {!availableModels.length && <option value={`${form.modelId}@${form.modelVersion}`}>{modelCatalogState === 'loading' ? '正在加载 Agent 模型目录…' : '当前无可用模型 Agent'}</option>}
            {availableModels.map((model) => <option key={`${model.id}@${model.version}`} value={`${model.id}@${model.version}`}>{model.id}@{model.version} · {model.availableBackends.join('/')}</option>)}
          </select></label>
          <div className="rounded border border-edge bg-edge/20 px-2 py-1.5 text-[10px] text-slate-500"><span className="block text-xs text-slate-400">运行能力</span>{selectedModel?.available ? `${selectedModel.availableAgentCount} 个在线 Agent · ${selectedModel.availableBackends.join(', ')}` : '所选模型当前不可用，不能提交'}{modelCatalogError && <span className="mt-1 block text-red-300">目录加载失败：{modelCatalogError}</span>}</div>
        </div>
        <div className="mt-4 rounded-lg border border-edge p-3">
          <h3 className="text-xs font-semibold text-slate-300">证据导入与参数绑定</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <label className="rounded border border-dashed border-edge p-3 text-xs text-slate-400">实验数据 CSV / JSON
              <input className="mt-2 block w-full text-[11px]" type="file" accept=".csv,.json,text/csv,application/json" disabled={evidenceBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMeasured(file); event.target.value = '' }} />
            </label>
            <div className="rounded border border-edge p-3">
              <p className="mb-2 text-xs text-slate-400">登记文献 DOI / citation</p>
              <div className="grid gap-2"><input className="rounded bg-edge/40 px-2 py-1 text-xs text-slate-200" placeholder="文献标题" value={literature.title} onChange={(event) => setLiterature({ ...literature, title: event.target.value })} /><input className="rounded bg-edge/40 px-2 py-1 text-xs text-slate-200" placeholder="DOI（与 citation 至少一个）" value={literature.doi} onChange={(event) => setLiterature({ ...literature, doi: event.target.value })} /><input className="rounded bg-edge/40 px-2 py-1 text-xs text-slate-200" placeholder="Citation" value={literature.citation} onChange={(event) => setLiterature({ ...literature, citation: event.target.value })} /><button className="btn border border-edge text-xs text-slate-300" disabled={evidenceBusy || !literature.title || (!literature.doi && !literature.citation)} onClick={importLiterature}>登记文献</button></div>
            </div>
          </div>
          {evidenceError && <p className="mt-2 text-xs text-red-300">{evidenceError}</p>}
          {!!evidence.length && <><div className="mt-3 space-y-1">{evidence.map((item) => <div key={item.id} className="rounded bg-edge/30 px-2 py-1 text-[10px] text-slate-400"><div className="flex flex-wrap items-center gap-2"><span className="text-slate-200">{item.title}</span><span>{item.kind}</span>{item.projectId && <span className="text-sky-300">project {item.projectId.slice(0, 8)}</span>}<label className="ml-auto">发布处置 <select className="rounded bg-edge/60 p-1 text-slate-200" value={evidencePolicies[item.id] ?? defaultEvidencePolicy(item)} onChange={(event) => setEvidencePolicies((current) => ({ ...current, [item.id]: event.target.value as 'embed' | 'external' | 'exclude' }))}><option value="embed" disabled={item.metadata.redistributionAllowed !== true}>嵌入原始证据{item.metadata.redistributionAllowed !== true ? '（未获许可）' : ''}</option><option value="external" disabled={!evidenceLocator(item)}>外部引用{!evidenceLocator(item) ? '（无定位符）' : ''}</option><option value="exclude">排除并记录原因</option></select></label></div><p className="break-all font-mono">ID {item.id} · SHA-256 {item.sha256}</p></div>)}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-[10px] text-slate-500">证据<select className="mt-1 w-full rounded bg-edge/40 p-1.5 text-xs text-slate-200" value={bind.evidenceId} onChange={(event) => setBind({ ...bind, evidenceId: event.target.value })}>{evidence.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="text-[10px] text-slate-500">绑定参数<select className="mt-1 w-full rounded bg-edge/40 p-1.5 text-xs text-slate-200" value={bind.target} onChange={(event) => setBind({ ...bind, target: event.target.value })}>{['O2', 'k_exc', 'k_q', 'k_isc'].map((key) => <option key={key}>{key}</option>)}</select></label><Field label="Locator" value={bind.locator} onChange={(locator) => setBind({ ...bind, locator })} /><Field label="Transform" value={bind.transform} onChange={(transform) => setBind({ ...bind, transform })} /></div><button className="btn mt-2 border border-sky-500/30 text-xs text-sky-300" onClick={bindEvidence}>绑定到参数</button>
          </>}
          {!!Object.keys(bindings).length && <p className="mt-2 text-[10px] text-emerald-300">已绑定：{Object.entries(bindings).map(([key, source]) => `${key} ← ${source.evidenceId}`).join('；')}</p>}
        </div>
        <div className="mt-4 rounded-lg border border-edge p-3"><h3 className="text-xs font-semibold text-slate-300">模型校准与不确定性</h3><div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400"><label><input className="mr-1" type="checkbox" checked={analysis.calibration} disabled={!observations || !supportsCalibration} onChange={(event) => setAnalysis({ ...analysis, calibration: event.target.checked })} />使用导入 CSV 校准 k_exc / k_q</label><label><input className="mr-1" type="checkbox" checked={analysis.uncertainty} disabled={!supportsUncertainty} onChange={(event) => setAnalysis({ ...analysis, uncertainty: event.target.checked })} />执行 seeded ensemble UQ</label></div>{observations && <p className="mt-2 text-[10px] text-emerald-300">已识别 {observations.time.length} 个观测点：{[observations.T1 && 'T1', observations.singletO2 && 'singletO2'].filter(Boolean).join(' + ')}</p>}{analysis.uncertainty && <div className="mt-2 grid gap-2 sm:grid-cols-2"><Field label="随机种子" value={analysis.seed} onChange={(seed) => setAnalysis({ ...analysis, seed })} /><Field label="样本数" value={analysis.samples} onChange={(samples) => setAnalysis({ ...analysis, samples })} /></div>}<p className="mt-2 text-[10px] text-slate-500">能力来自 Agent 模型 manifest；校准和 UQ 的 seed/规格会固化进 audit manifest。</p></div>
        <div className="mt-3 flex items-center gap-3"><button className="btn border border-wave/40 text-wave" disabled={submitting || !selectedModel?.available} onClick={submit}>{submitting ? '提交中…' : selectedModel?.available ? '提交计算任务并加入比较' : '模型当前不可用'}</button><span className="text-[10px] text-slate-500">POST /api/v1/jobs?reuse=1</span></div>
        {submitError && <p className="mt-2 text-xs text-red-300">提交失败：{submitError}</p>}
      </section>
      {loading && <p className="text-sm text-slate-400">正在从 Host 加载规格与缓存结果…</p>}
      {error && <div className="note border-red-500/30 text-red-300">加载失败：{error}</div>}
      {!loading && !error && !queryIds.length && <div className="note">加入两个或更多已存在的任务 ID，即可进行路径级并列比较并生成稳定分享链接。</div>}
      <div className="overflow-x-auto pb-4"><div className="grid min-w-max gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(loaded.length, 1)}, minmax(340px, 1fr))` }}>
        {loaded.map((item) => <JobColumn key={item.job.id} {...item} />)}
      </div></div>
    </div>
  )
}

function JobColumn({ job, stored, resultError }: Loaded) {
  const result = stored?.result ?? job.result
  const summary = result && typeof result === 'object' ? (result as Record<string, unknown>).summary : null
  const backend = result && typeof result === 'object' ? (result as Record<string, unknown>).backend : null
  const pathResult = result && typeof result === 'object'
    ? (result as { experiment?: HostPathExperimentResult }).experiment
    : undefined
  if (job.spec.experiment) {
    return <PathJobColumn job={job} stored={stored} result={pathResult} resultError={resultError} />
  }
  return <article className="card w-[min(82vw,460px)] p-4 lg:w-auto">
    <header className="border-b border-edge pb-3"><div className="flex justify-between gap-3"><h2 className="font-semibold text-white">{job.name ?? job.spec.name ?? job.id}</h2><Status value={job.status} /></div><p className="mt-1 break-all font-mono text-[10px] text-slate-500">job {job.id}</p></header>
    <Section title="完整计算路径"><ol className="space-y-2 text-xs">
      <Step n="1" title="模型输入" detail={text(job.spec.model ?? '未声明模型')} />
      <Step n="2" title="参数与边界" detail={`${Object.keys(job.spec.parameters).length} 个参数 · ${text(job.spec.run)}`} />
      <Step n="3" title={`求解器 · ${job.spec.kind}`} detail={text(job.spec.requirements ?? '后端自动选择')} />
      <Step n="4" title="持久化结果" detail={stored ? '已由 /result 从数据库缓存恢复' : job.status === 'succeeded' ? '缓存结果不可用' : `等待任务完成（${job.status}）`} />
    </ol></Section>
    <Section title="材料 / 模型"><KeyValues rows={entries(job.spec.model)} empty="任务协议未声明模型材料" /></Section>
    <Section title="机理假说"><p className="text-xs text-slate-400">任务种类 <span className="font-mono text-slate-200">{job.spec.kind}</span> 定义当前求解机理；未在规格中声明的材料机理不作为实测事实。</p><Badge label="模型假设" kind="assumption" /></Section>
    <Section title="参数"><KeyValues rows={entries(job.spec.parameters)} empty="无参数" /><div className="mt-2"><Badge label="任务规格" kind="specified" /></div></Section>
    <Section title="结果摘要">{resultError ? <p className="text-xs text-red-300">{resultError}</p> : result ? <><KeyValues rows={entries(summary)} empty="结果无 summary" /><div className="mt-2"><Badge label="数据库计算结果" kind="computed" /></div></> : <p className="text-xs text-slate-500">尚无完成结果</p>}</Section>
    <Section title="模型版本 / 来源"><KeyValues rows={[["schema", job.spec.schemaVersion], ["spec fingerprint", stored?.specFingerprint ?? job.specFingerprint], ["backend", text(backend)], ["agent", job.agentId], ["finished", job.finishedAt]]} empty="无溯源信息" /><p className="mt-2 text-[10px] text-slate-500">来源：WaveWorld Host 权威任务库 · API job/result</p></Section>
  </article>
}

function PathJobColumn({ job, stored, result, resultError }: {
  job: HostJobDetail; stored: HostJobStoredResult | null; result?: HostPathExperimentResult; resultError?: string
}) {
  const spec = job.spec.experiment!
  const view = mapPathExperimentView(spec, result)
  return <article className="card w-[min(82vw,460px)] p-4 lg:w-auto">
    <header className="border-b border-edge pb-3"><div className="flex justify-between gap-3"><div><h2 className="font-semibold text-white">{view.title}</h2><p className="mt-1 text-xs text-slate-400">{spec.description}</p></div><Status value={job.status} /></div><p className="mt-1 break-all font-mono text-[10px] text-slate-500">job {job.id} · experiment {view.id}</p></header>
    <Section title="完整路径 / 机理假说"><ol className="space-y-2">{view.steps.map((step, index) => <li key={step.id} className="rounded bg-edge/35 p-3 text-xs">
      <div className="flex gap-2 text-slate-200"><span className="text-wave">{index + 1}</span><strong>{step.label}</strong><Hypothesis value={step.hypothesis.status} /></div>
      <p className="mt-1 text-slate-400">{step.mechanism}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{step.inputs.join(' + ')} → {step.outputs.join(' + ')}</p>
      <p className="mt-2 border-l-2 border-amber-400/30 pl-2 text-[11px] text-slate-400">{step.hypothesis.description}</p><Sources values={step.hypothesis.sources} />
    </li>)}</ol></Section>
    <Section title="材料"> <div className="space-y-2">{view.materials.map((material) => <div key={material.id} className="flex justify-between gap-3 text-xs"><div><p className="text-slate-200">{material.name}{material.formula ? ` · ${material.formula}` : ''}</p><p className="text-slate-500">{material.role}</p></div><Evidence source={material.source} /></div>)}</div></Section>
    <Section title="参数"><dl className="space-y-2">{Object.entries(view.parameters).map(([key, parameter]) => <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs"><dt className="font-mono text-slate-500">{key}</dt><dd className="font-mono text-slate-200">{text(parameter.value)} {parameter.unit}</dd><Evidence source={parameter.source} /></div>)}</dl></Section>
    <Section title="计算结果">{resultError ? <p className="text-xs text-red-300">{resultError}</p> : !view.resultMatchesSpec ? <p className="text-xs text-red-300">结果 experimentId 与任务规格不一致，已拒绝展示。</p> : Object.keys(view.outputs).length ? <dl className="space-y-2">{Object.entries(view.outputs).map(([key, output]) => <div key={key} className="flex justify-between gap-3 text-xs"><dt className="font-mono text-slate-500">{key}</dt><dd className="font-mono text-violet-300">{text(output.value)} {output.unit} {output.source && <Evidence source={output.source} />}</dd></div>)}</dl> : <p className="text-xs text-slate-500">{job.status === 'succeeded' ? '完成结果中没有路径 outputs' : '等待计算完成'}</p>}</Section>
    <Section title="模型版本 / 来源"><KeyValues rows={[["model", `${view.model.id}@${view.model.version}`], ["implementation", view.model.implementation], ["checksum", view.model.checksum], ["result model", view.resultModelVersion], ["engine", view.resultProvenance?.engineVersion], ["computed", view.resultProvenance?.computedAt], ["spec fingerprint", stored?.specFingerprint ?? job.specFingerprint], ["audit", stored?.audit?.status], ["audit manifest", stored?.audit?.manifestSha256], ["software", `${view.provenance.software.name}@${view.provenance.software.version}`]]} empty="无溯源信息" /><p className="mt-2 text-[10px] text-slate-500">权威来源：WaveWorld Host job/result 数据库记录</p></Section>
  </article>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="border-b border-edge py-4 last:border-0"><h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>{children}</section> }
function Step({ n, title, detail }: { n: string; title: string; detail: string }) { return <li className="rounded bg-edge/35 p-2"><div className="text-slate-200"><span className="mr-2 text-wave">{n}</span>{title}</div><p className="mt-1 break-words font-mono text-[10px] text-slate-500">{detail}</p></li> }
function KeyValues({ rows, empty }: { rows: [string, unknown][]; empty: string }) { const visible = rows.filter(([, value]) => value !== null && value !== undefined); return visible.length ? <dl className="space-y-1.5">{visible.map(([key, value]) => <div key={key} className="flex justify-between gap-3 text-xs"><dt className="font-mono text-slate-500">{key}</dt><dd className="max-w-64 break-words text-right font-mono text-slate-200">{text(value)}</dd></div>)}</dl> : <p className="text-xs text-slate-500">{empty}</p> }
function Badge({ label, kind }: { label: string; kind: 'assumption' | 'specified' | 'computed' }) { const tone = kind === 'computed' ? 'text-violet-300 bg-violet-500/10' : kind === 'specified' ? 'text-sky-300 bg-sky-500/10' : 'text-amber-300 bg-amber-500/10'; return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${tone}`}>{label}</span> }
function Status({ value }: { value: string }) { const tone = value === 'succeeded' ? 'text-emerald-300 bg-emerald-500/10' : value === 'failed' ? 'text-red-300 bg-red-500/10' : 'text-amber-300 bg-amber-500/10'; return <span className={`h-fit rounded-full px-2 py-0.5 text-[10px] ${tone}`}>{value}</span> }
function Hypothesis({ value }: { value: 'accepted' | 'candidate' | 'disputed' }) { const label = value === 'accepted' ? '已接受' : value === 'candidate' ? '候选假说' : '有争议'; return <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">{label}</span> }
function Evidence({ source }: { source: HostPathEvidence }) { const labels = { measured: '实测', literature: '文献', assumption: '假设', computed: '计算' }; const tones = { measured: 'text-emerald-300', literature: 'text-sky-300', assumption: 'text-amber-300', computed: 'text-violet-300' }; return <span title={[source.citation, source.note].filter(Boolean).join(' · ')} className={`inline-block rounded-full bg-edge/70 px-2 py-0.5 text-[10px] ${tones[source.kind]}`}>{labels[source.kind]}</span> }
function Sources({ values }: { values: HostPathEvidence[] }) { return <div className="mt-2 space-y-1">{values.map((source, index) => <div key={index} className="flex items-start gap-2 text-[10px] text-slate-500"><Evidence source={source} />{source.uri ? <a href={source.uri} target="_blank" rel="noreferrer" className="break-all text-wave hover:underline">{source.citation ?? source.uri}</a> : <span>{source.citation ?? source.note}</span>}</div>)}</div> }
function Field({ label, value, unit, onChange }: { label: string; value: string; unit?: string; onChange: (value: string) => void }) { return <label className="text-xs text-slate-400"><span className="mb-1 block">{label}</span><span className="flex items-center rounded border border-edge bg-edge/30"><input className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-slate-200 outline-none" value={value} onChange={(event) => onChange(event.target.value)} />{unit && <span className="pr-2 font-mono text-[10px] text-slate-500">{unit}</span>}</span></label> }

export function buildIrExperiment(form: { complex: string; oxygen: string; excitation: string; quenching: string; isc: string; modelId?: string; modelVersion: string; modelChecksum?: string }, bindings: Record<string, HostPathEvidence> = {}, analysis?: HostPathExperimentSpec['analysis']): HostPathExperimentSpec {
  const assumption = (note: string): HostPathEvidence => ({ kind: 'assumption', note })
  return {
    experimentId: `ir-ros-${stableFormId({ form, bindings, analysis })}`, title: `${form.complex} · 超声三线态 ROS`,
    description: '超声耦合激发 Ir 配合物，经系间窜越形成三线态并与氧发生能量/电子转移。',
    materials: [
      { id: 'ir-complex', name: form.complex, role: '声敏剂 / 三线态敏化剂', source: assumption('用户输入的材料名称，尚未绑定材料证据') },
      { id: 'oxygen', name: '溶解氧 O₂', role: 'ROS 前体与三线态猝灭剂', source: bindings.O2 ?? assumption('用户输入浓度，尚未绑定测量证据') },
    ],
    steps: [
      { id: 'ultrasound-excitation', label: '超声耦合激发', mechanism: '空化/声致发光等候选耦合使敏化剂进入激发态', inputs: ['ultrasound', 'Ir(S0)'], outputs: ['Ir(S1)'], hypothesis: { status: 'disputed', description: '具体超声到电子激发的主导通道依体系而定。', sources: [assumption('待实验区分的机理假说')] } },
      { id: 'isc', label: '系间窜越', mechanism: 'Ir(S1) → Ir(T1)', inputs: ['Ir(S1)'], outputs: ['Ir(T1)'], hypothesis: { status: 'candidate', description: '重原子效应促进 ISC。', sources: [assumption('由用户输入 ISC 产率参数化')] } },
      { id: 'ros', label: 'ROS 生成', mechanism: 'T1 与 O₂ 能量/电子转移（Type II / Type I）', inputs: ['Ir(T1)', 'O2'], outputs: ['ROS'], hypothesis: { status: 'candidate', description: '两分支贡献由动力学模型求解。', sources: [assumption('模型分支假说')] } },
    ],
    parameters: {
      O2: { value: number(form.oxygen, 0.21), unit: 'mM', source: bindings.O2 ?? assumption('用户输入，尚未绑定测量证据') },
      k_exc: { value: number(form.excitation, 1), unit: 's^-1', source: bindings.k_exc ?? assumption('模型输入') },
      k_q: { value: number(form.quenching, 0.08), unit: 'mM^-1 s^-1', source: bindings.k_q ?? assumption('模型输入') },
      k_isc: { value: number(form.isc, 0.85), unit: 's^-1', source: bindings.k_isc ?? assumption('模型输入') },
    },
    model: { id: form.modelId || 'photosensitization-rk4', version: form.modelVersion || '1.0.0', implementation: 'WaveWorld path-experiment plugin', ...(form.modelChecksum ? { checksum: form.modelChecksum } : {}) },
    ...(analysis ? { analysis } : {}),
    provenance: { createdAt: new Date().toISOString(), software: { name: 'WaveWorld Atlas', version: '3' }, notes: '由路径实验比较页创建' },
  }
}
function buildAnalysis(config: { calibration: boolean; uncertainty: boolean; seed: string; samples: string }, observations: { time: number[]; T1?: number[]; singletO2?: number[] } | null, observationEvidence: HostPathEvidence | null): HostPathExperimentSpec['analysis'] | undefined {
  const calibration = config.calibration && observations ? { observations, ...(observationEvidence ? { evidence: observationEvidence } : {}), fitParameters: { k_exc: { min: 0.05, max: 3, gridPoints: 13 }, k_q: { min: 0.001, max: 3, gridPoints: 13 } }, rounds: 3 } : undefined
  const uncertainty = config.uncertainty ? { seed: Math.trunc(number(config.seed, 20260802)), samples: Math.max(10, Math.min(5000, Math.trunc(number(config.samples, 100)))), relativeSigma: 0.05 } : undefined
  return calibration || uncertainty ? { ...(calibration ? { calibration } : {}), ...(uncertainty ? { uncertainty } : {}) } : undefined
}
function evidenceLocator(record: HostEvidenceRecord): string {
  const value = record.metadata.doi ?? record.metadata.url ?? record.metadata.citation
  return typeof value === 'string' ? value.trim() : ''
}
function defaultEvidencePolicy(record: HostEvidenceRecord): 'embed' | 'external' | 'exclude' {
  if (record.metadata.redistributionAllowed === true) return 'embed'
  return evidenceLocator(record) ? 'external' : 'exclude'
}
function number(value: string, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback }
function stableFormId(form: object) { let hash = 2166136261; for (const char of JSON.stringify(form)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) } return (hash >>> 0).toString(16).padStart(8, '0') }
