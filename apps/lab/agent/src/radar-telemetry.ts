import { AsyncLocalStorage } from 'node:async_hooks';
import {
  captureError,
  configFromEnv,
  recordSpan,
  recordSpans,
  startChildSpan,
  startSpan,
  traceparent,
  type Span,
  type SpanBatchItem,
} from '@w/xradar';

const MAX_PENDING_TELEMETRY = 128;
const MAX_CONCURRENT_TELEMETRY = 8;
const TELEMETRY_TIMEOUT_MS = 2000;

type Work = () => Promise<void>;

/** Bounded fail-open delivery queue. It never waits on the solver path. */
export class BoundedTelemetryQueue {
  private readonly waiting: Work[] = [];
  private active = 0;
  private dropped = 0;

  constructor(
    private readonly maxPending = MAX_PENDING_TELEMETRY,
    private readonly maxConcurrent = MAX_CONCURRENT_TELEMETRY,
    private readonly onDrop?: (count: number) => void,
  ) {}

  enqueue(work: Work): boolean {
    if (this.waiting.length + this.active >= this.maxPending) {
      this.dropped++;
      this.onDrop?.(this.dropped);
      return false;
    }
    this.waiting.push(work);
    this.pump();
    return true;
  }

  get droppedCount(): number { return this.dropped; }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.waiting.length > 0) {
      const work = this.waiting.shift()!;
      this.active++;
      void Promise.resolve().then(work).catch(() => {}).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
}

interface PhaseSpan {
  span: Span;
  status: string;
  data: Record<string, unknown>;
  ended: boolean;
}

interface AgentTrace {
  root: Span;
  phases: PhaseSpan[];
  kind: string;
  jobId: string;
  finished: boolean;
}

interface AgentTraceContext {
  trace: AgentTrace | null;
  current: Span | null;
}

const traceContext = new AsyncLocalStorage<AgentTraceContext>();
let overflowLogged = false;
const queue = new BoundedTelemetryQueue(MAX_PENDING_TELEMETRY, MAX_CONCURRENT_TELEMETRY, (count) => {
  if (!overflowLogged) {
    overflowLogged = true;
    console.warn(`[xradar] bounded telemetry queue full; dropped=${count}`);
  }
});

function config() {
  return configFromEnv({
    ...process.env,
    APP_ENV: process.env.APP_ENV?.trim() || process.env.ENVIRONMENT?.trim() || process.env.NODE_ENV?.trim(),
    SERVICE_NAME: process.env.SERVICE_NAME?.trim() || 'tuanliu-agent',
  });
}

function exceptionType(error: unknown): string {
  if (!(error instanceof Error)) return 'ApplicationError';
  const name = error.name;
  return new Set([
    'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
    'AbortError', 'TimeoutError',
  ]).has(name) ? name : 'ApplicationError';
}

export function withAgentTrace<T>(kind: string, jobId: string, run: () => T): T {
  const telemetry = config();
  const trace = telemetry.code ? {
    root: startSpan('agent.run', { spanKind: 'internal' }),
    phases: [],
    kind,
    jobId,
    finished: false,
  } : null;
  return traceContext.run({ trace, current: trace?.root ?? null }, run);
}

export function startAgentPhase(name: 'runner.resolve' | 'model.execute' | 'result.validate' | 'job.publish'): Span | null {
  const context = traceContext.getStore();
  if (!context?.trace || context.trace.finished) return null;
  const span = startChildSpan(context.current ?? context.trace.root, `agent.${name}`, { spanKind: 'internal' });
  context.trace.phases.push({ span, status: 'ok', data: {}, ended: false });
  traceContext.enterWith({ trace: context.trace, current: span });
  return span;
}

export function finishAgentPhase(span: Span | null, status = 'ok'): void {
  const context = traceContext.getStore();
  if (!context?.trace || context.trace.finished || !span) return;
  const phase = context.trace.phases.find((item) => item.span === span);
  if (!phase || phase.ended) return;
  phase.ended = true;
  phase.status = status;
  span.durationMs = Math.max(0, Math.round((performance.now() - span.startedAt) * 100) / 100);
  if (context.current?.spanId === span.spanId) {
    traceContext.enterWith({ trace: context.trace, current: context.trace.root });
  }
}

export function currentAgentTraceparent(): string | null {
  const context = traceContext.getStore();
  return context?.trace && !context.trace.finished && context.current ? traceparent(context.current) : null;
}

