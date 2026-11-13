'use client';

import { useEffect } from 'react';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { NumberInput } from '@/components/ui/input';
import { describeRunTimes, formatRunTimeSeconds } from '@/lib/models/run-times';

/** Playback advances saved frames only; final result statistics stay unchanged. */
export function FlowPlayback() {
  const { parameters, results, derived, state, setState } = useSimulationStore();
  const frames = results.flowFrames;
  const index = state.playbackIndex < 0 ? frames.length - 1 : state.playbackIndex;
  const frame = frames[index];
  const dt = results.job?.result.derived?.dt ?? derived?.dt;
  const targetSeconds = parameters.durationSeconds ?? 10;
  const canPlay = frames.length > 1;
  useEffect(() => {
    if (!state.isPlaying || frames.length < 2) return;
    const initial = useSimulationStore.getState().state.playbackIndex;
    const start = performance.now(), startIndex = Math.max(0, initial);
    const frameMs = Math.max(0.1, state.playbackDuration) * 1000 / frames.length;
    let animation = 0, previous = startIndex;
    const tick = (now: number) => {
      const elapsed = startIndex + Math.floor((now - start) / frameMs);
      if (!state.playbackLoop && elapsed >= frames.length) {
        setState({ isPlaying: false, playbackIndex: frames.length - 1 });
        return;
      }
      const next = elapsed % frames.length;
      if (next !== previous) { previous = next; setState({ playbackIndex: next }); }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [state.isPlaying, state.playbackDuration, state.playbackLoop, frames, setState]);

  if (!frame || typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return null;
  const times = describeRunTimes({
    dt,
    targetSeconds,
    frameStep: frame.step,
    completedSteps: results.job?.result.summary.steps ?? frames.at(-1)!.step,
    requestedSteps: results.job?.spec.run.maxSteps,
  });
  const frameLabel = formatRunTimeSeconds(times.framePhysicalSeconds);
  const completedLabel = formatRunTimeSeconds(times.completedPhysicalSeconds);
  const targetLabel = formatRunTimeSeconds(times.targetPhysicalSeconds);
  const progressLabel = times.progressRatio == null ? null : `${Math.min(100, Math.max(0, times.progressRatio * 100)).toFixed(1)}%`;
  const sampleStep = frames.length > 1 ? frames[1].step - frames[0].step : null;
  const sampleFps = sampleStep !== null && sampleStep > 0 ? 1 / (sampleStep * dt) : null;
  return <div className="mt-3 space-y-2 border-t border-zinc-700 pt-3 text-xs" aria-label="流场回放">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={!canPlay} className="rounded bg-cyan-300 px-3 py-1.5 text-zinc-950 disabled:opacity-40" onClick={() => setState({
        isPlaying: !state.isPlaying, playbackIndex: state.isPlaying ? index : index >= frames.length - 1 ? 0 : index,
      })}>{canPlay && state.isPlaying ? '暂停回放' : '播放回放'}</button>
      <button type="button" disabled={!canPlay} className="underline disabled:opacity-40" onClick={() => setState({ isPlaying: false, playbackIndex: -1 })}>查看最终帧</button>
      <label className="flex items-center gap-1"><input type="checkbox" disabled={!canPlay} checked={state.playbackLoop}
        onChange={event => setState({ playbackLoop: event.currentTarget.checked })} />循环播放</label>
    </div>
    <input className="w-full accent-cyan-300 disabled:opacity-40" disabled={!canPlay} type="range" min={0} max={frames.length - 1} step={1} value={index}
      aria-label="回放帧" onChange={event => setState({ playbackIndex: event.currentTarget.valueAsNumber, isPlaying: false })} />
    <div className="grid gap-1 sm:grid-cols-2" aria-label="物理时刻">
      <span aria-live="off" aria-label="当前帧物理时刻">当前帧物理时刻 {frameLabel} s · 第 {frame.step} 步 · 帧 {index + 1}/{frames.length}</span>
      <span aria-label="最终已计算时间">最终已计算时间 {completedLabel} s</span>
      <span aria-label="目标时间">目标时间 {targetLabel} s</span>
      <span aria-label="计算进度">计算进度 {progressLabel ?? '—'}</span>
      {sampleFps !== null && <span aria-label="采样帧率">采样率 {sampleFps >= 10 ? sampleFps.toFixed(0) : sampleFps.toPrecision(2)} 帧/物理秒 · 每 {sampleStep} 步</span>}
      <label className="sm:col-span-2">一轮播放用时 <NumberInput disabled={!canPlay} className="inline-block h-auto w-14 border-zinc-600 bg-zinc-900 px-1 py-0 text-xs" min={0.1} max={600} step="any"
        aria-label="一轮播放用时（s）" value={state.playbackDuration}
        onValueChange={playbackDuration => setState({ playbackDuration })} /> s</label>
    </div>
    {times.shortResult && !times.markedComplete && <p className="text-amber-300" role="alert">该结果仅覆盖约 {completedLabel} s，未达到 {targetLabel} s 目标，请重新计算。当前帧时刻不是最终已计算时间。</p>}
    {!canPlay && <p className="text-zinc-400">当前结果仅保存一帧，无法动态回放。</p>}
    <p className="text-zinc-400">按保存的帧播放，不重新计算。播放用时与物理时长不同；循环播放不会补足计算时间。</p>
  </div>;
}
