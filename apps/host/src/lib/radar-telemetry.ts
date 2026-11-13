import { AsyncLocalStorage } from 'node:async_hooks';
import {
  captureError,
  configFromEnv,
  parseTraceparent,
  recordSpan,
  startSpan,
  traceparent,
  type Span,
} from '@w/xradar';

const MAX_PENDING_TELEMETRY = 128;
const MAX_CONCURRENT_TELEMETRY = 8;
const TELEMETRY_TIMEOUT_MS = 2000;

type Work = () => Promise<void>;

/** Bounded fail-open delivery queue. It never waits on the application path. */
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

interface RequestTelemetryContext {
  span: Span;
  method?: string;
  route?: string;
  operation?: string;
  errorCaptured: boolean;
}

const requestContext = new AsyncLocalStorage<RequestTelemetryContext>();
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
    SERVICE_NAME: process.env.SERVICE_NAME?.trim() || 'waveworld-host',
  });
}

function exceptionType(error: unknown): string {
  if (!(error instanceof Error)) return 'ApplicationError';
  const name = error.name;
  return new Set([
    'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
    'HttpError', 'AuthError', 'AbortError', 'TimeoutError',
  ]).has(name) ? name : 'ApplicationError';
}

function enqueueSpan(span: Span, status: string, data: Record<string, unknown>): void {
  const telemetry = config();
  if (!telemetry.code) return;
  queue.enqueue(() => recordSpan(telemetry, span, status, data, { timeoutMs: TELEMETRY_TIMEOUT_MS }));
}

/** Capture exception class and fixed route context only; never message or stack. */
export function captureRadarException(error: unknown, statusCode = 500): void {
  if (statusCode < 500) return;
  const telemetry = config();
  if (!telemetry.code) return;
  const context = requestContext.getStore();
  if (context) context.errorCaptured = true;
  const type = exceptionType(error);
  const safeError = new Error(type);
  safeError.name = type;
  queue.enqueue(() => captureError(telemetry, safeError, {
    exceptionType: type,
    stack: '',
    handled: true,
    severity: 'error',
    context: {
      ...(context ? { 'http.method': context.method, 'http.route': context.route } : {}),
      ...(context?.operation ? { operation: context.operation } : {}),
      'http.status_code': statusCode,
      ...(context ? { trace_id: context.span.traceId, span_id: context.span.spanId, traceparent: traceparent(context.span) } : {}),
    },
    timeoutMs: TELEMETRY_TIMEOUT_MS,
  }));
}

/** Measure a real Host-side operation; timer-driven work stays independently rooted. */
export async function withRadarOperation<T>(
  operation: 'wcompute.quote' | 'wcompute.create' | 'wcompute.stage.instance' | 'wcompute.stage.upload' |
    'wcompute.stage.commit' | 'wcompute.run.poll' | 'wcompute.collect.download' | 'wcompute.stop.inspect' |
    'wcompute.stop.request',
  run: () => Promise<T>,
  expectedError: (error: unknown) => boolean = () => false,
): Promise<T> {
  const telemetry = config();
  if (!telemetry.code) return run();

  const parentContext = requestContext.getStore();
  const span = startSpan(operation, { spanKind: 'internal', parent: parentContext?.span });
  const context: RequestTelemetryContext = {
    span,
    ...(parentContext?.method ? { method: parentContext.method } : {}),
    ...(parentContext?.route ? { route: parentContext.route } : {}),
    operation,
    errorCaptured: false,
  };
  return requestContext.run(context, async () => {
    try {
      const result = await run();
      finishOperation(context, 'ok');
      return result;
    } catch (error) {
      const expected = expectedError(error);
      finishOperation(context, expected ? 'ok' : 'error');
      throw error;
    }
  });
}

/** Wrap an explicit Node route boundary using a stable route template. */
export function withRadarRoute<TArgs extends unknown[]>(
  method: string,
  route: string,
  handler: (request: Request, ...args: TArgs) => Promise<Response> | Response,
): (request: Request, ...args: TArgs) => Promise<Response> {
  return async (request, ...args) => {
    const telemetry = config();
    if (!telemetry.code) return handler(request, ...args);

    const span = startSpan(`http.server ${method} ${route}`, {
      spanKind: 'server',
      parent: parseTraceparent(request.headers.get('traceparent')),
    });
    const context: RequestTelemetryContext = { span, method, route, errorCaptured: false };
    return requestContext.run(context, async () => {
      let response: Response;
      try {
        response = await handler(request, ...args);
      } catch (error) {
        finishRequest(context, 500);
        captureRadarException(error);
        throw error;
      }

      finishRequest(context, response.status);
      if (response.status >= 500 && !context.errorCaptured) {
        captureRadarException(new Error('HttpServerError'), response.status);
      }
      return response;
    });
  };
}

function finishRequest(context: RequestTelemetryContext, statusCode: number): void {
  context.span.durationMs = Math.max(0, Math.round((performance.now() - context.span.startedAt) * 100) / 100);
  enqueueSpan(context.span, statusCode >= 500 ? 'error' : 'ok', {
    'http.method': context.method,
    'http.route': context.route,
    'http.status_code': statusCode,
  });
}

function finishOperation(context: RequestTelemetryContext, status: string): void {
  context.span.durationMs = Math.max(0, Math.round((performance.now() - context.span.startedAt) * 100) / 100);
  enqueueSpan(context.span, status, { operation: context.operation });
}
