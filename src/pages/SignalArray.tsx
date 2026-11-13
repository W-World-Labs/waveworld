import { useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'
import { validateModuleInput } from '../lib/sim/module-compute'
import { signalArrayExample, signalArrayResult, type SignalArrayScene } from '../lib/sim/signal-array'
import { WasmSignalArray } from '../lib/sim/wasm-fields'

function Field({ title, values, rows, cols, scale, unit, onCell }: {
  title: string; values: number[] | null; rows: number; cols: number; scale: number; unit: string; onCell?: (i: number) => void
}) {
  return <div className="card min-w-0 p-4">
    <h2 className="mb-3 font-medium text-slate-200">{title}</h2>
    {values ? <svg aria-label={title} role="img" viewBox={`0 0 ${cols * 48} ${rows * 48}`} className="mx-auto max-h-80 w-full">
      {values.map((v, i) => {
        const amount = Math.min(1, Math.abs(v) / scale)
        return <g key={i}>
          <rect x={(i % cols) * 48 + 1} y={Math.floor(i / cols) * 48 + 1} width={46} height={46} rx={4}
            fill={v < 0 ? `rgb(${30 + amount * 170},${40 + amount * 40},${65 + amount * 55})` : `rgb(25,${45 + amount * 150},${65 + amount * 160})`}
            role={onCell ? 'button' : undefined} tabIndex={onCell ? 0 : undefined}
            aria-label={onCell ? `Input cell ${Math.floor(i / cols) + 1},${i % cols + 1}: ${v}` : undefined}
            onClick={() => onCell?.(i)} onKeyDown={e => { if (onCell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onCell(i) } }}
            className={onCell ? 'cursor-pointer focus:outline focus:outline-2 focus:outline-white' : undefined}>
            <title>{`${i + 1}: ${v} ${unit}`}</title>
          </rect>
          <text pointerEvents="none" x={(i % cols) * 48 + 24} y={Math.floor(i / cols) * 48 + 28} textAnchor="middle" fontSize={10} fill="#f1f5f9">{v === 0 ? '0' : v.toPrecision(3)}</text>
        </g>
      })}
    </svg> : <div className="flex min-h-40 items-center justify-center text-slate-500">—</div>}
    <p className="mt-3 text-xs text-slate-400">{unit} · ±{scale.toPrecision(3)}</p>
  </div>
}

export function SignalArray() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const [scene, setScene] = useState<SignalArrayScene>(signalArrayExample)
  const [draft, setDraft] = useState(() => JSON.stringify(scene, null, 2))
  const [inputError, setInputError] = useState('')
  const [paint, setPaint] = useState(1)
  const ownerRef = useRef<WasmSignalArray | null>(null)
  const compute = useModuleCompute({ module: 'signal-array', scene })
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'signal-array' ? compute.result.result : null, error: '' }
    try {
      ownerRef.current ??= new WasmSignalArray()
      return { data: signalArrayResult(scene, ownerRef.current), error: '' }
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) } }
  }, [scene, compute.snapshot, compute.result])
  const data = preview.data
  const update = (next: SignalArrayScene) => { setScene(next); setDraft(JSON.stringify(next, null, 2)); setInputError('') }
  const apply = (text: string) => {
    try {
      if (new TextEncoder().encode(text).length > 512 * 1024) throw new Error('Array model exceeds 512 KiB')
      const next = JSON.parse(text.replace(/^\uFEFF/, ''))
      validateModuleInput({ module: 'signal-array', scene: next })
      update(next)
    } catch (error) { setInputError(error instanceof Error ? error.message : String(error)) }
  }
  const spatialScale = Math.max(...scene.input.map(Math.abs), ...(data?.reconstructed ?? []).map(Math.abs)) || 1
  const errorScale = Math.max(spatialScale * 1e-6, ...(data?.error ?? []).map(Math.abs)) || 1
  return <div>
    <PageHeader icon="▦" title="阵列感知与空间编解码" titleEn="Array sensing and spatial coding"
      subtitle="在左侧阵列写入空间信号，观察感知、编码测量与重建。可导入自己的感知矩阵、偏置和编码，比较噪声与测量不足的影响。"
      subtitleEn="Paint a spatial signal and inspect sensing, coded measurements and reconstruction. Import response matrices, offsets and codes to explore noise and insufficient measurements." />
    <div className="toolbar mb-4 gap-4">
      <button className="btn border border-edge" onClick={() => update(signalArrayExample())}>{zh ? '4 × 4 示例' : '4 × 4 example'}</button>
      <button className="btn border border-edge" onClick={() => update(signalArrayExample(true))}>{zh ? '行列读出示例' : 'Row/column example'}</button>
      <label className="flex items-center gap-2">{zh ? '编码' : 'Encoding'}
        <select aria-label="Array encoding" value={scene.encoding.kind} onChange={e => { if (e.target.value !== 'custom') update({ ...scene, encoding: { kind: e.target.value as 'direct' | 'hadamard' } }) }} className="rounded border border-edge bg-panel p-2">
          <option value="direct">{zh ? '直接读出' : 'Direct'}</option><option value="hadamard" disabled={(scene.sensing.length & (scene.sensing.length - 1)) !== 0}>Hadamard</option>
          {scene.encoding.kind === 'custom' && <option value="custom">{zh ? '自定义矩阵' : 'Custom matrix'}</option>}
        </select>
      </label>
      <label className="flex items-center gap-2">{zh ? '写入值' : 'Paint value'}
        <input aria-label="Array paint value" type="number" min={-1e6} max={1e6} step="any" value={paint} onChange={e => setPaint(Math.max(-1e6, Math.min(1e6, Number(e.target.value))))} className="w-24 rounded border border-edge bg-panel p-2" />
      </label>
      <label className="flex items-center gap-2">{zh ? '噪声峰值' : 'Noise peak'} {scene.noisePeakV} V
        <input aria-label="Array peak noise" type="range" min={0} max={0.5} step={0.005} value={Math.min(0.5, scene.noisePeakV)} onChange={e => update({ ...scene, noisePeakV: Number(e.target.value) })} />
      </label>
      <label className="flex items-center gap-2">{zh ? '正则强度 λ' : 'Regularization λ'}
        <input aria-label="Array regularization" type="number" min={0} max={1e6} step={0.0001} value={scene.regularization} onChange={e => update({ ...scene, regularization: Math.max(0, Math.min(1e6, Number(e.target.value))) })} className="w-28 rounded border border-edge bg-panel p-2" />
      </label>
    </div>
    <div className="toolbar mb-4 gap-4">
      <label className="flex items-center gap-2">{zh ? '读出电路' : 'Readout circuit'}
        <select aria-label="Array readout circuit" value={scene.readout ? 'rc' : 'ideal'} onChange={e => {
          if (e.target.value === 'rc') update({ ...scene, readout: { resistanceOhm: 1000, capacitanceF: 1e-7, dwellS: 1e-4, initialV: 0 } })
          else { const { readout: _, ...ideal } = scene; update(ideal) }
        }} className="rounded border border-edge bg-panel p-2">
          <option value="ideal">{zh ? '理想读出' : 'Ideal readout'}</option>
          <option value="rc">{zh ? '共享 RC · 顺序采样' : 'Shared RC · sequential scan'}</option>
        </select>
      </label>
      {scene.readout && ([
        { key: 'resistanceOhm', label: zh ? '电阻' : 'Resistance', unit: 'Ω', scale: 1, min: 1e-3, max: 1e12 },
        { key: 'capacitanceF', label: zh ? '电容' : 'Capacitance', unit: 'nF', scale: 1e9, min: 1e-6, max: 1e9 },
        { key: 'dwellS', label: zh ? '每路停留' : 'Channel dwell', unit: 'μs', scale: 1e6, min: 1e-6, max: 1e9 },
        { key: 'initialV', label: zh ? '初始电压' : 'Initial voltage', unit: 'V', scale: 1, min: -1e6, max: 1e6 },
      ] as const).map(({ key, label, unit, scale, min, max }) => <label key={key} className="flex items-center gap-2">{label}
        <input aria-label={`Array readout ${key}`} type="number" min={min} max={max} step="any" value={scene.readout![key] * scale}
          onChange={e => update({ ...scene, readout: { ...scene.readout!, [key]: Math.max(min, Math.min(max, Number(e.target.value))) / scale } })}
          className="w-24 rounded border border-edge bg-panel p-2" />{unit}
      </label>)}
    </div>
    {preview.error && <p role="alert" className="mb-4 text-rose-300">{preview.error}</p>}
    <div data-array-readout className="mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-edge p-4 text-sm">
      <span>{zh ? '传感通道' : 'Sensors'}: {scene.sensing.length}</span>
      <span>{zh ? '测量数' : 'Measurements'}: {data?.measuredV.length ?? '—'}</span>
      <span>{zh ? '可辨识维数' : 'Numerical rank'}: {data?.rank ?? '—'} / {scene.input.length}</span>
      {scene.readout && <span data-array-settling>τ: {data?.readoutTauS === undefined ? '—' : (data.readoutTauS * 1e6).toPrecision(4)} μs · {zh ? '每路建立比例' : 'Settled per channel'}: {data?.settlingFraction === undefined ? '—' : (data.settlingFraction * 100).toPrecision(4) + '%'}</span>}
      <span>RMSE: {data?.rmse?.toExponential(3) ?? '—'} {scene.unit}</span>
      <span>{zh ? '测量残差' : 'Residual'}: {data?.residualRmsV?.toExponential(3) ?? '—'} V</span>
      <span data-array-reconstruction={data?.status ?? 'pending'} className={data?.status === 'solved' ? 'text-cyan-300' : 'text-amber-200'}>
        {!data ? (zh ? '待计算' : 'Pending') : data.status === 'rank-deficient' ? (zh ? '无法唯一重建' : 'No unique reconstruction')
          : data.status === 'regularized' ? (zh ? '正则化估计' : 'Regularized estimate') : (zh ? '已重建' : 'Reconstructed')}
      </span>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Field title={zh ? '1 · 空间输入（点击写入）' : '1 · Spatial input (click to paint)'} values={scene.input} rows={scene.rows} cols={scene.cols} scale={spatialScale} unit={scene.unit}
        onCell={i => update({ ...scene, input: scene.input.map((v, index) => index === i ? paint : v) })} />
      {[
        { title: zh ? '2 · 感知电压' : '2 · Sensor voltages', label: 'Sensor voltages', values: data?.sensorV, ideal: undefined, sampled: undefined },
        { title: zh ? '3 · 编码测量' : '3 · Encoded measurements', label: 'Encoded measurements', values: data?.measuredV, ideal: scene.readout ? data?.idealV : undefined, sampled: scene.readout ? data?.sampledV : undefined },
      ].map(({ title, label, values, ideal, sampled }) => {
        const scale = Math.max(0, ...(values ?? []).map(Math.abs), ...(ideal ?? []).map(Math.abs), ...(sampled ?? []).map(Math.abs)) || 1
        return <div className="card min-w-0 p-4" key={label}>
          <h2 className="mb-3 font-medium text-slate-200">{title}</h2>
          <svg role="img" aria-label={label} viewBox="0 0 320 240" className="mx-auto max-h-80 w-full">
            <path d="M0 120H320" stroke="#475569" />
            {values?.map((v, i) => <rect key={i} x={i * 320 / values.length + 0.5} y={v >= 0 ? 120 - v / scale * 100 : 120}
              width={Math.max(1, 320 / values.length - 1)} height={Math.abs(v) / scale * 100} fill={v >= 0 ? '#22d3ee' : '#fb7185'}><title>{`${i + 1}: ${v} V`}</title></rect>)}
            {ideal?.map((v, i) => <path key={`ideal-${i}`} d={`M${i * 320 / ideal.length} ${120 - v / scale * 100}h${320 / ideal.length}`}
              stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 2"><title>{`${i + 1}: ideal ${v} V`}</title></path>)}
            {sampled?.map((v, i) => <circle key={`sample-${i}`} cx={(i + 0.5) * 320 / sampled.length} cy={120 - v / scale * 100} r={2.5} fill="#fff"><title>{`${i + 1}: sampled ${v} V`}</title></circle>)}
          </svg>
          {ideal && <p className="text-xs text-slate-400">{zh ? '虚线：目标电压 · 白点：RC 采样 · 柱：含噪测量' : 'Dashed: target · dots: RC sample · bars: noisy measurement'}</p>}
          <p className="mt-3 text-xs text-slate-400">±{scale.toPrecision(3)} V · {zh ? '横轴为通道序号' : 'Horizontal axis: channel index'}</p>
          {!values && <p className="text-sm text-slate-500">{zh ? '待计算' : 'Pending'}</p>}
        </div>
      })}
    </div>
    <p className="my-3 text-xs text-slate-400">{scene.readout ? (zh ? '空间输入在整次扫描期间保持不变；按编码行依次采样，每路停留指定时间。白点是采样时刻的电压，噪声在采样后加入。' : 'The spatial input is held for the entire scan. Code rows are sampled sequentially after the specified dwell. Dots mark acquisition endpoints; noise is added after sampling.') : (zh ? '每根柱表示一个编码通道的静态测量。' : 'Each bar represents one static code-channel measurement.')}</p>
    <div className="grid gap-4 md:grid-cols-2">
      <Field title={zh ? '4 · 解码重建' : '4 · Decoded reconstruction'} values={data?.reconstructed ?? null} rows={scene.rows} cols={scene.cols} scale={spatialScale} unit={scene.unit} />
      <Field title={zh ? '5 · 重建误差' : '5 · Reconstruction error'} values={data?.error ?? null} rows={scene.rows} cols={scene.cols} scale={errorScale} unit={scene.unit} />
    </div>
    <details className="card mt-4 p-4">
      <summary className="cursor-pointer text-sm">{zh ? '模型参数与矩阵 · 导入 / 导出' : 'Model and matrices · import / export'}</summary>
      <p className="my-3 text-sm text-slate-400">{zh ? 'input 按行排列；sensing 每行对应一个传感器，单位 V/输入单位；bias 为 V。自定义 encoding.matrix 每行对应一次测量。' : 'input is row-major; each sensing row describes a sensor in V/input-unit; bias is in V. Each custom encoding.matrix row defines one measurement.'}</p>
      <textarea aria-label="Array model JSON" spellCheck={false} value={draft} onChange={e => setDraft(e.target.value)} className="h-64 w-full rounded border border-edge bg-panel p-3 font-mono text-xs" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn bg-cyan-300 text-slate-950" onClick={() => apply(draft)}>{zh ? '应用模型' : 'Apply model'}</button>
        <input aria-label="Import array model" type="file" accept=".json,application/json" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''
          if (!file) return
          if (file.size > 512 * 1024) { setInputError('Array model exceeds 512 KiB'); return }
          try { apply(await file.text()) } catch (error) { setInputError(String(error)) }
        }} />
        <button className="btn border border-edge" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }))
          const a = document.createElement('a'); a.href = url; a.download = 'signal-array.json'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}>{zh ? '导出模型' : 'Export model'}</button>
      </div>
      {inputError && <p role="alert" className="mt-3 text-rose-300">{inputError}</p>}
      {data && <details className="mt-3">
        <summary className="cursor-pointer text-sm">{zh ? '实际编码矩阵 C' : 'Actual encoding matrix C'}</summary>
        <pre className="mt-2 max-h-64 overflow-auto text-xs" aria-label="Actual encoding matrix">{data.encoding.map(row => row.map(v => v.toPrecision(4)).join('  ')).join('\n')}</pre>
      </details>}
      {scene.readout && <p className="mt-3 text-xs text-slate-400">{zh ? '采用已知 RC 因果响应后的矩阵解码；数值秩与正则化基于实际采样算子。输入变化、ADC 量化、开关注入和放大器饱和未包括在单极点模型中。' : 'Decoding uses the known causal RC response; rank and ridge describe the actual sampled operator. Input changes during a scan, ADC quantization, switch injection and amplifier saturation are outside this single-pole model.'}</p>}
      {data && <p className="mt-3 text-xs text-slate-400">{zh ? '数值秩阈值' : 'Rank threshold'}: {data.rankTolerance.toExponential(3)}</p>}
    </details>
    <p className="note">{zh ? '感知电压由标定模型 v = Sx + b 得到。理想读出为 y = Cv + 噪声；RC 模式先计算各路采样时刻的建立电压，再加入噪声。解码采用对应测量算子的最小二乘与 λ 正则项；正则化引入先验约束，不代表增加了独立测量。柔性基板力学、材料非线性、多节点电路和阻抗成像仍需各自的物理模型或标定数据，未由这里的矩阵自动求得。'
      : 'Calibrated sensing: v = Sx + b. Ideal readout is Cv plus noise; RC readout includes sequential settling before noise. Least-squares decoding uses the corresponding measurement operator with ridge λ. Regularization imposes a prior; it does not add independent measurements. Flexible-substrate mechanics, nonlinear materials, multi-node circuits and impedance imaging require their own physics or calibration data.'}</p>
  </div>
}
