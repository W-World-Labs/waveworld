import { useLocale } from '../../lib/i18n'
import type { ValidatedSu2MeshResult } from './su2MeshResult'

export type StarCcmSu2MeshSummaryProps = {
  result: ValidatedSu2MeshResult
  /** Original imported ASCII source, retained by the owning workflow. */
  sourceText: string
  /** Exact text passed to the pinned native reader, including normalization. */
  submittedMeshText: string
  jobId: string
}

function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function numberText(value: number) {
  return Number.isFinite(value) ? String(value) : '—'
}

export function StarCcmSu2MeshSummary({ result, sourceText, submittedMeshText, jobId }: StarCcmSu2MeshSummaryProps) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const dimensions = Math.min(Math.max(result.dimension, 0), 3)
  const downloadReport = () => downloadText('waveworld-su2-mesh-report.json', JSON.stringify({ jobId, result, sourceText, submittedMeshText }, null, 2))

  return <section className="space-y-3 rounded-xl border border-edge bg-panel/50 p-4" aria-label={zh ? 'SU2 网格摘要' : 'SU2 mesh summary'}>
    <header>
      <h2 className="font-semibold">{zh ? '导入网格摘要' : 'Imported mesh summary'}</h2>
      <p className="mt-1 text-xs text-slate-400">{zh ? `Host 任务 ${jobId}` : `Host job ${jobId}`}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{zh
        ? '显示已固定的原生读取结果摘要。此内容不表示解析 STAR-CCM+ .sim 文件、运行求解器或与 STAR-CCM+ 网格保持等价。'
        : 'Shows summary data from the pinned native reader. This does not parse STAR-CCM+ .sim files, run a solver, or establish mesh parity with STAR-CCM+.'}</p>
    </header>
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {[
        [zh ? '维度' : 'Dimension', String(result.dimension)],
        [zh ? '节点' : 'Nodes', numberText(result.nodeCount)],
        [zh ? '单元' : 'Elements', numberText(result.elementCount)],
        [zh ? '边界标记' : 'Markers', numberText(result.markerCount)],
      ].map(([label, value]) => <div key={label} className="rounded border border-edge p-2"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 font-mono text-slate-100">{value}</dd></div>)}
    </dl>
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded border border-edge p-3">
        <h3 className="font-medium text-slate-200">{zh ? '包围盒' : 'Bounding box'}</h3>
        <p className="mt-1 text-slate-400">{zh ? '最小值' : 'Min'}: <span className="font-mono text-slate-200">{[result.boundingBox.xMin, result.boundingBox.yMin, ...(dimensions === 3 ? [result.boundingBox.zMin] : [])].map(numberText).join(', ')}</span></p>
        <p className="mt-1 text-slate-400">{zh ? '最大值' : 'Max'}: <span className="font-mono text-slate-200">{[result.boundingBox.xMax, result.boundingBox.yMax, ...(dimensions === 3 ? [result.boundingBox.zMax] : [])].map(numberText).join(', ')}</span></p>
      </div>
      <div className="rounded border border-edge p-3">
        <h3 className="font-medium text-slate-200">{zh ? '边界标签摘要' : 'Boundary tag summary'}</h3>
        {result.markers.length ? <ul className="mt-1 space-y-1">{result.markers.map((item, index) => <li key={`${item.tag}-${index}`} className="flex justify-between gap-2"><span className="break-all text-slate-300">{item.tag}</span><span className="font-mono text-slate-400">{numberText(item.elementCount)}</span></li>)}</ul> : <p className="mt-1 text-slate-400">{zh ? '无边界标签' : 'No boundary tags'}</p>}
      </div>
    </div>
    <div className="rounded border border-edge p-3">
      <h3 className="text-xs font-medium text-slate-200">{zh ? '原生聚合量' : 'Native aggregate measures'}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">{[
        ['Total length', result.totalLength], ['Total area', result.totalArea], ['Total volume', result.totalVolume],
        ['Marker measure', result.totalMarkerMeasure], ['Minimum element measure', result.minElementMeasure], ['Maximum element measure', result.maxElementMeasure],
      ].map(([name, value]) => <div key={name} className="flex justify-between gap-2"><dt className="break-all text-slate-400">{name}</dt><dd className="font-mono text-slate-200">{numberText(value as number)}</dd></div>)}</dl>
      <p className={`mt-2 text-xs ${result.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{zh ? `原生结果状态：${result.ok ? '正常' : '未通过'}` : `Native result status: ${result.ok ? 'ok' : 'not ok'}`}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn border border-edge text-sm" onClick={() => downloadText('waveworld-su2-original-source.su2', sourceText)}>{zh ? '下载原始导入 ASCII' : 'Download original imported ASCII'}</button>
      <button type="button" className="btn border border-edge text-sm" onClick={() => downloadText('waveworld-su2-submitted-mesh.su2', submittedMeshText)}>{zh ? '下载原生读取输入文本' : 'Download submitted mesh text'}</button>
      <button type="button" className="btn border border-edge text-sm" onClick={downloadReport}>{zh ? '下载完整报告 (JSON)' : 'Download full report (JSON)'}</button>
    </div>
  </section>
}
