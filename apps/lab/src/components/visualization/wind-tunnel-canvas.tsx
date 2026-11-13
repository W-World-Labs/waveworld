'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { VolumeRenderer, flowDisplayScale, type CameraState, type ViewOptions, type FlowValueRanges, type FlowRenderMode } from '@/lib/cfd/volume-renderer';
import { useWebGPU } from '@/hooks/use-webgpu';
import { flowSpeedReference, flowHasTemperature, flowPressureOffset, summarizeFlowSnapshot } from '@/lib/cfd/flow-snapshot';
import { summarizeMacFlowSnapshot } from '@/lib/cfd/mac-flow-snapshot';
import type { SimulationResults, SimulationState } from '@/types/simulation';

function renderMode(mode: SimulationState['visualizationMode']): FlowRenderMode {
  return mode === 'pressure' ? 3 : mode === 'temperature' ? 2 : mode === 'vorticity' ? 1 : 0;
}

function fieldValue(snapshot: NonNullable<SimulationResults['flowSnapshot']>, cell: number, mode: FlowRenderMode, pressureScalePa: number): number {
  const offset = cell * snapshot.displayStride;
  if ('display' in snapshot) {
    if (mode === 3) {
      const pressureOffset = flowPressureOffset(snapshot);
      return pressureOffset === null ? 0 : snapshot.display[offset + pressureOffset] * pressureScalePa;
    }
    return mode === 2 && !flowHasTemperature(snapshot) ? 0 : snapshot.display[offset + mode];
  }
  if (mode === 0) return Math.hypot(snapshot.fields[offset], snapshot.fields[offset + 1], snapshot.fields[offset + 2]);
  return mode === 3 ? snapshot.fields[offset + 3] : mode === 2 && snapshot.displayStride === 5 ? snapshot.fields[offset + 4] : 0;
}

// 渲染精度 → 光线步进步长倍率
const RENDER_STEP_SCALE = { fine: 0.5, standard: 1, fast: 2 } as const;

// store → 体渲染视角参数（显示阈值 + 剖切平面；yz/xz/xy 面的法向即 x/y/z 轴）
function viewOptionsOf(s: {
  parameters: { displayThreshold: number };
  state: { slicePlane: 'xy' | 'yz' | 'xz' | 'none'; slicePosition: number; showBoundary: boolean };
  derived: { 'lbm-ground-v1'?: number; 'mac-3d-v1'?: number; groundMode?: string } | null;
  results: Pick<SimulationResults, 'job' | 'flowSnapshot'>;
}): ViewOptions {
  const job = s.results.job;
  const parameters = job?.spec.kind === 'lbm-d3q19' ? job.spec.parameters : undefined;
  const inlet = parameters && 'inletVelocity' in parameters ? parameters.inletVelocity : undefined;
  const units = job?.result.derived;
  const inletVelocityLattice = typeof inlet === 'number' && Number.isFinite(inlet) && inlet > 0 &&
    typeof units?.dx === 'number' && Number.isFinite(units.dx) && units.dx > 0 &&
    typeof units.dt === 'number' && Number.isFinite(units.dt) && units.dt > 0 ? inlet * units.dt / units.dx : 0;
  return {
    threshold: s.parameters.displayThreshold,
    clipAxis: s.state.slicePlane === 'yz' ? 1 : s.state.slicePlane === 'xz' ? 2 : s.state.slicePlane === 'xy' ? 3 : 0,
    clipPos: s.state.slicePosition,
    boundaryMargin: s.state.showBoundary || s.derived?.['mac-3d-v1'] === 1 ||
      (s.results.flowSnapshot !== null && 'fields' in s.results.flowSnapshot) ? 0 : 3,
    groundEnabled: s.derived?.['lbm-ground-v1'] === 1 && !!s.derived.groundMode,
    inletVelocityLattice,
  };
}

