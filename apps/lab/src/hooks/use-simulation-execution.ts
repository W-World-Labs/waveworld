'use client';

import { useEffect, useRef, useState } from 'react';
import type { HostClass, JobResultV1 } from '@w-sim/contracts';
import { prepareProductLbmUnits } from '@w-sim/solvers-lbm/d3q19';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { useProjectStore } from '@/lib/stores/project-store';
import { createActiveFlowJobSpec, createLbmJobSpec, createLbmPreviewPlacement } from '@/lib/models/sim-session';
import { assertWorkbenchDurationSeconds } from '@/lib/models/run-times';
import { createSettlementClient, runRemoteJob, RemoteJobCancelError, TaskLoginRequiredError } from '@/lib/w-sim/settlement-client';
import { useWebGPU } from '@/hooks/use-webgpu';
import type { ModelGeometry } from '@/types/model';
import { decodeFlowSnapshot, assertFlowFrames, FLOW_SNAPSHOT_KIND, FLOW_SEQUENCE_KIND, type LbmDisplaySnapshot } from '@/lib/cfd/flow-snapshot';
import { decodeMacFlowSnapshot, assertMacFlowFrames, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SEQUENCE_KIND, type MacFlowSnapshot } from '@/lib/cfd/mac-flow-snapshot';
import { runBrowserCompute, runBrowserJob } from '../../../../src/lib/sim/browser-agent';
import { createFrameExportWriter, getFrameExportDir } from '@/lib/cfd/frame-export';
import { encodeFlowSnapshot } from '@/lib/cfd/flow-snapshot';
import { encodeMacFlowSnapshot } from '@/lib/cfd/mac-flow-snapshot';

