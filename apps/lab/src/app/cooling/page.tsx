'use client';

// 散热解算页：机箱/笔记本/手机/平板的设备级热管理。
// 底层完全复用风洞实验室的 D3Q19 共轭换热求解链（固体导热 + 空气对流 + 浮力 +
// 恒压风扇盘 + 分区功率热源 + 接触热阻），本页只做散热视角的预设与参数面板。

import { useRef, useState, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Fan, Play, Square, RotateCcw, Thermometer, Wind } from 'lucide-react';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { createWindTunnelModel, useProjectStore } from '@/lib/stores/project-store';
import { WindTunnelCanvas } from '@/components/visualization/wind-tunnel-canvas';
import { useSimulationExecution } from '@/hooks/use-simulation-execution';
import { useProjectPersistence } from '@/hooks/use-project-persistence';
import { loadPresetModel, PRESET_MODELS } from '@/lib/models/preset-models';
import { SimCanvasBoundary } from '@/components/visualization/sim-canvas-boundary';
import { ModelPreviewBoundary } from '@/components/visualization/model-preview-boundary';
import type { PresetModel } from '@/types/model';

const ModelPreview = dynamic(
  () => import('@/components/visualization/model-preview').then((m) => m.ModelPreview),
  { ssr: false }
);

// 散热设备预设：均为程序化几何或随附 STL，分区功率/材料/风扇由预设参数提供。
const COOLING_PRESET_IDS = [
  'server-thermal',
  'desktop-thermal',
  'laptop-thermal',
  'heatsink',
  'phone-thermal',
  'tablet-thermal',
] as const;

const COOLING_PRESETS = COOLING_PRESET_IDS
  .map((id) => PRESET_MODELS.find((p) => p.id === id))
  .filter((p): p is PresetModel => !!p);

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  if (name === 'AbortError') return true;
  return (err as { code?: number | string }).code === 20 || (err as { code?: number | string }).code === 'ABORT_ERR';
}