export function WindTunnelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliceRef = useRef<HTMLCanvasElement>(null);
  const sliceCaptionRef = useRef<HTMLParagraphElement>(null);
  const rendererRef = useRef<VolumeRenderer | null>(null);
  const displayBufferRef = useRef<GPUBuffer | null>(null);
  const cameraRef = useRef<CameraState>({ theta: 0.6, phi: 0.35, radius: 2.6 });

  const { gpuContext, parameters, state, results, derived, setGPUContext } = useSimulationStore();
  const { initialize } = useWebGPU();
  const displayed = results.flowFrames[state.playbackIndex] ?? results.flowSnapshot;
  const savedUnits = results.job?.result.derived;
  const pressureScalePa = typeof savedUnits?.pressureScalePa === 'number' && Number.isFinite(savedUnits.pressureScalePa) && savedUnits.pressureScalePa > 0 ? savedUnits.pressureScalePa : null;
  const pressureAvailable = !!displayed && ('fields' in displayed || (flowPressureOffset(displayed) !== null && pressureScalePa !== null));
  const missingPressure = state.visualizationMode === 'pressure' && !pressureAvailable;
  const pressureUnitsPending = state.isRunning && !results.job && !!displayed &&
    'display' in displayed && flowPressureOffset(displayed) !== null && pressureScalePa === null;
  const rendererLayoutKey = results.flowSnapshot ? [
    results.flowSnapshot.nx, results.flowSnapshot.ny, results.flowSnapshot.nz,
    results.flowSnapshot.displayStride, 'fields' in results.flowSnapshot ? 'mac' : 'lbm',
    'fields' in results.flowSnapshot ? 'temperature' : flowHasTemperature(results.flowSnapshot) ? 'temperature' : 'no-temperature',
    'fields' in results.flowSnapshot ? -1 : flowPressureOffset(results.flowSnapshot) ?? -1,
  ].join(':') : 'empty';
  const physicalRanges = useMemo<FlowValueRanges>(() => {
    if (!results.flowSnapshot) return [];
    const mac = 'fields' in results.flowSnapshot;
    if ('display' in results.flowSnapshot && !results.flowSnapshot.hasPressure) return [];
    const summaries = (results.flowFrames.length ? results.flowFrames : [results.flowSnapshot])
      .map(snapshot => 'fields' in snapshot ? summarizeMacFlowSnapshot(snapshot) : summarizeFlowSnapshot(snapshot, { ...savedUnits, pressureScalePa: pressureScalePa ?? undefined }));
    const temperatureRanges = summaries.flatMap(summary => [summary.fluidTemperatureC, summary.solidTemperatureC].filter(range => range !== null));
    const pressures = summaries.flatMap(summary => summary.pressurePa ? [summary.pressurePa] : []);
    const pressureBound = Math.max(0, ...pressures.flatMap(range => [Math.abs(range.min), Math.abs(range.max)]));
    return [mac ? [0, Math.max(1e-12, ...summaries.map(summary => summary.maxSpeedMps ?? 0))] : undefined,
      undefined,
      mac ? temperatureRanges.length ? [Math.min(...temperatureRanges.map(range => range.min)), Math.max(...temperatureRanges.map(range => range.max))] : [0, 1] : undefined,
      pressures.length ? [-pressureBound, pressureBound] : undefined];
  }, [results.flowFrames, results.flowSnapshot, savedUnits, pressureScalePa]);
  const speedReference = useMemo(() => Math.max(...(results.flowFrames.length ? results.flowFrames : results.flowSnapshot ? [results.flowSnapshot] : [])
    .map(snapshot => 'fields' in snapshot ? physicalRanges[0]?.[1] ?? 1e-12 : flowSpeedReference(snapshot)), 1e-12), [results.flowFrames, results.flowSnapshot, physicalRanges]);
  const showSlice = !!results.flowSnapshot && (!gpuContext.device || !!gpuContext.errorMessage);

  // Read the saved field directly when 3D rendering is unavailable; no local solve.
  useEffect(() => {
    const snapshot = displayed, canvas = sliceRef.current;
    if (!showSlice || !snapshot || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const plane = state.slicePlane === 'none' ? 'xy' : state.slicePlane;
    const a = plane === 'yz' ? 1 : 0, b = plane === 'xy' ? 1 : 2, normal = 3 - a - b;
    const dims = [snapshot.nx, snapshot.ny, snapshot.nz], width = dims[a], height = dims[b];
    const position = state.slicePlane === 'none' ? 0.5 : Math.min(1, Math.max(0, state.slicePosition));
    const mac = 'fields' in snapshot;
    const mode = renderMode(state.visualizationMode);
    const cells = new Uint32Array(width * height);
    const xyz = [0, 0, 0]; xyz[normal] = Math.round(position * (dims[normal] - 1));
    let maximum = -Infinity;
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      xyz[a] = column; xyz[b] = height - 1 - row;
      const cell = xyz[0] + snapshot.nx * (xyz[1] + snapshot.ny * xyz[2]);
      cells[row * width + column] = cell;
      if (!snapshot.flags[cell]) maximum = Math.max(maximum, fieldValue(snapshot, cell, mode, pressureScalePa ?? 0));
    }
    canvas.width = width; canvas.height = height;
    const pixels = ctx.createImageData(width, height);
    const physicalRange = physicalRanges?.[mode];
    const colorScale = physicalRange ? 1 / Math.max(physicalRange[1] - physicalRange[0], 1e-12) : flowDisplayScale(mode, speedReference);
    cells.forEach((cell, i) => {
      const scalar = fieldValue(snapshot, cell, mode, pressureScalePa ?? 0);
      const normalized = mode === 3 && physicalRange
        ? physicalRange[1] > 0 ? 0.5 * (scalar / physicalRange[1]) + 0.5 : 0.5
        : (scalar - (physicalRange?.[0] ?? 0)) * colorScale;
      const value = Math.max(0, Math.min(1, normalized));
      const uncomputedTemperature = mac && snapshot.flags[cell] === 1;
      for (let channel = 0; channel < 3; channel++) pixels.data[i * 4 + channel] = snapshot.flags[cell] && (mode !== 2 || uncomputedTemperature) ? 180 :
        Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * value - (3 - channel)))));
      pixels.data[i * 4 + 3] = 255;
    });
    ctx.putImageData(pixels, 0, 0);
    const ground = derived?.['lbm-ground-v1'] === 1 && !!derived.groundMode;
    if (ground && (a === 1 || b === 1)) {
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a === 1 ? 0.5 : 0, b === 1 ? height - 0.5 : 0);
      ctx.lineTo(a === 1 ? 0.5 : width, b === 1 ? height - 0.5 : height);
      ctx.stroke();
    }
    const physical = derived && derived.dt > 0 && derived.dx > 0;
    const scale = mac ? 1 : mode === 0 ? (physical ? derived.dx / derived.dt : 1) : (physical ? 1 / derived.dt : 1);
    const thermalUnits = Number.isFinite(derived?.ambientC) && Number.isFinite(derived?.temperatureScaleC) && (derived?.temperatureScaleC ?? 0) > 0;
    const low = physicalRange?.[0] ?? (mode === 2 && thermalUnits ? derived!.ambientC! : 0);
    const factor = mac || mode === 3 ? 1 : mode === 2 ? (thermalUnits ? derived!.temperatureScaleC! : 1) : scale;
    const peak = mac || mode === 3 ? maximum : low + maximum * factor, high = physicalRange?.[1] ?? (low + factor / colorScale);
    const unit = mode === 3 ? 'Pa' : mac ? (mode === 0 ? 'm/s' : '°C') : mode === 2 ? (thermalUnits ? '°C' : '归一化温度') : physical ? (mode === 0 ? 'm/s' : 's⁻¹') : '格子单位';
    const peakText = Number.isFinite(maximum) ? `流体${mode === 0 ? '速度' : mode === 3 ? '表压' : mode === 1 ? '涡量' : '温度'}峰值 ${peak.toPrecision(3)} ${unit}` : '无流体单元';
    if (sliceCaptionRef.current) sliceCaptionRef.current.textContent = `${plane.toUpperCase()} 剖面 ${Math.round(position * 100)}% · ${peakText} · 色标蓝→红 ${low.toPrecision(3)}–${high.toPrecision(3)} ${unit}，${mode === 2 ? mac ? '有温度状态的模型按温度着色；绝热掩膜灰色（温度未计算）' : '模型按温度着色' : '灰色为固体'}${ground ? ` · Y=0 ${derived.groundMode === 'moving' ? '移动' : '固定'}地面${a === 1 || b === 1 ? '（黄线）' : ''}，速度 ${derived.groundVelocityMps} m/s，最低点间隙 ${derived.groundClearanceM} m` : ''}`;
  }, [showSlice, displayed, speedReference, physicalRanges, state.slicePlane, state.slicePosition, state.visualizationMode, derived, pressureScalePa]);

  // Remote compute needs no local solver. Request a device only to display returned data.
  useEffect(() => {
    if (results.flowSnapshot && !gpuContext.device && !gpuContext.errorMessage) void initialize();
    // initialize is recreated by the existing hook; actual inputs own this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.flowSnapshot, gpuContext.device, gpuContext.errorMessage]);

  useEffect(() => {
    const snapshot = useSimulationStore.getState().results.flowSnapshot;
    const device = gpuContext.device;
    const canvas = canvasRef.current;
    if (!snapshot || !device || !canvas) return;
    const buffers: GPUBuffer[] = [];
    let renderer: VolumeRenderer | null = null;
    const dispose = () => {
      renderer?.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
      displayBufferRef.current = null;
      buffers.forEach((buffer) => buffer.destroy());
    };
    try {
      const upload = (data: Float32Array | Uint32Array) => {
        const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        buffers.push(buffer);
        device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
        return buffer;
      };
      const display = upload('fields' in snapshot ? snapshot.fields : snapshot.display);
      displayBufferRef.current = display;
      const flags = upload(snapshot.flags);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * (window.devicePixelRatio || 1)));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * (window.devicePixelRatio || 1)));
      renderer = new VolumeRenderer(device, canvas, snapshot, { display, flags }, 1, snapshot.displayStride, [], {
        mac: 'fields' in snapshot,
        hasTemperature: 'fields' in snapshot ? snapshot.displayStride === 5 : flowHasTemperature(snapshot),
        pressureOffset: 'fields' in snapshot ? 3 : flowPressureOffset(snapshot),
        pressureScalePa: 0,
      });
      renderer.setCamera(cameraRef.current);
      rendererRef.current = renderer;
      setGPUContext({ errorMessage: null });
    } catch (error) {
      dispose();
      setGPUContext({ errorMessage: error instanceof Error ? error.message : '流场显示失败' });
    }
    return dispose;
  // Frame objects/ranges update during preview. Rebuild only for field layout,
  // device and explicit reset lifecycle; the key contains every shader/buffer constant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererLayoutKey, gpuContext.device, state.resetCount, setGPUContext]);

  // Preview and replay frames reuse the same GPU buffers and render pipeline.
  useEffect(() => {
    if (!displayed || !gpuContext.device || !displayBufferRef.current || !rendererRef.current) return;
    try {
      const values = 'fields' in displayed ? displayed.fields : displayed.display;
      rendererRef.current.updateFrame(values, displayed.flags, {
        uInlet: speedReference,
        physicalRanges,
        pressureScalePa: 'fields' in displayed ? 1 : pressureScalePa ?? 0,
      });
      const sim = useSimulationStore.getState();
      rendererRef.current.render(renderMode(sim.state.visualizationMode),
        RENDER_STEP_SCALE[sim.parameters.renderQuality], viewOptionsOf(sim));
    } catch (error) { setGPUContext({ errorMessage: error instanceof Error ? error.message : '回放显示失败' }); }
  }, [displayed, gpuContext.device, state.resetCount, setGPUContext, speedReference, physicalRanges, pressureScalePa]);

  // 相机交互：拖拽旋转、滚轮缩放（暂停时也可操作）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const renderCurrentFrame = () => {
      const s = useSimulationStore.getState();
      rendererRef.current?.render(
        renderMode(s.state.visualizationMode),
        RENDER_STEP_SCALE[s.parameters.renderQuality],
        viewOptionsOf(s)
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || !rendererRef.current) return;
      cameraRef.current.theta += (e.clientX - lastX) * 0.005;
      cameraRef.current.phi -= (e.clientY - lastY) * 0.005;
      lastX = e.clientX;
      lastY = e.clientY;
      rendererRef.current.setCamera(cameraRef.current);
      renderCurrentFrame();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!rendererRef.current) return;
      cameraRef.current.radius *= e.deltaY > 0 ? 1.1 : 0.9;
      rendererRef.current.setCamera(cameraRef.current);
      renderCurrentFrame();
    };

    // Resize the view without rebuilding the solver or discarding its result.
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      renderCurrentFrame();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    resize();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('lostpointercapture', onPointerUp);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Worker 负责计算；显示选项随时重绘最近一帧，不等待下一帧或计算完成。
  useEffect(() => {
    const s = useSimulationStore.getState();
    if (!rendererRef.current) return;
    rendererRef.current.render(
      renderMode(s.state.visualizationMode),
      RENDER_STEP_SCALE[s.parameters.renderQuality],
      viewOptionsOf(s)
    );
  }, [state.visualizationMode, state.slicePlane, state.slicePosition, state.showBoundary, parameters.displayThreshold, parameters.renderQuality, derived]);

  return (
    <div className="relative w-full h-full">
      {state.isRunning && !results.job && <p className="pointer-events-none absolute right-3 bottom-3 z-20 rounded bg-zinc-950/85 px-3 py-2 text-xs text-amber-200" role="status">
        计算中预览 · 第 {displayed?.step ?? 0} 步 · 尚未完成
      </p>}
      <canvas ref={canvasRef} className="w-full h-full" aria-label="三维流场"
        style={{ display: !displayed || showSlice || missingPressure ? 'none' : 'block', touchAction: 'none' }} />
      {missingPressure && <p className="absolute inset-0 flex items-center justify-center bg-zinc-950 p-4 text-sm text-zinc-300" role="status">{pressureUnitsPending
        ? '已收到表压中间帧，等待计算完成后提供物理单位。'
        : '此结果未保存可用的表压场或单位，请重新计算。'}</p>}
      {!missingPressure && <div className="pointer-events-none absolute top-3 left-3 right-3 z-10 flex flex-col items-start gap-2">
        {state.visualizationMode === 'pressure' && physicalRanges[3] && <p className="rounded bg-zinc-950/85 px-3 py-2 text-xs text-zinc-300" aria-label="表压色标">
          表压 · 蓝→红 {physicalRanges[3][0].toPrecision(3)}–{physicalRanges[3][1].toPrecision(3)} Pa · {state.isRunning && !results.job ? '当前预览帧刻度' : '全部保存帧共用刻度'} · 灰色为固体
        </p>}
        {!showSlice && derived?.['lbm-ground-v1'] === 1 && derived.groundMode && <p className="rounded bg-zinc-950/85 px-3 py-2 text-xs text-zinc-300" aria-label="流场地面">
          Y=0 · {derived.groundMode === 'moving' ? '移动地面' : '固定地面'} · {derived.groundVelocityMps} m/s (+X) · 最低点间隙 {derived.groundClearanceM} m
        </p>}
      </div>}
      {showSlice && !missingPressure && <div className="absolute inset-0 flex flex-col bg-zinc-950 p-4">
        <canvas ref={sliceRef} role="img" aria-label="二维流场剖面" className="min-h-0 flex-1 w-full"
          style={{ objectFit: 'contain', imageRendering: 'pixelated' }} />
        <p ref={sliceCaptionRef} className="mt-2 text-xs text-zinc-300" />
      </div>}
    </div>
  );
}