/** One run entry and results store for both execution locations. */
export function useSimulationExecution() {
  const gpu = useWebGPU();
  const target = useSimulationStore((store) => store.computeTarget);
  const backend = useSimulationStore((store) => store.computeBackend);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const active = useRef<{ abort: AbortController; done: Promise<void>; replacedResults: boolean; invalidated?: boolean; hostCompleted?: boolean } | null>(null);
  const mounted = useRef(true);
  const cancelFailed = useRef<string | null>(null);
  const client = useRef(createSettlementClient());
  const uploaded = useRef<{ geometry: ModelGeometry; artifactId: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      const run = active.current;
      if (run) {
        run.invalidated = true;
        run.abort.abort(new DOMException('模型或参数已变化，请重新开始计算', 'AbortError'));
      }
      useSimulationStore.getState().clearResults();
      if (!cancelFailed.current) {
        setStatus('idle'); setError(null); setJobId(null); setLoginRequired(false);
      }
    };
    const stopParameters = useSimulationStore.subscribe((next, previous) => {
      if (next.parameters !== previous.parameters && (next.parameters.durationSeconds !== previous.parameters.durationSeconds ||
          JSON.stringify([next.parameters.flowMethod, next.parameters.macGrid, next.parameters.macCharacteristicCells, next.parameters.macOpenFaces, next.parameters.macFans]) !==
            JSON.stringify([previous.parameters.flowMethod, previous.parameters.macGrid, previous.parameters.macCharacteristicCells, previous.parameters.macOpenFaces, previous.parameters.macFans]) ||
          (next.parameters.flowMethod === 'mac' && next.parameters.dtSeconds !== previous.parameters.dtSeconds) ||
          JSON.stringify(createLbmJobSpec(next.parameters)) !== JSON.stringify(createLbmJobSpec(previous.parameters)))) invalidate();
    });
    const stopModel = useProjectStore.subscribe((next, previous) => {
      const currentGeometry = next.uploadedModels.find((model) => model.metadata.id === next.activeModel?.id)?.geometry;
      const previousGeometry = previous.uploadedModels.find((model) => model.metadata.id === previous.activeModel?.id)?.geometry;
      if (next.activeModel !== previous.activeModel || currentGeometry !== previousGeometry) invalidate();
    });
    return () => {
      mounted.current = false; active.current?.abort.abort();
      stopParameters(); stopModel();
      if (active.current) {
        if (active.current.replacedResults) useSimulationStore.getState().clearResults();
        useSimulationStore.getState().stopSimulation();
      }
    };
  }, []);

  const stop = async () => {
    const run = active.current;
    if (run) { run.abort.abort(); await run.done; }
    if (cancelFailed.current) {
      try { await client.current.cancel(cancelFailed.current); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
      cancelFailed.current = null;
      setError(null); setStatus('canceled');
    }
    useSimulationStore.getState().stopSimulation();
  };

  const reset = async () => {
    try {
      await stop();
      useSimulationStore.getState().resetSimulation();
      setStatus('idle'); setError(null); setJobId(null); setLoginRequired(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const setTarget = async (next: HostClass) => {
    if (next === target) return;
    try {
      await stop();
      useSimulationStore.getState().clearResults();
      useSimulationStore.getState().setComputeTarget(next);
      setStatus('idle'); setError(null); setJobId(null); setLoginRequired(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const setBackend = async (next: 'cpu' | 'webgpu') => {
    if (next === backend) return;
    try {
      await stop();
      useSimulationStore.getState().clearResults();
      useSimulationStore.getState().setComputeBackend(next);
      setStatus('idle'); setError(null); setJobId(null); setLoginRequired(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const start = async (publish = false) => {
    if (active.current || cancelFailed.current) return;
    setError(null); setLoginRequired(false);
    const store = useSimulationStore.getState();
    let spec;
    let dtSeconds: number;
    const project = useProjectStore.getState();
    const model = project.uploadedModels.find((model) => model.metadata.id === project.activeModel?.id);
    try {
      const durationSeconds = assertWorkbenchDurationSeconds(store.parameters.durationSeconds ?? 10);
      spec = createActiveFlowJobSpec({ ...store.parameters, durationSeconds }, project.activeModel, store.computeBackend);
      if (!model || !project.activeModel) throw new Error('模型尚未加载，请重新选择模型');
      createLbmPreviewPlacement(store.parameters, project.activeModel, model.geometry);
      dtSeconds = spec.kind === 'mac-3d' ? spec.parameters.dtSeconds : prepareProductLbmUnits(spec,
        spec.model?.referenceLength ?? project.activeModel.sourceModel.boundingBox.size[0]).units.dt;
    } catch (cause) { setStatus('failed'); setJobId(null); setError(cause instanceof Error ? cause.message : String(cause)); return; }
    store.startSimulation();
    const publishing = publish || store.computeTarget === 'backend';
    setStatus(publishing ? 'submitting' : 'running'); setJobId(null);
    const abort = new AbortController();
    const run = { abort, done: Promise.resolve(), replacedResults: false, invalidated: false, hostCompleted: false };
    active.current = run;
    // 本机 WebGPU 看门狗：个别驱动会让 GPU 读回/设备请求无限挂起（整页
    // RESULT_CODE_HUNG 的前兆）。运行中 60s 无任何进度即中止并提示切 CPU。
    let lastProgressAt = Date.now();
    let stallWatchdog: ReturnType<typeof setInterval> | null = null;
    if (!publishing && store.computeBackend === 'webgpu') {
      stallWatchdog = setInterval(() => {
        if (active.current === run && !abort.signal.aborted && Date.now() - lastProgressAt > 60_000) {
          // 先置错误信息再中止——AbortError 路径在 catch 里归为 canceled，
          // 需要把提示留给用户可见。
          setStatus('failed');
          setError('GPU 计算 60 秒无响应，已自动中止；请将「计算设备」切换为 CPU 重试');
          abort.abort();
        }
      }, 10_000);
    }
    run.done = (async () => {
      if (publishing) await client.current.requireUser(abort.signal);
      abort.signal.throwIfAborted();
      store.clearResults();
      run.replacedResults = true;
      const onProgress = (progress: { step: number }) => {
        lastProgressAt = Date.now();
        if (mounted.current && active.current === run && !abort.signal.aborted) useSimulationStore.getState().setState({
          currentIteration: progress.step, currentTime: progress.step * dtSeconds,
        });
      };
      const exportDir = getFrameExportDir();
      const exportWriter = exportDir ? createFrameExportWriter(exportDir, `run-${Date.now()}`, spec.kind === 'mac-3d' ? 'wvm' : 'wvf') : null;
      let lastPreviewAt = -Infinity;
      let lastPreviewStep = 0;
      const onFrame = (flow: ArrayBuffer) => {
        if (!mounted.current || active.current !== run || abort.signal.aborted) return;
        const now = Date.now();
        lastProgressAt = now;
        // Keep only the latest displayed frame; final playback comes from the
        // fully validated sequence. Bound preview decoding and GPU uploads to 4 Hz.
        if (now - lastPreviewAt >= 250) {
          const frame = spec.kind === 'mac-3d' ? decodeMacFlowSnapshot(flow) : decodeFlowSnapshot(flow);
          if (frame.step > lastPreviewStep && frame.step <= spec.run.maxSteps) {
            lastPreviewAt = now; lastPreviewStep = frame.step;
            const current = useSimulationStore.getState();
            const step = Math.max(current.state.currentIteration, frame.step);
            current.setState({ currentIteration: step, currentTime: step * dtSeconds });
            current.updateResults({ flowSnapshot: frame });
          }
        }
        // The directory writer retains every requested frame, independently of
        // preview throttling. No incomplete frame is promoted to a JobResult.
        // Published jobs export their authoritative downloaded frames below.
        if (!publishing) exportWriter?.push(flow, new DataView(flow).getUint32(16, true));
      };
      // 导出失败只提示、不把已完成的计算标记为失败（帧仍在内存可回放）。
      const finishExport = async (result: JobResultV1) => {
        if (!exportWriter) return;
        try { await exportWriter.finish(spec, result); }
        catch (cause) { if (mounted.current) setError(`本地目录导出未完成（计算结果不受影响）：${cause instanceof Error ? cause.message : String(cause)}`); }
      };
      if (!publishing) {
        const { result, flows } = await runBrowserCompute(spec, { signal: abort.signal, geometry: model.geometry, onProgress,
          onFrame });
        if (!flows?.length) throw new Error('本机求解器未返回流场');
        await finishExport(result);
        return { result, frames: spec.kind === 'mac-3d' ? flows.map(decodeMacFlowSnapshot) : flows.map(flow => decodeFlowSnapshot(flow)) };
      }
      if (mounted.current) setStatus('uploading');
      if (uploaded.current?.geometry !== model.geometry) {
        const artifactId = await client.current.uploadModel(model.geometry, abort.signal);
        uploaded.current = { geometry: model.geometry, artifactId };
      }
      abort.signal.throwIfAborted();
      if (mounted.current) setStatus('submitting');
      const runJob = store.computeTarget === 'browser' ? runBrowserJob : runRemoteJob;
      const result = await runJob(client.current, { ...spec, model: {
        source: 'artifact', artifactId: uploaded.current.artifactId,
        referenceLength: spec.model?.referenceLength, referenceArea: spec.model?.referenceArea,
      } }, {
        signal: abort.signal,
        geometry: model.geometry,
        onFrame,
        onStatus: (id, next, progress) => {
          if (next === 'succeeded') run.hostCompleted = true;
          if (!mounted.current || active.current !== run || abort.signal.aborted) return;
          setJobId(id); setStatus(next);
          if (progress) onProgress(progress);
        },
      });
      abort.signal.throwIfAborted();
      const fieldKinds = spec.kind === 'mac-3d'
        ? new Set([MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SEQUENCE_KIND])
        : new Set([FLOW_SNAPSHOT_KIND, FLOW_SEQUENCE_KIND]);
      const fields = result.artifacts?.filter((artifact) => fieldKinds.has(artifact.kind));
      if (!fields?.length || fields.length > 4096 || fields.reduce((sum, field) => sum + field.bytes, 0) > 256 * 1024 * 1024) throw new Error('计算 Agent 返回的流场文件数量或大小无效');
      if (mounted.current) setStatus('downloading');
      const frames = [];
      for (const field of fields) frames.push(...await client.current.downloadFlowFrames(field, abort.signal));
      if (exportWriter) {
        for (const frame of frames) {
          const encoded = spec.kind === 'mac-3d' ? encodeMacFlowSnapshot(frame as MacFlowSnapshot) : encodeFlowSnapshot(frame as LbmDisplaySnapshot);
          exportWriter.push(encoded, frame.step);
        }
        await finishExport(result);
      }
      return { result, frames };
    })().then(({ result, frames }) => {
      if (!mounted.current || active.current !== run) return;
      if (run.invalidated) return;
      if (abort.signal.aborted) {
        if (run.hostCompleted) {
          useSimulationStore.getState().clearResults();
          setStatus('host-completed-local-canceled');
          setError('Host 任务已完成，但本机已停止读取结果；计算结果未载入。');
        }
        return;
      }
      if (result.summary.steps !== spec.run.maxSteps) throw new Error(`物理仿真尚未完成：仅计算 ${result.summary.steps} / ${spec.run.maxSteps} 步，请重新计算`);
      if (spec.kind === 'mac-3d') assertMacFlowFrames(frames as MacFlowSnapshot[], spec, result.summary.steps);
      else assertFlowFrames(frames as LbmDisplaySnapshot[], spec, result.summary.steps, result.derived);
      useSimulationStore.getState().applyJobResult(result);
      useSimulationStore.getState().updateResults({ flowSnapshot: frames.at(-1)!, flowFrames: frames, job: { spec, result } });
      setStatus('succeeded');
    }).catch((cause) => {
      if (!mounted.current || active.current !== run) return;
      // Authentication has not replaced the completed local result. Only clear
      // preview/results belonging to the new attempt once that attempt starts.
      if (run.replacedResults) useSimulationStore.getState().clearResults();
      if (run.invalidated) return;
      if (abort.signal.aborted && run.hostCompleted) {
        setStatus('host-completed-local-canceled');
        setError('Host 任务已完成，但本机已停止读取结果；计算结果未载入。');
      }
      else if (abort.signal.aborted && cause === abort.signal.reason) setStatus('canceled');
      else {
        if (cause instanceof RemoteJobCancelError) cancelFailed.current = cause.jobId;
        setStatus('failed');
        setLoginRequired(cause instanceof TaskLoginRequiredError);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }).finally(() => {
      if (stallWatchdog) clearInterval(stallWatchdog);
      if (active.current !== run) return;
      active.current = null;
      if (mounted.current) useSimulationStore.getState().stopSimulation();
    });
    await run.done;
  };

  return { gpu, target, backend, setTarget, setBackend, start, stop, reset, status, error, loginRequired, jobId };
}
