/** Workbench duration and playback clocks. Mapping only; no solver steps. */

export function assertWorkbenchDurationSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 10) {
    throw new Error('工作台仿真物理时长至少为 10 秒');
  }
  return durationSeconds;
}

export type RunClockStatus = 'idle' | 'running' | 'succeeded' | 'canceled' | 'failed';

export type RunTimeView = {
  framePhysicalSeconds: number | null;
  completedPhysicalSeconds: number | null;
  targetPhysicalSeconds: number;
  progressRatio: number | null;
  reachedTarget: boolean;
  markedComplete: boolean;
  shortResult: boolean;
};

function physicalSeconds(steps: number | null | undefined, dt: number): number | null {
  if (!Number.isFinite(dt) || dt <= 0 || steps == null || !Number.isFinite(steps) || steps < 0) return null;
  return steps * dt;
}

/** Current frame, completed compute, target, and progress stay independent. */
export function describeRunTimes(input: {
  dt: number;
  targetSeconds: number;
  frameStep?: number | null;
  completedSteps?: number | null;
  requestedSteps?: number | null;
  status?: RunClockStatus;
}): RunTimeView {
  const targetPhysicalSeconds = input.targetSeconds;
  const framePhysicalSeconds = physicalSeconds(input.frameStep, input.dt);
  const completedPhysicalSeconds = physicalSeconds(input.completedSteps, input.dt);
  const progressRatio = completedPhysicalSeconds == null || !Number.isFinite(targetPhysicalSeconds) || targetPhysicalSeconds <= 0
    ? null : completedPhysicalSeconds / targetPhysicalSeconds;
  const dt = Number.isFinite(input.dt) && input.dt > 0 ? input.dt : 0;
  const reachedByTime = completedPhysicalSeconds != null && Number.isFinite(targetPhysicalSeconds)
    && completedPhysicalSeconds >= targetPhysicalSeconds - Math.max(dt, Math.abs(targetPhysicalSeconds) * 1e-12);
  const reachedBySteps = input.requestedSteps != null && Number.isSafeInteger(input.requestedSteps) && input.requestedSteps > 0
    && input.completedSteps === input.requestedSteps;
  const reachedTarget = reachedByTime;
  const failed = input.status === 'canceled' || input.status === 'failed';
  const markedComplete = !failed && input.status === 'succeeded' && reachedByTime && (input.requestedSteps == null || reachedBySteps);
  const shortResult = !failed && completedPhysicalSeconds != null && Number.isFinite(targetPhysicalSeconds)
    && completedPhysicalSeconds < targetPhysicalSeconds - Math.max(dt, Math.abs(targetPhysicalSeconds) * 1e-12);
  return {
    framePhysicalSeconds,
    completedPhysicalSeconds,
    targetPhysicalSeconds,
    progressRatio,
    reachedTarget,
    markedComplete,
    shortResult,
  };
}

export function formatRunTimeSeconds(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return String(Number(value.toPrecision(8)));
}

const CLOCK_STATUSES: readonly RunClockStatus[] = ['idle', 'running', 'succeeded', 'canceled', 'failed'];

export function runClockStatus(status: string): RunClockStatus | undefined {
  return (CLOCK_STATUSES as readonly string[]).includes(status) ? status as RunClockStatus : undefined;
}

/** Status line: never treat a playback frame or a short/cancelled run as a finished 10 s job. */
export function labExecutionHeadline(status: string, times: RunTimeView | null): string {
  const target = times ? formatRunTimeSeconds(times.targetPhysicalSeconds) : null;
  const completed = times ? formatRunTimeSeconds(times.completedPhysicalSeconds) : null;
  const progress = times?.progressRatio == null ? null : `${Math.min(100, Math.max(0, times.progressRatio * 100)).toFixed(1)}%`;
  if (status === 'running') {
    return `计算中 · 最终已计算时间 ${completed ?? '—'} s · 目标时间 ${target ?? '—'} s · 计算进度 ${progress ?? '—'}`;
  }
  if (status === 'host-completed-local-canceled') return 'Host 任务已完成，但本机已停止读取结果；计算结果未载入';
  if (status === 'canceled') return `任务已停止，未完成目标时间${completed ? `（最终已计算 ${completed} s）` : ''}`;
  if (status === 'failed') return `任务未完成${completed ? `（最终已计算 ${completed} s）` : ''}`;
  if (status === 'succeeded') {
    return times?.markedComplete
      ? `计算完成 · 最终已计算时间 ${completed} s · 目标时间 ${target} s`
      : `计算未达到目标时间 · 最终已计算时间 ${completed ?? '—'} s · 目标时间 ${target ?? '—'} s`;
  }
  if (status === 'idle' && times) {
    if (times.shortResult) return `已恢复短结果，未完成目标时间 · 最终已计算时间 ${completed} s · 目标时间 ${target} s`;
    if (times.reachedTarget) return `已恢复保存的计算结果 · 最终已计算时间 ${completed} s · 目标时间 ${target} s`;
    return `已恢复保存的计算结果 · 最终已计算时间 ${completed ?? '—'} s`;
  }
  return ({
    idle: '使用当前模型和参数计算',
    uploading: '正在保存当前模型',
    submitting: '正在提交任务',
    queued: '等待算力',
    leased: '计算 Agent 已领取任务',
    downloading: '正在读取计算结果',
  } as Record<string, string>)[status] ?? status;
}
