/**
 * Lab-local diagnostics for recoverable failures.
 * Never escalates to the whole-page error boundary; only annotates local UI.
 */

export type GpuFailureKind = 'webgpu_unavailable' | 'context_lost' | 'gpu_error' | 'unknown';

export type ClassifiedGpuFailure = {
  kind: GpuFailureKind;
  code: string;
  message: string;
  /** Safe to keep Lab shell usable and offer retry/swap. */
  recoverable: true;
};

/** Build id for support / CI correlation (env first, else dev fallback). */
export function getLabBuildId(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_WAVEWORLD_BUILD_ID ||
    process.env.WAVEWORLD_BUILD_ID ||
    process.env.NEXT_PUBLIC_BUILD_ID ||
    process.env.BUILD_ID ||
    process.env.GIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim().slice(0, 64);
  return 'dev-local';
}

/**
 * Compact diagnostic code users can copy into an issue.
 * Format: `lab-<buildShort>-<code>`
 */
export function formatDiagnosticCode(code: string, buildId: string = getLabBuildId()): string {
  const short = buildId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 12) || 'unknown';
  const safe = (code || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48);
  return `lab-${short}-${safe}`;
}

/** Classify WebGPU / device-lost style messages into recoverable local failures. */
export function classifyGpuFailure(raw: string | null | undefined): ClassifiedGpuFailure {
  const message = (raw ?? '').trim() || '未知 GPU 错误';
  const lower = message.toLowerCase();

  if (
    lower.includes('不支持 webgpu') ||
    (lower.includes('webgpu') &&
      (lower.includes('不支持') ||
        lower.includes('unsupported') ||
        lower.includes('not supported'))) ||
    lower.includes('navigator.gpu') ||
    lower.includes('无法获取 gpu 适配器') ||
    lower.includes('no adapter') ||
    lower.includes('requestadapter')
  ) {
    return {
      kind: 'webgpu_unavailable',
      code: 'webgpu_unavailable',
      message: message.includes('WebGPU') || message.includes('webgpu')
        ? message
        : `当前环境无 WebGPU：${message}`,
      recoverable: true,
    };
  }

  if (
    lower.includes('device lost') ||
    lower.includes('设备丢失') ||
    lower.includes('context lost') ||
    lower.includes('contextlost') ||
    lower.includes('webglcontextlost')
  ) {
    return {
      kind: 'context_lost',
      code: 'context_lost',
      message: message.includes('丢失') || message.toLowerCase().includes('lost')
        ? message
        : `GPU 上下文丢失：${message}`,
      recoverable: true,
    };
  }

  if (lower.includes('webgpu') || lower.includes('gpu')) {
    return {
      kind: 'gpu_error',
      code: 'gpu_error',
      message,
      recoverable: true,
    };
  }

  return {
    kind: 'unknown',
    code: 'gpu_unknown',
    message,
    recoverable: true,
  };
}

export type LabEvidenceEvent = {
  type: 'console' | 'pageerror' | 'requestfailed' | 'info' | 'local_error';
  message: string;
  ts: string;
};

const RECENT_CAP = 32;
const recentLocalEvents: LabEvidenceEvent[] = [];

/** Ring buffer of recent local failures for user-facing diagnostic reports. */
export function recordLabLocalEvent(
  type: LabEvidenceEvent['type'],
  message: string
): void {
  recentLocalEvents.push({
    type,
    message: String(message).slice(0, 2000),
    ts: new Date().toISOString(),
  });
  while (recentLocalEvents.length > RECENT_CAP) recentLocalEvents.shift();
}

export function getRecentLabLocalEvents(): readonly LabEvidenceEvent[] {
  return recentLocalEvents;
}

export function clearRecentLabLocalEvents(): void {
  recentLocalEvents.length = 0;
}

export type ClientDiagnosticInput = {
  activeModelId?: string | null;
  activeModelName?: string | null;
  webgpuSupported?: boolean | null;
  webgpuInitialized?: boolean | null;
  gpuError?: string | null;
  isRunning?: boolean;
  extraNotes?: string;
  /** Optional browser fields (fill from window in UI). */
  userAgent?: string;
  href?: string;
  language?: string;
};

/**
 * Markdown report users paste into Gitea issues for real-device triage.
 * Pure string builder — no network, no secrets.
 */
export function buildClientDiagnosticReport(input: ClientDiagnosticInput = {}): string {
  const buildId = getLabBuildId();
  const gpuMsg = input.gpuError?.trim() || '';
  const classified = gpuMsg ? classifyGpuFailure(gpuMsg) : null;
  const code = classified
    ? formatDiagnosticCode(classified.code, buildId)
    : formatDiagnosticCode('client_report', buildId);
  const recent = getRecentLabLocalEvents()
    .slice(-12)
    .map((e) => `- [${e.ts}] ${e.type}: ${e.message}`)
    .join('\n');

  return [
    '## WaveWorld Lab 诊断报告',
    '',
    `诊断码: \`${code}\``,
    `buildId: \`${buildId}\``,
    `generatedAt: ${new Date().toISOString()}`,
    '',
    '### 环境',
    `- userAgent: ${input.userAgent ?? '(n/a)'}`,
    `- language: ${input.language ?? '(n/a)'}`,
    `- href: ${input.href ?? '(n/a)'}`,
    '',
    '### GPU / 仿真',
    `- webgpuSupported: ${input.webgpuSupported ?? '(n/a)'}`,
    `- webgpuInitialized: ${input.webgpuInitialized ?? '(n/a)'}`,
    `- isRunning: ${input.isRunning ?? '(n/a)'}`,
    `- activeModel: ${input.activeModelName ?? '—'} (${input.activeModelId ?? '—'})`,
    `- gpuError: ${gpuMsg || '—'}`,
    classified ? `- classified: ${classified.kind} / ${classified.code}` : '- classified: —',
    '',
    '### 最近局部事件',
    recent || '- (none)',
    '',
    '### 用户备注',
    input.extraNotes?.trim() || '(请补充：操作步骤 / 模型名 / 是否点「开始」)',
    '',
    '---',
    '请提交到部署运营者明确提供的支持入口',
  ].join('\n');
}

/**
 * Build a CI-friendly evidence payload (no browser required).
 * Intended for node:test / workflow artifacts.
 */
export function buildLabEvidenceArtifact(input: {
  suite: string;
  ok: boolean;
  steps: string[];
  failures?: string[];
  events?: LabEvidenceEvent[];
  extra?: Record<string, unknown>;
}): {
  suite: string;
  ok: boolean;
  buildId: string;
  diagnosticCode: string;
  steps: string[];
  failures: string[];
  console: LabEvidenceEvent[];
  pageerror: LabEvidenceEvent[];
  requestfailed: LabEvidenceEvent[];
  generatedAt: string;
  extra?: Record<string, unknown>;
} {
  const events = input.events ?? [];
  const buildId = getLabBuildId();
  const firstFail = input.failures?.[0] ?? (input.ok ? 'ok' : 'failed');
  return {
    suite: input.suite,
    ok: input.ok,
    buildId,
    diagnosticCode: formatDiagnosticCode(input.ok ? 'pass' : firstFail, buildId),
    steps: input.steps,
    failures: input.failures ?? [],
    console: events.filter((e) => e.type === 'console' || e.type === 'info'),
    pageerror: events.filter((e) => e.type === 'pageerror'),
    requestfailed: events.filter((e) => e.type === 'requestfailed'),
    generatedAt: new Date().toISOString(),
    extra: input.extra,
  };
}