function CoolingPageContent() {
  const { state, results, parameters, setVisualizationMode, updateParameters, stopSimulation, resetSimulation, setGPUContext } = useSimulationStore();
  const { activeModel, setActiveModel, addUploadedModel } = useProjectStore();
  const execution = useSimulationExecution();
  const persistence = useProjectPersistence();
  const [loading, setLoading] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'warning' | 'error'; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadGenRef = useRef(0);

  const thermal = results.job?.result.thermal ?? results.thermal;
  const running = state.isRunning;

  // 散热解算默认走 WebGPU：浏览器 GPU 内核比 WASM CPU 快一个数量级以上。
  // 不支持时保持 CPU 混合精度回退；用户可手动切回。
  const gpuDefaulted = useRef(false);
  useEffect(() => {
    if (!gpuDefaulted.current && execution.gpu.isSupported) {
      gpuDefaulted.current = true;
      void execution.setBackend('webgpu');
    }
  }, [execution]);

  const selectDevice = async (preset: PresetModel) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++loadGenRef.current;
    try {
      setLoading(preset.id);
      setNotice(null);
      stopSimulation();
      resetSimulation();
      setGPUContext({ errorMessage: null });
      const { metadata, geometry, warning } = await loadPresetModel(preset, { signal: ac.signal });
      if (gen !== loadGenRef.current || ac.signal.aborted) return;
      addUploadedModel({ metadata, geometry });
      const { referenceArea: _a, referenceLength: _l, ...dp } = preset.defaultParameters;
      updateParameters({
        ...dp,
        angleOfAttack: dp.angleOfAttack ?? 0,
        thermalEnabled: true,
        thermalMode: dp.thermalMode ?? 'solid-power',
        inletVelocity: dp.inletVelocity ?? 0,
        viscosityMode: 'physical',
        modelResolution: dp.modelResolution ?? 'standard',
        gridPreset: dp.gridPreset ?? 'fast',
        durationSeconds: 10,
        fan: dp.fan ?? null,
        flowMethod: 'lbm',
        macFans: [],
        thermalRegions: dp.thermalRegions ?? [],
        thermalContacts: dp.thermalContacts ?? [],
      });
      setVisualizationMode('temperature');
      setActiveModel(createWindTunnelModel(metadata));
      if (warning) setNotice({ kind: 'warning', text: `模型文件加载失败，已使用程序化几何：${warning}` });
      setLoading(null);
    } catch (error) {
      if (isAbortError(error) || gen !== loadGenRef.current) {
        if (gen === loadGenRef.current) setLoading(null);
        return;
      }
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      setLoading(null);
    }
  };

  const setRegionPower = (index: number, watts: number) => {
    const regions = parameters.thermalRegions.map((r, i) => (i === index ? { ...r, totalPowerW: watts } : r));
    updateParameters({ thermalRegions: regions });
  };

  const setFanPressure = (pa: number) => {
    if (!parameters.fan) return;
    updateParameters({ fan: { ...parameters.fan, pressureRisePa: pa } });
  };

  if (!persistence.ready) return <div role="status" className="p-6 text-sm text-zinc-400">正在恢复项目…</div>;

  const totalPower = parameters.thermalRegions.reduce((s, r) => s + r.totalPowerW, 0) + (parameters.thermalRegions.length ? 0 : parameters.totalPowerW);

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950">
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/95 px-3 py-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-600">
              <Thermometer className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">散热解算</h1>
              <p className="text-sm text-zinc-400">
                {activeModel ? `当前设备：${activeModel.name}` : '选择设备类型开始'} · 三维共轭换热（固体导热 + 空气对流 + 浮力）
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-xs text-zinc-500 sm:inline" aria-label="当前计算设备">
              {execution.backend === 'webgpu' ? 'GPU · FP32' : 'CPU · 混合精度'}
            </span>
            {!running ? (
              <Button onClick={() => void execution.start()} disabled={!activeModel} className="bg-orange-400 text-zinc-950 hover:bg-orange-300">
                <Play className="h-4 w-4" />开始计算
              </Button>
            ) : (
              <Button onClick={() => void execution.stop().catch(() => {})} variant="outline" className="border-zinc-700 text-zinc-300">
                <Square className="h-4 w-4" />停止计算
              </Button>
            )}
            <details className="relative shrink-0 text-sm text-zinc-400">
              <summary aria-label="更多操作" className="min-h-11 min-w-11 cursor-pointer whitespace-nowrap py-3">更多</summary>
              <div className="absolute right-0 top-full z-50 w-56 rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
                <Button onClick={() => void execution.reset()} variant="outline" className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                  <RotateCcw className="h-4 w-4" />重置模块
                </Button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <nav className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1 text-sm">
        <a href="/lab" className="inline-flex min-h-11 items-center px-2 text-cyan-300 hover:underline">← 三维风洞</a>
        <span className="text-zinc-500">设备散热 · 风扇风路 · 分区功耗</span>
      </nav>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section aria-label="散热输入" className="order-2 flex min-h-0 flex-col border-t border-zinc-800 lg:order-1 lg:border-r lg:border-t-0">
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-4">
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                计算设备
                <select aria-label="计算设备" value={execution.backend} disabled={running}
                  onChange={(e) => { if (e.target.value === 'cpu' || e.target.value === 'webgpu') void execution.setBackend(e.target.value); }}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200 disabled:opacity-50">
                  <option value="webgpu" disabled={!execution.gpu.isSupported}>GPU · FP32</option>
                  <option value="cpu">CPU · 混合精度</option>
                </select>
              </label>
              <div>
                <h2 className="mb-2 text-sm font-semibold text-white">设备类型</h2>
                <div className="grid grid-cols-2 gap-2">
                  {COOLING_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      variant="outline"
                      disabled={running || loading !== null}
                      onClick={() => void selectDevice(preset)}
                      className={`h-auto flex-col items-start gap-1 whitespace-normal border-zinc-700 px-3 py-2 text-left ${activeModel?.id === preset.id ? 'border-orange-500 bg-orange-500/10 text-orange-200' : 'text-zinc-200'}`}
                    >
                      <span className="text-sm font-medium">{preset.name}</span>
                    </Button>
                  ))}
                </div>
                {loading && <p className="mt-2 text-xs text-zinc-400">正在加载模型…</p>}
                {notice && <p role="alert" className={`mt-2 text-xs ${notice.kind === 'error' ? 'text-red-400' : 'text-amber-300'}`}>{notice.text}</p>}
                {activeModel && <p className="mt-2 text-xs text-zinc-500">{PRESET_MODELS.find((p) => p.id === activeModel.id)?.description}</p>}
              </div>

              <div>
                <h2 className="mb-2 text-sm font-semibold text-white">器件功耗</h2>
                {parameters.thermalRegions.length === 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>整体功率</span>
                      <span className="font-mono text-white">{parameters.totalPowerW.toFixed(0)} W</span>
                    </div>
                    <Slider value={[parameters.totalPowerW]} onValueChange={(v) => updateParameters({ totalPowerW: Array.isArray(v) ? v[0] : v })}
                      min={0} max={200} step={1} aria-label="整体功率" />
                  </div>
                ) : (
                  parameters.thermalRegions.map((region, i) => (
                    <div key={region.name} className="mb-3 space-y-1">
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>{region.name}</span>
                        <span className="font-mono text-white">{region.totalPowerW.toFixed(0)} W</span>
                      </div>
                      <Slider value={[region.totalPowerW]} onValueChange={(v) => setRegionPower(i, Array.isArray(v) ? v[0] : v)}
                        min={0} max={300} step={1} aria-label={`${region.name} 功率`} />
                    </div>
                  ))
                )}
                <p className="text-xs text-zinc-500">总发热 {totalPower.toFixed(0)} W</p>
              </div>

              {parameters.fan && (
                <div>
                  <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-white"><Fan className="h-4 w-4" />风扇压升</h2>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>恒压盘 Δp</span>
                    <span className="font-mono text-white">{(parameters.fan.pressureRisePa * 1000).toFixed(1)} mPa</span>
                  </div>
                  <Slider value={[parameters.fan.pressureRisePa * 1000]} onValueChange={(v) => setFanPressure((Array.isArray(v) ? v[0] : v) / 1000)}
                    min={0.5} max={50} step={0.5} aria-label="风扇压升" />
                  <p className="mt-1 text-xs text-zinc-500">格子速度上限约束可解析风速；演示量级，非真实风扇曲线</p>
                </div>
              )}

              <div>
                <h2 className="mb-2 text-sm font-semibold text-white">环境与时长</h2>
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>环境温度</span>
                  <span className="font-mono text-white">{parameters.ambientTemp.toFixed(0)} °C</span>
                </div>
                <Slider value={[parameters.ambientTemp]} onValueChange={(v) => updateParameters({ ambientTemp: Array.isArray(v) ? v[0] : v })}
                  min={0} max={45} step={1} aria-label="环境温度" />
                <div className="mt-3 flex items-center justify-between text-xs text-zinc-400">
                  <span>计算时长</span>
                  <span className="font-mono text-white">{(parameters.durationSeconds ?? 10).toFixed(0)} s</span>
                </div>
                <Slider value={[parameters.durationSeconds ?? 10]} onValueChange={(v) => updateParameters({ durationSeconds: Array.isArray(v) ? v[0] : v })}
                  min={5} max={120} step={5} aria-label="计算时长" />
              </div>
            </div>
          </ScrollArea>
        </section>

        <section aria-label="温度场画布" className="relative order-1 grid min-h-[480px] grid-rows-[minmax(220px,1fr)_auto] bg-zinc-900 lg:order-2 lg:min-h-0">
          <div className="relative min-h-0">
            <SimCanvasBoundary resetKey={`${activeModel?.id ?? 'none'}-${state.resetCount}`} onReset={() => void execution.reset()}>
              <WindTunnelCanvas />
            </SimCanvasBoundary>
            {!results.flowSnapshot && (
              <div className="absolute inset-0">
                <ModelPreviewBoundary resetKey={activeModel?.id ?? 'none'} onUnload={() => setActiveModel(null)}>
                  <ModelPreview key={activeModel?.id} />
                </ModelPreviewBoundary>
              </div>
            )}
          </div>

          <div className="z-20 border-t border-zinc-700 bg-zinc-950/90 px-3 py-2 text-sm text-zinc-300">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>步数 {results.job?.result.summary.steps ?? state.currentIteration}</span>
              <span>固体最高 {thermal ? `${thermal.solidMaxC.toFixed(1)} °C` : '—'}</span>
              <span>流体最高 {thermal ? `${thermal.fluidMaxC.toFixed(1)} °C` : '—'}</span>
              <span>热源注入 {thermal ? `${thermal.sourceEnergyJ.toFixed(1)} J` : '—'}</span>
              <span>边界流出 {thermal ? `${thermal.boundaryEnergyJ.toFixed(1)} J` : '—'}</span>
              <span>能量残差 {thermal ? `${thermal.energyResidualJ.toExponential(2)} J` : '—'}</span>
              {results.job && <span>耗时 {(results.job.result.summary.wallTimeMs / 1000).toFixed(1)} s</span>}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {running ? '计算中：显示实时流场与温度。' : results.flowSnapshot ? '达到指定步数不代表已热稳态；继续延长计算时长以观察温度爬升。' : '选择设备类型后点击开始计算。'}
            </p>
            {execution.error && <p className="mt-1 text-xs text-red-400" role="alert">{execution.error}</p>}
          </div>
        </section>
      </div>

      <footer className="shrink-0 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
        <Wind className="mr-1 inline h-3 w-3" />
        物理：不可压层流 LBM（Smagorinsky 可选）+ Boussinesq 浮力 + 分区固体导热/功率热源/接触热阻 + 恒压风扇盘。
        未包含：湍流模型标定、辐射换热、真实风扇 P-Q 曲线、3D 精细网格。结果为演示量级趋势，不能替代 Icepak/FloTHERM 级工程签核。
      </footer>
    </div>
  );
}

export default function CoolingPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-zinc-950"><div className="text-white">加载中...</div></div>}>
      <CoolingPageContent />
    </Suspense>
  );
}
