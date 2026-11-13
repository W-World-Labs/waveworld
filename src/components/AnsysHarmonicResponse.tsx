import { useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLocale } from '../lib/i18n'
import { ModuleComputeContext, useModuleCompute } from '../lib/hooks/useModuleCompute'
import type { ModuleComputeInput } from '../lib/sim/module-compute'
import {
  createAnsysHarmonicStudyInput,
  createDefaultAnsysHarmonicStudy,
  type AnsysHarmonicStudyDraft,
  type AnsysHarmonicStudyInput,
} from '../lib/sim/ansys-harmonic-study-input'
import {
  parseAnsysHarmonicNativeOutput,
  type AnsysHarmonicStudyResult,
} from '../lib/sim/ansys-harmonic-study-result'
import { AnsysHarmonicSetup } from './ansys/AnsysHarmonicSetup'
import { PageHeader } from './PageHeader'

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function harmonicCsv(result: AnsysHarmonicStudyResult): string {
  const rows = [['frequency_hz', 'frequency_rad_s', 'dof', 'response_re', 'response_im', 'amplitude', 'phase_deg']]
  for (const point of result.sweep) {
    for (let index = 0; index < result.dofs.length; index += 1) {
      const response = point.response[index]
      rows.push([
        String(point.freqHz), String(point.freqRads), String(result.dofs[index]),
        String(response.re), String(response.im), String(point.amplitude[index]), String(point.phaseDeg[index]),
      ])
    }
  }
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function reportJson(input: AnsysHarmonicStudyInput, result: AnsysHarmonicStudyResult, jobId: string | null): string {
  return `${JSON.stringify({
    product: 'Ansys Mechanical',
    workflow: 'bounded-mode-superposition-harmonic-response',
    nativeModule: input.module,
    jobId,
    submittedInput: input,
    result,
    scope: 'W-Sim native computation; supplied mass-normalized modes or SDOF only. This report is not an Ansys solver result or vendor parity claim.',
  }, null, 2)}\n`
}

export function AnsysHarmonicResponse() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const execution = useContext(ModuleComputeContext)
  const [draft, setDraft] = useState<AnsysHarmonicStudyDraft>(() => createDefaultAnsysHarmonicStudy())

  let validationMessage = ''
  let input: AnsysHarmonicStudyInput | null = null
  try {
    input = createAnsysHarmonicStudyInput(draft)
  } catch (cause) {
    validationMessage = cause instanceof Error ? cause.message : String(cause)
  }
  const computeInput = input ?? createAnsysHarmonicStudyInput(createDefaultAnsysHarmonicStudy())
  const compute = useModuleCompute(computeInput as ModuleComputeInput)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  let result: AnsysHarmonicStudyResult | null = null
  let outputError: string | null = null
  if (input && compute.result && compute.submittedInput) {
    try {
      result = parseAnsysHarmonicNativeOutput(compute.result, compute.submittedInput as AnsysHarmonicStudyInput)
      if (JSON.stringify(compute.submittedInput) !== JSON.stringify(input)) result = null
    } catch (cause) {
      outputError = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const edit = (next: AnsysHarmonicStudyDraft) => {
    execution?.clear()
    setDraft(next)
  }

  const submit = () => {
    if (!input || !execution || execution.target !== 'backend' || execution.busy || execution.cancelPending) return
    void execution.start(true)
  }

  const reset = () => {
    if (execution?.busy) void execution.stop()
    execution?.clear()
    setDraft(createDefaultAnsysHarmonicStudy())
  }

  const cancel = () => {
    if (execution?.busy) void execution.stop()
    execution?.clear()
  }

  const exportResult = (kind: 'json' | 'csv') => {
    if (!input || !result || !compute.submittedInput || JSON.stringify(compute.submittedInput) !== JSON.stringify(input)) return
    if (kind === 'csv') download('ansys-harmonic-response.csv', harmonicCsv(result), 'text/csv;charset=utf-8')
    else download('ansys-harmonic-response.json', reportJson(compute.submittedInput as AnsysHarmonicStudyInput, result, execution?.jobId ?? null), 'application/json;charset=utf-8')
  }

  const valid = !!input
  const busy = !!execution?.busy
  const canRun = valid && !!execution?.connected && execution.target === 'backend' && !busy && !execution?.cancelPending

  return <section className="space-y-4 rounded-xl border border-cyan-400/25 bg-cyan-950/10 p-4" aria-label={zh ? 'Mechanical 谐响应工作流' : 'Mechanical harmonic response workflow'}>
    <PageHeader title="Mechanical · 谐响应研究" titleEn="Mechanical · Harmonic response study" subtitle="设置单自由度或已知模态系统，提交有界的频率响应计算。" subtitleEn="Set up a single-degree-of-freedom or supplied modal system, then submit a bounded frequency-response computation." icon="〰️" showMethods={false} />
    <p className="max-w-4xl text-sm leading-relaxed text-slate-400">
      {zh
        ? '此向导将用户提供的质量归一化模态和谐波力提交到 W-Sim Host 原生模块。它不求解有限元模型，也不读取或生成 Ansys 项目文件。'
        : 'This guide sends user-supplied mass-normalized modes and harmonic forces to the W-Sim Host native module. It does not solve a finite-element model or read or create Ansys project files.'}
    </p>

    <AnsysHarmonicSetup draft={draft} onChange={edit} validationMessage={validationMessage} />

    <div className="flex flex-wrap items-center gap-3">
      <button type="button" id="ansys-harmonic-submit" data-testid="ansys-harmonic-submit" aria-label="ansys-harmonic-submit" className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canRun} onClick={submit}>{busy ? (zh ? '提交中…' : 'Submitting…') : (zh ? '提交到 Host' : 'Submit to Host')}</button>
      {busy && <button type="button" data-testid="ansys-harmonic-cancel" className="btn border border-edge" onClick={cancel}>{zh ? '取消任务' : 'Cancel job'}</button>}
      <button type="button" data-testid="ansys-harmonic-reset" className="btn border border-edge" onClick={reset}>{zh ? '重置' : 'Reset'}</button>
      {execution?.status && <span role="status" data-testid="ansys-harmonic-status" className="text-sm text-slate-400">{execution.status}</span>}
      {execution?.error && <span role="alert" className="text-sm text-rose-300">{execution.error}</span>}
      {outputError && <span role="alert" data-testid="ansys-harmonic-output-error" className="text-sm text-rose-300">{outputError}</span>}
      {execution?.jobId && <Link to={`/batch-jobs?job=${encodeURIComponent(execution.jobId)}`} className="text-sm text-cyan-300 underline">{zh ? '查看任务状态与已保存结果' : 'View job status and saved result'}</Link>}
    </div>

    {result && input && compute.submittedInput && JSON.stringify(compute.submittedInput) === JSON.stringify(input) && <div id="ansys-harmonic-result" data-testid="ansys-harmonic-result" aria-label="ansys-harmonic-result" className="space-y-3 rounded-lg border border-emerald-400/20 bg-emerald-950/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-medium text-emerald-100">{zh ? 'W-Sim 原生谐响应结果' : 'W-Sim native harmonic response result'}</h2><p className="mt-1 text-xs text-slate-400">{zh ? '显示与导出均绑定到已提交输入。' : 'Display and export are bound to the submitted input.'} · {result.system} · {result.nDof} DOF · {result.nModes} {zh ? '个模态' : 'modes'} · {result.nPoints} {zh ? '个频率点' : 'frequency points'}{execution?.jobId ? ` · Job ${execution.jobId}` : ''}</p></div>
        <div className="flex gap-2">
          <button type="button" id="ansys-harmonic-download-csv" data-testid="ansys-harmonic-download-csv" className="btn border border-edge" onClick={() => exportResult('csv')}>{zh ? '下载 CSV' : 'Download CSV'}</button>
          <button type="button" id="ansys-harmonic-download-json" data-testid="ansys-harmonic-download-json" className="btn border border-edge" onClick={() => exportResult('json')}>{zh ? '下载 JSON 报告' : 'Download JSON report'}</button>
        </div>
      </div>
      <p className="text-xs text-slate-400">Backend: {result.backend.id} ({result.backend.deviceName}) · Method: {result.method}</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-slate-400"><tr><th className="p-2">Hz</th><th className="p-2">rad/s</th><th className="p-2">DOF</th><th className="p-2">Response real</th><th className="p-2">Response imaginary</th><th className="p-2">Amplitude</th><th className="p-2">Phase (deg)</th></tr></thead><tbody>{result.sweep.flatMap((point, index) => result.dofs.map((dof, dofIndex) => <tr key={`${index}-${dof}`} className="border-t border-edge/60"><td className="p-2">{point.freqHz}</td><td className="p-2">{point.freqRads}</td><td className="p-2">{dof}</td><td className="p-2">{point.response[dofIndex].re}</td><td className="p-2">{point.response[dofIndex].im}</td><td className="p-2">{point.amplitude[dofIndex]}</td><td className="p-2">{point.phaseDeg[dofIndex]}</td></tr>))}</tbody></table></div>
      <div className="rounded-lg border border-edge p-3 text-sm text-slate-300"><h3 className="mb-2 font-medium">{zh ? '扫频峰值' : 'Sweep peaks'}</h3><ul className="grid gap-1 sm:grid-cols-2">{result.dofs.map((dof, index) => <li key={dof}>DOF {dof}: {result.peak.amplitude[index]} at {result.peak.frequencyHz[index]} Hz</li>)}</ul></div>
      <details className="rounded-lg border border-edge bg-slate-950/60 p-3"><summary className="min-h-10 cursor-pointer py-2 text-sm text-slate-300">{zh ? '已提交输入和原生结果' : 'Submitted input and native result'}</summary><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify({ submittedInput: compute.submittedInput, result }, null, 2)}</pre></details>
    </div>}
    <p className="text-xs text-slate-500">{zh ? '范围：线性、实模态叠加；模态形状与阻尼由调用方提供。此计算不调用 Ansys，不表示商业软件等价。' : 'Scope: linear real-mode superposition; mode shapes and damping are caller supplied. This computation does not invoke Ansys or claim commercial solver equivalence.'}</p>
  </section>
}
