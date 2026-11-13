import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase } from '../../lib/hostApi'
import { parseOpticStudioAgfGlass, type OpticStudioAgfGlass } from '../../lib/sim/opticstudio-agf-glass'
import { createOpticStudioAgfSellmeierJob, readOpticStudioAgfSellmeier } from '../../lib/sim/opticstudio-agf-sellmeier'
import { readModuleResult } from '../../lib/sim/module-compute'
import type { LensSurfaceDraft } from '../../lib/sim/lens-study-input'

type Props = {
  surfaces: readonly LensSurfaceDraft[]
  onApply: (surfaceIndex: number, glass: OpticStudioAgfGlass, nAfter?: number, wavelengthUm?: number) => void
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

/** Import an AGF reference glass or evaluate one supported wavelength on the native host. */
export function AgfReferenceGlassImport({ surfaces, onApply }: Props) {
  const [glasses, setGlasses] = useState<ReturnType<typeof parseOpticStudioAgfGlass>['glasses']>([])
  const [surfaceIndex, setSurfaceIndex] = useState(0)
  const [glassIndex, setGlassIndex] = useState(0)
  const [wavelengthUm, setWavelengthUm] = useState('0.5875618')
  const [sellmeierN, setSellmeierN] = useState<number | null>(null)
  const [sellmeierWavelength, setSellmeierWavelength] = useState<number | null>(null)
  const [sellmeierBusy, setSellmeierBusy] = useState(false)
  const sellmeierGeneration = useRef(0)
  const sellmeierController = useRef<AbortController | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => () => {
    sellmeierGeneration.current += 1
    sellmeierController.current?.abort(new DOMException('AGF material panel unmounted', 'AbortError'))
    sellmeierController.current = null
  }, [])

  function invalidateSellmeier() {
    sellmeierGeneration.current += 1
    sellmeierController.current?.abort(new DOMException('AGF material inputs changed', 'AbortError'))
    sellmeierController.current = null
    setSellmeierBusy(false)
    setSellmeierN(null)
    setSellmeierWavelength(null)
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    setGlasses([])
    setGlassIndex(0)
    invalidateSellmeier()
    setMessage('')
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      setMessage('AGF file exceeds the 4 MiB import limit. / AGF 文件超过 4 MiB 导入限制。')
      input.value = ''
      return
    }
    try {
      const parsed = parseOpticStudioAgfGlass(await file.text())
      setGlasses(parsed.glasses)
      const details = [...parsed.errors, ...parsed.diagnostics]
        .map(item => `${item.line === undefined ? '' : `Line ${item.line}: `}${item.message}`)
        .join(' ')
      if (parsed.errors.length) {
        setMessage(details)
      } else if (!parsed.glasses.length) {
        setMessage(details || 'No supported glass records were found.')
      } else if (details) {
        setMessage(details)
      } else {
        setMessage(`${parsed.glasses.length} glass records loaded.`)
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
    // Allow selecting the same file again after a parse error.
    input.value = ''
  }

  const selectedGlass = glasses[glassIndex]
  let sellmeierBounds: { minLambdaUm: number; maxLambdaUm: number } | null = null
  if (selectedGlass?.formulaId === 2) {
    try {
      sellmeierBounds = readOpticStudioAgfSellmeier(selectedGlass)
    } catch {
      sellmeierBounds = null
    }
  }
  const selectedSurfaceIndex = Math.min(surfaceIndex, Math.max(0, surfaces.length - 1))
  const retainedTagSummary = selectedGlass
    ? Object.entries(selectedGlass.metadata.reduce<Record<string, number>>((counts, row) => {
      counts[row.tag] = (counts[row.tag] ?? 0) + 1
      return counts
    }, {})).map(([tag, count]) => `${tag} ×${count}`).join(', ')
    : ''

  async function computeSellmeier() {
    if (!selectedGlass || !sellmeierBounds || sellmeierBusy) return
    const wavelength = wavelengthUm.trim() === '' ? Number.NaN : Number(wavelengthUm)
    if (!Number.isFinite(wavelength) || wavelength < sellmeierBounds.minLambdaUm || wavelength > sellmeierBounds.maxLambdaUm) {
      setMessage('Enter a finite wavelength in µm within the selected glass LD range. / 请输入所选玻璃 LD 范围内、以 µm 为单位的有限波长。')
      return
    }
    setSellmeierBusy(true)
    const generation = ++sellmeierGeneration.current
    const controller = new AbortController()
    sellmeierController.current?.abort(new DOMException('Replaced by a newer AGF material calculation', 'AbortError'))
    sellmeierController.current = controller
    setSellmeierN(null)
    setSellmeierWavelength(null)
    setMessage('Submitting native Sellmeier job… / 正在提交原生 Sellmeier 任务…')
    try {
      const { input, spec } = createOpticStudioAgfSellmeierJob(selectedGlass, wavelength)
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
      if (generation !== sellmeierGeneration.current) return
      const remote = await runRemoteJob(client, spec, { signal: controller.signal })
      if (generation !== sellmeierGeneration.current) return
      const moduleOutput = record(readModuleResult(remote, input), 'Sellmeier module result')
      const result = record(moduleOutput.result, 'Sellmeier material result')
      const n = result?.n
      const returnedWavelength = result?.lam_um
      if (typeof n !== 'number' || !Number.isFinite(n) || typeof returnedWavelength !== 'number' || !Number.isFinite(returnedWavelength) || returnedWavelength !== wavelength || result?.methodId !== 'method-algo-sellmeier-n-multi' || result?.familyId !== 'method-sellmeier') {
        throw new Error('Host result did not match the requested host Sellmeier multi-term material calculation.')
      }
      setSellmeierN(n)
      setSellmeierWavelength(returnedWavelength)
      setMessage('Native Sellmeier result received. / 已收到原生 Sellmeier 结果。')
    } catch (cause) {
      if (generation === sellmeierGeneration.current && !controller.signal.aborted) {
        const detail = cause instanceof Error ? cause.message : String(cause)
        setMessage(detail === 'The current native Sellmeier pin requires a wavelength above every Sellmeier pole'
          ? 'Released native pin preflight: every Sellmeier denominator must be positive (λ² > each C coefficient), so choose a wavelength above every Sellmeier pole. / 已发布的原生版本预检：每个 Sellmeier 分母都必须为正（λ² > 每个 C 系数），因此请选取高于所有 Sellmeier 极点的波长。'
          : detail)
      }
    } finally {
      if (sellmeierController.current === controller) sellmeierController.current = null
      if (generation === sellmeierGeneration.current) setSellmeierBusy(false)
    }
  }

  return <section className="space-y-3 rounded-lg border border-edge bg-surface/50 p-3" data-testid="agf-reference-glass-import">
    <h3 className="text-sm font-semibold text-slate-200">AGF reference glass / AGF 参考玻璃</h3>
    <label className="block text-sm text-slate-300">
      AGF file / AGF 文件
      <input data-testid="agf-glass-file" type="file" accept=".agf,.AGF,text/plain" onChange={event => void readFile(event)} className="mt-1 block w-full text-sm" />
    </label>
    <p className="text-xs text-muted">UTF-8/ASCII text only; unsupported encodings are rejected. / 仅支持 UTF-8/ASCII 文本；不支持的编码将被拒绝。</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm text-slate-300">
        Glass / 玻璃
        <select data-testid="agf-glass-selection" value={selectedGlass ? String(glassIndex) : ''} disabled={!glasses.length} onChange={event => { invalidateSellmeier(); setGlassIndex(Number(event.target.value)) }} className="mt-1 block w-full rounded border border-edge bg-surface px-2 py-1">
          {!glasses.length && <option value="">Load an AGF file / 请先加载 AGF 文件</option>}
          {glasses.map((glass, index) => <option key={`${glass.name}-${index}`} value={index}>{glass.name} · n(d) {glass.nd}</option>)}
        </select>
      </label>
      <label className="block text-sm text-slate-300">
        Apply to surface / 应用到表面
        <select data-testid="agf-glass-surface" value={String(selectedSurfaceIndex)} disabled={!surfaces.length} onChange={event => setSurfaceIndex(Number(event.target.value))} className="mt-1 block w-full rounded border border-edge bg-surface px-2 py-1">
          {surfaces.map((_, index) => <option key={index} value={index}>Surface {index + 1} / 表面 {index + 1}</option>)}
        </select>
      </label>
    </div>
    {selectedGlass && <dl data-testid="agf-glass-metadata" className="grid gap-x-4 gap-y-1 rounded border border-edge/70 p-3 text-xs sm:grid-cols-2">
      <div className="sm:col-span-2 font-medium text-slate-300">Selected NM fields and AGF source records / NM 字段与 AGF 源记录</div>
      <div><dt className="inline text-muted">Name / 名称: </dt><dd className="inline text-slate-300">{selectedGlass.name}</dd></div>
      <div><dt className="inline text-muted">Formula ID / 公式编号: </dt><dd className="inline text-slate-300">{selectedGlass.formulaId}</dd></div>
      <div><dt className="inline text-muted">N(d): </dt><dd className="inline text-slate-300">{selectedGlass.nd}</dd></div>
      <div><dt className="inline text-muted">V(d), metadata only / V(d)，仅元数据: </dt><dd className="inline text-slate-300">{selectedGlass.vd}</dd></div>
      <div><dt className="inline text-muted">MIL number / MIL 编号: </dt><dd className="inline text-slate-300">{selectedGlass.milNumber}</dd></div>
      <div><dt className="inline text-muted">Status / 状态: </dt><dd className="inline text-slate-300">{selectedGlass.status} ({selectedGlass.statusId})</dd></div>
      <div><dt className="inline text-muted">Substitution excluded / 排除替代: </dt><dd className="inline text-slate-300">{selectedGlass.excludeSubstitution ? 'Yes / 是' : 'No / 否'}</dd></div>
      {selectedGlass.meltFrequency !== undefined && <div><dt className="inline text-muted">Melt frequency / 熔次频率: </dt><dd className="inline text-slate-300">{selectedGlass.meltFrequency}</dd></div>}
      <div className="sm:col-span-2 text-muted">Formula ID, V(d), status, MIL number, substitution flag, and melt frequency are source metadata. Supported formula ID 2 Sellmeier coefficients are submitted to the native Host only when explicitly requested; no formula is evaluated in this browser. / 公式编号、V(d)、状态、MIL 编号、替代标记和熔次频率均为源元数据。仅在明确请求时才将受支持的公式编号 2 Sellmeier 系数提交到原生 Host；浏览器不会评估公式。</div>
      {retainedTagSummary && <div className="sm:col-span-2 text-muted">AGF source records retained verbatim in memory: {retainedTagSummary}. / 以下 AGF 源记录按原文暂存：{retainedTagSummary}。</div>}
    </dl>}
    <label className="block text-sm text-slate-300">
      Native Sellmeier wavelength (µm) / 原生 Sellmeier 波长 (µm)
      <input data-testid="agf-sellmeier-wavelength" type="number" min={sellmeierBounds?.minLambdaUm} max={sellmeierBounds?.maxLambdaUm} step="any" value={wavelengthUm} onChange={event => { invalidateSellmeier(); setWavelengthUm(event.target.value) }} className="mt-1 block w-full rounded border border-edge bg-surface px-2 py-1" />
    </label>
    {sellmeierBounds && <p className="text-xs text-muted">Allowed LD range: {sellmeierBounds.minLambdaUm}–{sellmeierBounds.maxLambdaUm} µm. / 有效 LD 范围：{sellmeierBounds.minLambdaUm}–{sellmeierBounds.maxLambdaUm} µm。</p>}
    <button data-testid="agf-sellmeier-compute" type="button" disabled={!selectedGlass || !sellmeierBounds || sellmeierBusy} onClick={() => void computeSellmeier()} className="rounded border border-edge px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
      {sellmeierBusy ? 'Computing native n(λ)… / 正在计算原生 n(λ)…' : 'Compute native Sellmeier n(λ) / 计算原生 Sellmeier n(λ)'}
    </button>
    {selectedGlass && !sellmeierBounds && <p className="text-xs text-muted">Native Sellmeier computation requires formula ID 2 with valid CD coefficients and LD limits. / 原生 Sellmeier 计算需要公式编号 2、有效 CD 系数和 LD 范围。</p>}
    {sellmeierN !== null && sellmeierWavelength !== null && selectedGlass && <div data-testid="agf-sellmeier-result" className="rounded border border-edge/70 p-3 text-sm text-slate-300">
      <p>Native result: n({sellmeierWavelength} µm) = {sellmeierN}. / 原生结果：n({sellmeierWavelength} µm) = {sellmeierN}。</p>
      <button data-testid="agf-sellmeier-apply" type="button" disabled={!surfaces.length || sellmeierN < 1 || sellmeierN > 3} onClick={() => onApply(selectedSurfaceIndex, selectedGlass, sellmeierN, sellmeierWavelength)} className="mt-2 rounded border border-edge px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
        Apply this n as a constant surface index / 将此 n 作为表面常数折射率应用
      </button>
      {(sellmeierN < 1 || sellmeierN > 3) && <p className="mt-2 text-xs leading-relaxed text-amber-300">The current lens study accepts surface indices from 1 to 3, so this result cannot be applied. / 当前透镜研究仅接受 1 到 3 之间的表面折射率，因此不能应用此结果。</p>}
      <p className="mt-2 text-xs leading-relaxed text-muted">One native material n(λ) result can be copied as a constant into the geometric ray trace; this does not preserve wavelength dependence. / 单个原生材料 n(λ) 结果可复制为几何光线追迹中的常数折射率；此操作不会保留波长依赖性。</p>
    </div>}
    <button data-testid="agf-glass-apply-dline" type="button" disabled={!selectedGlass || !surfaces.length} onClick={() => selectedGlass && onApply(selectedSurfaceIndex, selectedGlass)} className="rounded border border-edge px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
      Use n(d) on selected surface / 将 n(d) 应用到所选表面
    </button>
    <p className="text-xs leading-relaxed text-muted">
      Reference n(d) at 0.5875618 µm is mapped to a constant index for this surface. A native n(λ) sample is also copied as a constant; the geometric ray trace does not preserve wavelength dependence. / 将 0.5875618 µm 处的参考 n(d) 映射为该表面的常数折射率。原生 n(λ) 采样也会作为常数复制；几何光线追迹不会保留波长依赖性。
    </p>
    <p className="text-xs leading-relaxed text-muted">
      Scope: formula ID 2 with one valid CD coefficient set and LD interval supports a native single-wavelength material evaluation. Other formula IDs and AGF properties such as thermal, transmission, stress, melt, mechanical, substitution, and status data are not applied. Applying the returned index copies one scalar into the constant-index lens study; it does not create a dispersive ray trace. / 范围：公式编号 2 且具备有效 CD 系数和 LD 范围时，可在原生 Host 上计算单个波长的材料折射率。其他公式编号及热学、透射、应力、熔次、机械、替代和状态等 AGF 属性不会应用。应用计算结果会将单个标量复制到常数折射率透镜研究中；不会形成色散光线追迹。
    </p>
    {message && <p data-testid="agf-glass-status" role="status" className="text-xs text-slate-400">{message}</p>}
  </section>
}
