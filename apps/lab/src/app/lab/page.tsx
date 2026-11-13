'use client';

import { FlowPlayback } from '@/components/visualization/flow-playback';

import { oidcStartHref } from '../../../../../src/lib/hostApi';
import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Wind,
  Play,
  Square,
  RotateCcw,
  Settings,
  BarChart3,
  Box,
  Layers,
} from 'lucide-react';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { describeRunTimes, labExecutionHeadline, runClockStatus } from '@/lib/models/run-times';
import { createWindTunnelModel, useProjectStore } from '@/lib/stores/project-store';
import { GRID_PRESETS, maxPhysicalReynolds } from '@w-sim/solvers-lbm/d3q19';
import { ModelUploader } from '@/components/upload/model-uploader';
import { ModelAssembly } from '@/components/upload/model-assembly';
import type { ModelGeometry } from '@/types/model';
import { WindTunnelCanvas } from '@/components/visualization/wind-tunnel-canvas';
import { ParameterPanel } from '@/components/panels/parameter-panel';
import { ResultsPanel } from '@/components/panels/results-panel';
import { VisualizationPanel } from '@/components/panels/visualization-panel';
import { useSimulationExecution } from '@/hooks/use-simulation-execution';
import { useProjectPersistence } from '@/hooks/use-project-persistence';
import { loadPresetModel, PRESET_MODELS } from '@/lib/models/preset-models';
import { ModelPreviewBoundary } from '@/components/visualization/model-preview-boundary';
import { SimCanvasBoundary } from '@/components/visualization/sim-canvas-boundary';
import {
  buildClientDiagnosticReport,
  recordLabLocalEvent,
} from '@/lib/lab-diagnostics';

// three.js 不支持 SSR，仅在客户端加载
const ModelPreview = dynamic(
  () => import('@/components/visualization/model-preview').then((m) => m.ModelPreview),
  { ssr: false }
);