function safeApiRoute(pathname: string): string {
  const apiIndex = pathname.indexOf('/api/v1/');
  if (apiIndex < 0) return '/external';
  const path = pathname.slice(apiIndex);
  if (path === '/api/v1/jobs') return path;
  if (path === '/api/v1/jobs/claim') return path;
  if (/^\/api\/v1\/jobs\/[^/]+\/(?:heartbeat|complete|fail)$/.test(path)) {
    return path.replace(/^\/api\/v1\/jobs\/[^/]+/, '/api/v1/jobs/:id');
  }
  if (/^\/api\/v1\/jobs\/[^/]+$/.test(path)) return '/api/v1/jobs/:id';
  if (path === '/api/v1/artifacts') return path;
  if (/^\/api\/v1\/artifacts\/[^/]+$/.test(path)) return '/api/v1/artifacts/:id';
  if (path === '/api/v1/agents/register' || path === '/api/v1/agents/me') return path;
  return '/api/v1/other';
}

function enqueueSpan(span: Span, status: string, data: Record<string, unknown>): void {
  const telemetry = config();
  if (!telemetry.code) return;
  queue.enqueue(() => recordSpan(telemetry, span, status, data, { timeoutMs: TELEMETRY_TIMEOUT_MS }));
}

/** Client spans send only stable API route templates and never retain URL/query values. */
export async function fetchWithAgentTelemetry(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const telemetry = config();
  const fetcher = globalThis.fetch;
  if (!telemetry.code || !fetcher) return fetcher(input, init);
  const url = new URL(input.toString());
  const method = (init.method || 'GET').toUpperCase();
  const route = safeApiRoute(url.pathname);
  const context = traceContext.getStore();
  const parent = context?.trace && !context.trace.finished ? context.current ?? context.trace.root : undefined;
  const span = startChildSpan(parent, `http.client ${method} ${route}`, { spanKind: 'client' });
  const headers = new Headers(init.headers);
  headers.set('traceparent', traceparent(span));
  try {
    const response = await fetcher(input, { ...init, headers });
    span.durationMs = Math.max(0, Math.round((performance.now() - span.startedAt) * 100) / 100);
    enqueueSpan(span, response.status >= 500 ? 'error' : 'ok', {
      'http.method': method,
      'http.route': route,
      'http.status_code': response.status,
    });
    return response;
  } catch (error) {
    span.durationMs = Math.max(0, Math.round((performance.now() - span.startedAt) * 100) / 100);
    enqueueSpan(span, 'error', {
      'http.method': method,
      'http.route': route,
      'error.type': exceptionType(error),
    });
    throw error;
  }
}

export function finishAgentTrace(
  status: 'completed' | 'failed' | 'cancelled' | 'lease_lost',
  data: { backend?: string | null; error?: unknown; gitSha?: string },
): void {
  const context = traceContext.getStore();
  const trace = context?.trace;
  traceContext.enterWith({ trace: null, current: null });
  if (!trace || trace.finished) return;
  trace.finished = true;
  const telemetry = config();
  if (!telemetry.code) return;

  for (const phase of trace.phases) {
    if (!phase.ended) finishPhase(phase);
  }
  trace.root.durationMs = Math.max(0, Math.round((performance.now() - trace.root.startedAt) * 100) / 100);
  const failed = status === 'failed' || status === 'lease_lost';
  const items: SpanBatchItem[] = [
    {
      span: trace.root,
      status: failed ? 'error' : status === 'cancelled' ? 'cancelled' : 'ok',
      data: {
        'waveworld.job_id': trace.jobId,
        'waveworld.job_kind': trace.kind,
        ...(data.backend ? { 'waveworld.backend': data.backend } : {}),
        ...(data.gitSha ? { 'service.version': data.gitSha } : {}),
      },
    },
    ...trace.phases.map((phase) => ({ span: phase.span, status: phase.status, data: phase.data })),
  ];
  queue.enqueue(() => recordSpans(telemetry, items, { timeoutMs: TELEMETRY_TIMEOUT_MS }));

  if (failed) {
    const type = exceptionType(data.error);
    const safeError = new Error(type);
    safeError.name = type;
    queue.enqueue(() => captureError(telemetry, safeError, {
      exceptionType: type,
      stack: '',
      handled: true,
      severity: 'error',
      context: {
        operation: 'agent.run',
        'waveworld.job_kind': trace.kind,
        ...(data.backend ? { 'waveworld.backend': data.backend } : {}),
        trace_id: trace.root.traceId,
        span_id: trace.root.spanId,
        traceparent: traceparent(trace.root),
      },
      timeoutMs: TELEMETRY_TIMEOUT_MS,
    }));
  }
}

function finishPhase(phase: PhaseSpan): void {
  phase.ended = true;
  phase.status = 'error';
  phase.span.durationMs = Math.max(0, Math.round((performance.now() - phase.span.startedAt) * 100) / 100);
}