function LabPageContent() {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get('demo') === 'true';
  const embedded = searchParams.get('embedded') === '1';
  const workspace = useRef<HTMLDivElement>(null);

  const { gpuContext, state, results, parameters, derived, updateParameters, setState, setGPUContext } = useSimulationStore();
  const mac = parameters.flowMethod === 'mac';
  const { currentProject, activeModel, uploadedModels, setActiveModel, addUploadedModel } = useProjectStore();
  const uploaded = uploadedModels.find(model => model.metadata.id === activeModel?.id);
  const [selection, setSelection] = useState<{ geometry: ModelGeometry; id: string } | null>(null);
  const [view, setView] = useState<'model' | 'flow'>('flow');
  // Release the previous model's large arrays as soon as the active import changes.
  if (selection && selection.geometry !== uploaded?.geometry) setSelection(null);
  const selectedPartId = selection?.geometry === uploaded?.geometry ? selection?.id ?? null : null;
  const selectPart = (id: string | null) => {
    setSelection(id && uploaded ? { geometry: uploaded.geometry, id } : null);
    setView('model');
  };
  const showFlow = !!results.flowSnapshot && view === 'flow';
  const execution = useSimulationExecution();
  const persistence = useProjectPersistence();
  // LBM 默认走 WebGPU（浏览器 GPU 内核比 WASM CPU 快一个数量级以上）；
  // 不支持或 MAC 方法时保持 CPU；用户可随时在「计算设备」里切回。
  const gpuDefaulted = useRef(false);
  useEffect(() => {
    if (!gpuDefaulted.current && execution.gpu.isSupported && parameters.flowMethod !== 'mac') {
      gpuDefaulted.current = true;
      void execution.setBackend('webgpu');
    }
  }, [execution, parameters.flowMethod]);
  useEffect(() => {
    if (!persistence.ready || !embedded || !workspace.current || window.parent === window) return;
    // Observe after project restoration has mounted the actual workspace.
    let parentOrigin: string;
    try { parentOrigin = new URL(document.referrer).origin; } catch { return; }
    const report = () => window.parent.postMessage({
      type: 'waveworld:workspace-ready', height: workspace.current?.scrollHeight,
    }, parentOrigin);
    const observer = new ResizeObserver(report);
    observer.observe(workspace.current);
    report();
    return () => observer.disconnect();
  }, [embedded, persistence.ready]);
  const { isSupported, isInitialized, errorMessage } = execution.gpu;
  const localCompute = execution.target === 'browser';
  
  const [activeTab, setActiveTab] = useState('model');
  const [sidebar, setSidebar] = useState(true);
  const simLocalError = gpuContext.errorMessage || errorMessage;

  useEffect(() => {
    if (simLocalError) {
      recordLabLocalEvent('local_error', simLocalError);
    }
  }, [simLocalError]);

  const copyClientDiagnosticReport = async () => {
    const report = buildClientDiagnosticReport({
      activeModelId: activeModel?.id ?? null,
      activeModelName: activeModel?.name ?? null,
      webgpuSupported: isSupported,
      webgpuInitialized: isInitialized,
      gpuError: simLocalError,
      isRunning: state.isRunning,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      href: typeof window !== 'undefined' ? window.location.href : undefined,
      language: typeof navigator !== 'undefined' ? navigator.language : undefined,
    });
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      // Clipboard may be denied; still no throw — report is in console for power users.
      console.info(report);
    }
  };

  useEffect(() => {
    if (activeModel || !persistence.ready || persistence.error) return;
    const preset = PRESET_MODELS.find((p) => p.id === 'cylinder') ?? PRESET_MODELS[0];
    if (!preset) return;
    let cancelled = false;
    void loadPresetModel(preset)
      .then(({ metadata, geometry }) => {
        if (cancelled) return;
        addUploadedModel({ metadata, geometry });
        setActiveModel(createWindTunnelModel(metadata));
        const dp = preset.defaultParameters;
        if (dp) {
          updateParameters({
            ...(dp.angleOfAttack !== undefined ? { angleOfAttack: dp.angleOfAttack } : {}),
            ...(dp.inletVelocity !== undefined ? { inletVelocity: dp.inletVelocity } : {}),
            ...(dp.modelResolution !== undefined ? { modelResolution: dp.modelResolution } : {}),
          });
        }
      })
      .catch(() => {
        /* stay empty — user can pick a preset */
      });
    return () => {
      cancelled = true;
    };
  }, [activeModel, setActiveModel, addUploadedModel, updateParameters, persistence.ready, persistence.error]);

  const handleStart = () => { setView('flow'); void execution.start(); };
  const handleLocalSimRecover = () => {
    void execution.reset();
    setGPUContext({ errorMessage: null });
  };

  if (!persistence.ready) return <div role="status" className="p-6 text-sm text-zinc-400">正在恢复项目…</div>;

  return (
    <div ref={workspace} className={`lab-workspace flex flex-col bg-zinc-950 ${embedded ? 'lg:h-dvh' : 'min-h-dvh lg:h-dvh'}`}>
      {/* Header */}
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm z-50">
        <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              {!embedded && <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <Wind className="w-5 h-5 text-white" />
              </div>}
              <div>
                {!embedded && <h1 className="text-lg font-semibold text-white">
                  三维风洞
                </h1>}
                <p className="text-sm text-zinc-400">
                  {activeModel ? `当前模型：${activeModel.name}` : '先选择或导入模型'}{isDemo ? ' · 示例' : ''}
                  {currentProject?.name && currentProject.name !== '未命名项目' && <span className="ml-2">· {currentProject.name}</span>}
                </p>
                <p role="status" className={`text-xs ${persistence.error ? 'text-amber-300' : 'text-zinc-500'}`}>
                  {persistence.error ?? (!persistence.ready ? '正在恢复项目…' : persistence.savedAt ? '项目已保存到此浏览器' : '更改将自动保存到此浏览器')}
                  {persistence.ready && activeModel && <button className="ml-2 underline" onClick={() => void persistence.saveCurrentProject()}>保存项目</button>}
                </p>
              </div>
            </div>
            
          </div>

          <span className="hidden text-xs text-zinc-500 sm:inline" aria-label="当前计算位置与设备">
            {execution.target === 'backend' ? '后端计算' : `本机 · ${execution.backend === 'webgpu' ? 'GPU FP32' : 'CPU'}`}
          </span>

          {/* Simulation Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {!state.isRunning && !(execution.status === 'failed' && execution.jobId) ? (
              <Button
                onClick={handleStart}
                disabled={!activeModel}
                className="bg-cyan-300 hover:bg-cyan-200 text-zinc-950"
              >
                <Play className="w-4 h-4" />
                {localCompute ? '开始计算' : '发布计算任务'}
              </Button>
            ) : (
              <Button
                onClick={() => void execution.stop().catch(() => {})}
                variant="outline"
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                <Square className="w-4 h-4" />
                {localCompute ? '停止计算' : '停止任务'}
              </Button>
            )}

            <details className="relative shrink-0 text-sm text-zinc-400">
              <summary aria-label="更多操作" className="min-h-11 min-w-11 cursor-pointer whitespace-nowrap py-3">更多</summary>
              <div className="absolute right-0 top-full z-50 max-h-[60dvh] w-[min(90vw,24rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-xl space-y-2"
                onClick={(event) => { if ((event.target as HTMLElement).closest('button,a')) event.currentTarget.parentElement?.removeAttribute('open'); }}>
                {!embedded && <a href="/cooling" target="_top" className="block rounded-md px-2 py-2 text-sm text-zinc-200 hover:bg-zinc-800 sm:hidden">散热解算</a>}
                {!embedded && <a href="/batch-jobs" target="_top" className="block rounded-md px-2 py-2 text-sm text-zinc-200 hover:bg-zinc-800 sm:hidden">计算任务</a>}
                {localCompute && !state.isRunning && (
                  <Button variant="outline" className="w-full" disabled={!activeModel} onClick={() => void execution.start(true)}>发布计算任务（需登录）</Button>
                )}
                <Button
                  onClick={() => void execution.reset()}
                  variant="outline"
                  className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  <RotateCcw className="w-4 h-4" />
                  重置模块
                </Button>
                <Button type="button" variant="outline" className="w-full" data-lab-copy-diagnostic-report onClick={() => void copyClientDiagnosticReport()}>复制诊断报告</Button>
                <p className="border-t border-zinc-800 pt-2 text-xs">{mac ? 'MAC 后端与浏览器 WASM 使用同一 FP64 Rust 内核；保存的可视化场为 FP32，直接记录 m/s、Pa 和 °C。风扇曲线驱动层流和热输运，支持多材料、功率热源与接触热阻。当前不提供气动力、湍流或热浮力；任务完成后显示速度、压力和温度。' : 'CPU 后端与浏览器 WASM 使用同一 Rust 内核，场数据为 FP32，核心运算与统计使用 FP64；可选 WebGPU 路径为 FP32。温度模式支持空气传热、浮力、恒温表面、固体导热与功率热源，可设置多材料及接触热阻。当前为简化网格模型，尚不能替代经过工程验证的整机散热分析。任务完成后显示流场与气动力曲线。'}</p>
              </div>
            </details>
          </div>
        </div>
      </header>

      <nav className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1 text-sm" aria-label="工作台导航">
        {!embedded && <a href="/d/sim" target="_top" className="inline-flex min-h-11 items-center px-2 text-cyan-300 hover:underline">← 仿真与计算</a>}
        <a href="#flow-view" className="inline-flex min-h-11 items-center px-2 text-zinc-200 lg:hidden">画布</a>
        <a href="#model-inputs" className="inline-flex min-h-11 items-center px-2 text-zinc-200 lg:hidden">面板</a>
        {!embedded && <a href="/cooling" target="_top" className="hidden min-h-11 items-center px-2 text-zinc-300 hover:underline sm:ml-auto sm:inline-flex">散热解算</a>}
        {!embedded && <a href="/batch-jobs" target="_top" className="hidden min-h-11 items-center px-2 text-zinc-300 hover:underline sm:inline-flex">计算任务</a>}
        <Button size="sm" variant="ghost" className="hidden lg:inline-flex" aria-expanded={sidebar} aria-controls="model-inputs" onClick={() => setSidebar(!sidebar)}>{sidebar ? '收起侧栏' : '显示侧栏'}</Button>
      </nav>
      {/* Main Content */}
      <div className={`grid min-h-0 flex-1 grid-cols-1 lg:overflow-hidden ${sidebar ? 'lg:grid-cols-[320px_minmax(0,1fr)]' : 'lg:grid-cols-1'}`}>
        {/* Left Panel - Parameters */}
        <section id="model-inputs" aria-label="模型与计算输入" className={`order-2 flex min-h-0 min-w-0 flex-col border-b border-zinc-800 bg-zinc-950 lg:order-1 lg:col-start-1 lg:row-start-1 lg:border-b-0 lg:border-r ${sidebar ? 'lg:flex' : 'lg:hidden'}`}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 flex flex-col">
            <div className="border-b border-zinc-800 px-2 py-2">
              <TabsList className="w-full bg-zinc-900 grid grid-cols-4">
                <TabsTrigger value="model" className="text-sm"><Box className="w-4 h-4 mr-1" />模型</TabsTrigger>
                <TabsTrigger value="parameters" className="text-sm"><Settings className="w-4 h-4 mr-1" />参数</TabsTrigger>
                <TabsTrigger value="visualization" className="text-sm"><Layers className="w-4 h-4 mr-1" />显示</TabsTrigger>
                <TabsTrigger value="results" className="text-sm"><BarChart3 className="w-4 h-4 mr-1" />结果</TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="parameters" className="m-0 p-4 space-y-4">
                <fieldset disabled={state.isRunning} className="space-y-3">
                  <h3 className="text-sm font-medium text-white">计算后端</h3>
                  <div role="group" aria-label="计算位置" className="flex gap-1 rounded-lg border border-zinc-700 p-1">
                    {([['browser', '本机计算'], ['backend', '后端计算']] as const).map(([target, label]) => (
                      <Button key={target} size="sm" variant={execution.target === target ? 'default' : 'ghost'}
                        className={`flex-1 ${execution.target === target ? 'bg-cyan-300/15 text-cyan-200 hover:bg-cyan-300/20' : 'text-zinc-300'}`}
                        aria-pressed={execution.target === target}
                        onClick={() => void execution.setTarget(target)}>{label}</Button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    计算设备
                    <select aria-label="计算设备" value={execution.backend}
                      onChange={event => { if (event.target.value === 'cpu' || event.target.value === 'webgpu') void execution.setBackend(event.target.value); }}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200 disabled:opacity-50">
                      <option value="cpu">{mac ? 'CPU / WASM · FP64' : 'CPU · 混合精度'}</option>
                      <option value="webgpu" disabled={mac || (localCompute && !execution.gpu.isSupported)}>GPU · FP32</option>
                    </select>
                  </label>
                </fieldset>
                <fieldset disabled={!localCompute && state.isRunning}><ParameterPanel /></fieldset>
              </TabsContent>

              <TabsContent value="model" className="m-0 p-4">
                {uploaded?.geometry.sourceParts?.length && <div className="mb-4"><ModelAssembly key={uploaded.metadata.id}
                  geometry={uploaded.geometry} selectedId={selectedPartId} onSelect={selectPart} /></div>}
                <fieldset disabled={!localCompute && state.isRunning}><ModelUploader /></fieldset>
              </TabsContent>
              
              <TabsContent value="visualization" className="m-0 p-4">
                <VisualizationPanel />
              </TabsContent>

              <TabsContent value="results" className="m-0 p-4">
                <ResultsPanel />
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </section>

        {/* Center - 3D Canvas (local boundaries only; never whole-app error page) */}
        <section id="flow-view" aria-label="三维流场画布" className={`relative order-1 grid min-h-[480px] min-w-0 grid-rows-[minmax(220px,1fr)_auto] bg-zinc-900 lg:order-2 lg:row-start-1 lg:min-h-0 ${sidebar ? 'lg:col-start-2' : 'lg:col-start-1'}`}>
          <div className="relative min-h-0">
          <SimCanvasBoundary
            resetKey={`${activeModel?.id ?? 'none'}-${state.resetCount}`}
            onReset={handleLocalSimRecover}
          >
            <WindTunnelCanvas />
          </SimCanvasBoundary>

          {/* Keep the result canvas mounted while inspecting the original assembly. */}
          {!showFlow && (
            <div className="absolute inset-0">
              <ModelPreviewBoundary resetKey={activeModel?.id ?? 'none'} onUnload={() => setActiveModel(null)}>
                <ModelPreview key={activeModel?.id} selectedPartId={selectedPartId} onSelectPart={selectPart} />
              </ModelPreviewBoundary>
            </div>
          )}

          </div>
          <div className="z-20 border-t border-zinc-700 bg-zinc-950/90 px-3 py-2 text-sm text-zinc-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>{labExecutionHeadline(execution.status, execution.status === 'running' ? describeRunTimes({
                  dt: derived?.dt || (state.currentIteration > 0 ? state.currentTime / state.currentIteration : 0),
                  targetSeconds: parameters.durationSeconds ?? 10,
                  completedSteps: state.currentIteration,
                  status: 'running',
                }) : results.flowSnapshot ? describeRunTimes({
                  dt: results.job?.result.derived?.dt ?? derived?.dt ?? 0,
                  targetSeconds: parameters.durationSeconds ?? 10,
                  frameStep: results.flowFrames[state.playbackIndex < 0 ? results.flowFrames.length - 1 : state.playbackIndex]?.step
                    ?? results.flowSnapshot.step,
                  completedSteps: results.job?.result.summary.steps ?? results.flowSnapshot.step,
                  requestedSteps: results.job?.spec.run.maxSteps,
                  status: runClockStatus(execution.status),
                }) : null)}</p>
                {results.flowSnapshot && <div role="group" aria-label="画布内容" className="flex gap-1 rounded-lg border border-zinc-700 p-1">
                  <Button size="sm" variant="ghost" aria-pressed={!showFlow} onClick={() => setView('model')}
                    className={!showFlow ? 'bg-cyan-300/15 text-cyan-200 hover:bg-cyan-300/20' : 'text-zinc-300'}>模型视图</Button>
                  <Button size="sm" variant="ghost" aria-pressed={showFlow} onClick={() => setView('flow')}
                    className={showFlow ? 'bg-cyan-300/15 text-cyan-200 hover:bg-cyan-300/20' : 'text-zinc-300'}>计算结果</Button>
                </div>}
              </div>
              {localCompute && !results.flowSnapshot && (
                <details className="mt-1 text-xs text-zinc-500">
                  <summary className="cursor-pointer">使用说明</summary>
                  <p className="mt-1">本机计算免登录，模型和结果保留在此设备。计算期间请保持页面打开，可随时停止；发布任务需登录。</p>
                </details>
              )}
              <p className="mt-1 text-xs text-zinc-400">{results.flowSnapshot && !showFlow ? '正在查看源模型；已保存的计算结果与回放保持不变。' : results.flowSnapshot
                ? `显示第 ${results.flowFrames[state.playbackIndex]?.step ?? results.flowSnapshot.step} 步${state.playbackIndex >= 0 ? '回放' : '最终'}流场；${mac ? '速度、压力和热量见结果面板。' : state.dragCoefficient === null ? '作用力见结果面板。' : '气动力曲线见结果分析。'}${!gpuContext.device || gpuContext.errorMessage ? '二维剖面可切换平面和位置。' : '三维流场可旋转、缩放和剖切。'}`
                : mac ? '计算完成后显示实际速度、压力与温度；达到指定步数不代表已稳定。' : parameters.thermalEnabled ? '计算完成后显示流场、温度和作用力；达到指定步数不代表散热已稳定。' : '计算完成后显示最终流场和气动力曲线。'}</p>
              {showFlow && gpuContext.errorMessage && <p className="mt-1 text-xs text-amber-300">三维显示不可用，已显示二维剖面。
                <button className="ml-2 underline" onClick={() => {
                  if (gpuContext.device) setState({ resetCount: state.resetCount + 1 });
                  else void execution.gpu.initialize();
                }}>重试显示</button>
              </p>}
              {showFlow && <FlowPlayback />}
              {execution.jobId && <a className="mt-1 inline-block text-xs text-cyan-400 underline" href={`/batch-jobs?job=${encodeURIComponent(execution.jobId)}`} target="_blank" rel="noreferrer">查看任务与结果</a>}
              {execution.error && <p className="mt-2 text-red-400" role="alert">{execution.error.includes('thermal dtSeconds/grid/viscosity') && '热计算参数与网格不匹配。请按以下范围调整时间步；若没有可用范围，需加密网格或修改模型尺寸、温差或流速。'}{execution.error}{execution.loginRequired && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)} target="_top">登录</a>}</p>}
              {execution.error?.includes('physical LBM requires tau') && !state.isRunning && (() => {
                // 物理模式恢复：选设备能承载的最密网格 + 提高格子速度到 0.10
                // （内核在 |u|≥0.2 判发散停机，翼面吸力峰值约 2×来流，须留余量）
                // + 把来流速度降到该网格可承载的雷诺数。黏度保持真实值，Re 相应下降。
                const bindLimit = gpuContext.device
                  ? Math.min(gpuContext.device.limits.maxStorageBufferBindingSize, gpuContext.device.limits.maxBufferSize)
                  : 0;
                const ultra = GRID_PRESETS.find((p) => p.id === 'ultra')!;
                const fine = GRID_PRESETS.find((p) => p.id === 'fine')!;
                const retryPreset = gpuContext.device
                  ? (bindLimit >= ultra.nx * ultra.ny * ultra.nz * 19 * 4 ? ultra : bindLimit >= fine.nx * fine.ny * fine.nz * 19 * 4 ? fine : GRID_PRESETS[0])
                  : GRID_PRESETS[0]; // CPU/WASM 回退：内存受限，用最小网格保可运行
                const cells = Math.max(8, Math.round(retryPreset.nx / 3)); // modelResolution 'high'
                const uLat = 0.1;
                const reMax = maxPhysicalReynolds(cells, uLat) * 0.85;
                const nu = parameters.fluidViscosity / parameters.fluidDensity;
                const length = activeModel?.referenceLength ?? activeModel?.sourceModel.boundingBox.size[0] ?? 1;
                const uMax = Math.max(0.001, (reMax * nu) / length);
                return (
                  <div className="mt-1 flex flex-col gap-1">
                    <button type="button" className="self-start text-xs text-cyan-400 underline" onClick={() => {
                      updateParameters({ gridPreset: retryPreset.id, modelResolution: 'high', latticeVelocity: uLat, inletVelocity: uMax });
                      void execution.start();
                    }}>物理模式重算：{retryPreset.id === 'ultra' ? '切换超大网格 · ' : ''}降风速至 {uMax.toPrecision(2)} m/s（真实黏度，Re≈{Math.round(reMax)}）</button>
                    <button type="button" className="self-start text-xs text-cyan-400 underline" onClick={() => {
                      updateParameters({ viscosityMode: 'stabilized-preview' });
                      void execution.start();
                    }}>改用流动演示模式重算（提高模拟黏度，非真实雷诺数）</button>
                  </div>
                );
              })()}
          </div>

        </section>
      </div>
    </div>
  );
}

export default function LabPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-white">加载中...</div>
      </div>
    }>
      <LabPageContent />
    </Suspense>
  );
}
