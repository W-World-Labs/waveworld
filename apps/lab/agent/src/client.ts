import { createHash } from 'node:crypto';
import { MAX_MODEL_GEOMETRY_BYTES, isModelGeometryContentType, modelGeometryContentType } from '../../src/lib/models/geometry-contract.ts';
import { encodeFlowSnapshot, encodeFlowSequence, compressSequenceBlob, quantizedFlowFrameBytes, FLOW_SNAPSHOT_KIND, FLOW_SEQUENCE_KIND, FLOW_SEQUENCE_CONTENT_TYPE, flowSnapshotContentType, FLOW_SEQUENCE_BATCH_BYTES, type LbmDisplaySnapshot } from '../../src/lib/cfd/flow-snapshot.ts';
import { encodeMacFlowSnapshot, encodeMacFlowSequence, macFlowFrameBytes, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SEQUENCE_KIND, MAC_FLOW_SEQUENCE_CONTENT_TYPE, MAC_FLOW_SNAPSHOT_CONTENT_TYPE, type MacFlowSnapshot } from '../../src/lib/cfd/mac-flow-snapshot.ts';
import type { JobResultArtifact } from '@w-sim/contracts';
import type {
  AgentCapabilities,
  JobRecord,
  JobResultV1,
  JobSpecV1,
  JobProgress,
} from '../../src/types/task.ts';
import { fetchWithAgentTelemetry } from './radar-telemetry.ts';
import { readJobHostOutcome, type JobHostOutcome } from '@w-sim/runtime';

/**
 * Client-side reject of obviously invalid JobSpec before POST /jobs.
 * Host remains authoritative; this only prevents silent bad payloads (honesty residual).
 */
export function assertSubmitableJobSpec(spec: unknown): asserts spec is JobSpecV1 {
  if (spec == null || typeof spec !== 'object') {
    throw new Error('submit validation: spec required');
  }
  const s = spec as Record<string, unknown>;
  if (s.schemaVersion !== 1) {
    throw new Error('submit validation: schemaVersion must be 1');
  }
  if (typeof s.kind !== 'string' || s.kind.length === 0) {
    throw new Error('submit validation: kind required');
  }
  const run = s.run;
  if (run == null || typeof run !== 'object') {
    throw new Error('submit validation: run required');
  }
  const maxSteps = (run as { maxSteps?: unknown }).maxSteps;
  if (typeof maxSteps !== 'number' || !Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    throw new Error('submit validation: run.maxSteps must be a positive safe integer');
  }
}

/**
 * Default per-request timeout for control-plane HTTP calls (claim/complete/
 * fail/register/me/submit/getJob). Artifact upload/download + heartbeat already
 * bound at 30s; the remaining remote calls must not hang a leased job or the
 * CLI forever on a stalled connection (workspace rule: remote calls need
 * timeouts; retries stay bounded by the claim-loop poll cycle, ≤2 elsewhere;
 * artifact uploads have their own bounded retry, TRANSIENT_REQUEST_RETRY_DELAYS_MS).
 */
export const CONTROL_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Bounded retry schedule for artifact transfers. Terminal writes are never
 * retried; ambiguous results are reconciled through the per-attempt receipt.
 */
export const TRANSIENT_REQUEST_RETRY_DELAYS_MS = [250, 1500] as const;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Transient = worth one more attempt: undici network failures (TypeError)
 * and our own request-timeout aborts (DOMException AbortError/TimeoutError
 * while the *caller* signal is still live). A caller abort or any other
 * error is definitive — never pile onto a cancelled job.
 */
function isTransientRequestError(err: unknown, callerSignal?: AbortSignal): boolean {
  if (callerSignal?.aborted) return false;
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true;
  return false;
}

export class TaskApiClient {
  constructor(
    public baseUrl: string,
    public token?: string,
    /** Operator / registration key for x-api-key (submit + register in production). */
    public apiKey?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Caller abort signal composed with the default control-plane timeout so a
   * hung remote still fails fast; an already-aborted caller signal wins.
   */
  private controlSignal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private headers(json = true): HeadersInit {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.apiKey) h['x-api-key'] = this.apiKey;
    return h;
  }

  /**
   * One artifact POST with bounded transient retry. A single dropped upload
   * used to fail a job whose compute already ran (retryable → full
   * recompute). Each attempt re-heartbeats the lease first; definitive 4xx
   * and caller aborts never retry, while network errors, the client's own
   * request timeout and 5xx/408/429 do — a stray duplicate row from a
   * false-negative 5xx is cheaper than a discarded run (terminal GC
   * reclaims it).
   */
  private async postArtifact(
    jobId: string,
    kind: string,
    contentType: string,
    body: ArrayBuffer,
    signal: AbortSignal | undefined,
    errPrefix: string,
  ): Promise<{ id: string; bytes: number; kind: string; contentType: string; sha256?: string }> {
    for (let attempt = 0; ; attempt++) {
      // Consecutive frame uploads (and retries) can outlast a lease without
      // solver progress — re-verify ownership before each attempt.
      await this.heartbeat(jobId, undefined, signal);
      signal?.throwIfAborted();
      try {
        const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/artifacts`, {
          method: 'POST',
          headers: { ...this.headers(false), 'Content-Type': contentType, 'X-Artifact-Kind': kind, 'X-Job-Id': jobId },
          body: contentType === 'application/json'
            ? JSON.stringify({ jobId, kind, contentType, base64: Buffer.from(body).toString('base64') })
            : body,
          signal: this.controlSignal(signal),
        });
        if (!res.ok) {
          const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
          if (retryable && attempt < TRANSIENT_REQUEST_RETRY_DELAYS_MS.length) {
            await sleepMs(TRANSIENT_REQUEST_RETRY_DELAYS_MS[attempt]);
            signal?.throwIfAborted();
            continue;
          }
          throw new Error(`${errPrefix}: HTTP ${res.status}`);
        }
        const { artifact } = await res.json() as { artifact?: { id: string; bytes: number; kind: string; contentType: string; sha256?: string } };
        if (!artifact?.id || artifact.kind !== kind || artifact.contentType !== contentType || artifact.bytes !== body.byteLength) {
          throw new Error('invalid artifact response');
        }
        return artifact;
      } catch (err) {
        if (attempt >= TRANSIENT_REQUEST_RETRY_DELAYS_MS.length || !isTransientRequestError(err, signal)) throw err;
        await sleepMs(TRANSIENT_REQUEST_RETRY_DELAYS_MS[attempt]);
        signal?.throwIfAborted();
      }
    }
  }

  async uploadFlowSnapshot(jobId: string, snapshot: LbmDisplaySnapshot | MacFlowSnapshot, signal?: AbortSignal): Promise<JobResultArtifact> {
    signal?.throwIfAborted();
    const mac = 'fields' in snapshot;
    const kind = mac ? MAC_FLOW_SNAPSHOT_KIND : FLOW_SNAPSHOT_KIND;
    const contentType = mac ? MAC_FLOW_SNAPSHOT_CONTENT_TYPE : flowSnapshotContentType(snapshot);
    const body = mac ? encodeMacFlowSnapshot(snapshot) : encodeFlowSnapshot(snapshot);
    const artifact = await this.postArtifact(jobId, kind, contentType, body, signal, 'flow upload failed');
    return { artifactId: artifact.id, bytes: artifact.bytes, kind: artifact.kind, contentType: artifact.contentType, step: snapshot.step };
  }

  /** One artifact carrying a batch of render-quantized frames; cuts per-frame request overhead. */
  async uploadFlowSequence(jobId: string, frames: (LbmDisplaySnapshot | MacFlowSnapshot)[], signal?: AbortSignal): Promise<JobResultArtifact> {
    if (!frames.length) throw new Error('flow sequence requires at least one frame');
    signal?.throwIfAborted();
    const mac = 'fields' in frames[0]!;
    const kind = mac ? MAC_FLOW_SEQUENCE_KIND : FLOW_SEQUENCE_KIND;
    const contentType = mac ? MAC_FLOW_SEQUENCE_CONTENT_TYPE : FLOW_SEQUENCE_CONTENT_TYPE;
    const body = await compressSequenceBlob(mac ? encodeMacFlowSequence(frames as MacFlowSnapshot[]) : encodeFlowSequence(frames as LbmDisplaySnapshot[]));
    const artifact = await this.postArtifact(jobId, kind, contentType, body, signal, 'flow sequence upload failed');
    return { artifactId: artifact.id, bytes: artifact.bytes, kind: artifact.kind, contentType: artifact.contentType };
  }

  /** Persist scalar solver output through the existing leased-job artifact endpoint. */
  async uploadArtifact(jobId: string, kind: string, contentType: string, data: ArrayBuffer, signal?: AbortSignal): Promise<JobResultArtifact & { sha256: string }> {
    const artifact = await this.postArtifact(jobId, kind, contentType, data, signal, 'result artifact upload failed');
    const sha256 = createHash('sha256').update(new Uint8Array(data)).digest('hex');
    if (artifact.sha256 !== sha256) throw new Error('result artifact upload integrity check failed');
    return { artifactId: artifact.id, bytes: artifact.bytes, kind: artifact.kind, contentType: artifact.contentType, sha256 };
  }

  async downloadModel(artifactId: string, jobId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    // Bounded transient retry (same policy as postArtifact): a dropped GET
    // mid-run used to fail the job → lease-expiry requeue + full recompute.
    // The whole GET restarts per attempt; sha256/content-type/size checks
    // still gate each attempt and definitive 4xx/caller-abort never retry.
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/artifacts/${encodeURIComponent(artifactId)}?jobId=${encodeURIComponent(jobId)}`, {
          headers: this.headers(false), redirect: 'error',
          signal: this.controlSignal(signal),
        });
        if (!res.ok) {
          const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
          if (retryable && attempt < TRANSIENT_REQUEST_RETRY_DELAYS_MS.length) {
            await sleepMs(TRANSIENT_REQUEST_RETRY_DELAYS_MS[attempt]);
            signal?.throwIfAborted();
            continue;
          }
          throw new Error(`model download failed: HTTP ${res.status}`);
        }
        if (!isModelGeometryContentType(res.headers.get('content-type')?.split(';')[0])) throw new Error('invalid model artifact content type');
        const max = MAX_MODEL_GEOMETRY_BYTES;
        const reader = res.body?.getReader();
        if (!reader) throw new Error('model artifact body missing');
        const parts: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > max) throw new Error('model artifact exceeds geometry byte limit');
            parts.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const data = Buffer.concat(parts, bytes);
        const sha256 = res.headers.get('x-artifact-sha256');
        if (!sha256 || createHash('sha256').update(data).digest('hex') !== sha256) throw new Error('model artifact integrity check failed');
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        if (modelGeometryContentType(buffer) !== res.headers.get('content-type')!.split(';')[0]) throw new Error('model artifact content type does not match its header');
        return buffer;
      } catch (err) {
        if (attempt >= TRANSIENT_REQUEST_RETRY_DELAYS_MS.length || !isTransientRequestError(err, signal)) throw err;
        await sleepMs(TRANSIENT_REQUEST_RETRY_DELAYS_MS[attempt]);
        signal?.throwIfAborted();
      }
    }
  }

  async register(name: string, capabilities?: AgentCapabilities, registrationKey?: string) {
    const headers = this.headers() as Record<string, string>;
    if (registrationKey) headers['x-api-key'] = registrationKey;
    const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/agents/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, capabilities }),
      signal: this.controlSignal(),
    });
    if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as {
      agent: { id: string; name: string; capabilities: AgentCapabilities };
      token: string;
    };
  }

  async me() {
    const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/agents/me`, {
      headers: this.headers(false),
      signal: this.controlSignal(),
    });
    if (!res.ok) throw new Error(`me failed: ${res.status}`);
    return res.json();
  }

  async updateCapabilities(capabilities: AgentCapabilities) {
    const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/agents/me`, {
      method: 'PUT', headers: this.headers(), body: JSON.stringify({ capabilities }),
      signal: this.controlSignal(),
    });
    if (!res.ok) throw new Error(`capability update failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async submitJob(spec: JobSpecV1, priority = 0) {
    assertSubmitableJobSpec(spec);
    const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ spec, priority }),
      signal: this.controlSignal(),
    });
    if (!res.ok) throw new Error(`submit failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as { job: JobRecord };
  }

  async claim(): Promise<JobRecord | null> {
    const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/jobs/claim`, {
      method: 'POST',
      headers: this.headers(),
      body: '{}',
      signal: this.controlSignal(),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`claim failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { job: JobRecord };
    return data.job;
  }

  async heartbeat(jobId: string, progress?: Partial<JobProgress>, signal?: AbortSignal) {
    const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/jobs/${jobId}/heartbeat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ progress }),
      signal: this.controlSignal(signal),
    });
    if (!res.ok) throw new Error(`heartbeat failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as { job: JobRecord };
  }

  async complete(jobId: string, result: JobResultV1, attempt: number): Promise<JobHostOutcome> {
    return this.settleTerminal(jobId, attempt, 'complete', { result, attempt });
  }

  async fail(jobId: string, error: string, attempt: number, retryable = true): Promise<JobHostOutcome> {
    return this.settleTerminal(jobId, attempt, 'fail', {
      error, retryable, attempt,
    });
  }

  private async settleTerminal(
    jobId: string,
    attempt: number,
    action: 'complete' | 'fail',
    body: Record<string, unknown>,
  ): Promise<JobHostOutcome> {
    if (!Number.isSafeInteger(attempt) || attempt < 0) {
      throw new Error('terminal settlement requires a nonnegative safe-integer claim attempt');
    }
    let writeError: unknown;
    let shouldReconcile = false;
    let responseReceived = false;
    try {
      const response = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/${action}`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: this.controlSignal(),
      });
      responseReceived = true;
      if (response.ok) {
        try {
          return readJobHostOutcome(await response.json(), jobId);
        } catch (error) {
          writeError = error;
          shouldReconcile = true;
        }
      } else {
        shouldReconcile = response.status === 409 || response.status === 408 || response.status === 429 || response.status >= 500;
        if (!shouldReconcile) throw new Error(`${action} failed: HTTP ${response.status} ${await response.text()}`);
        writeError = new Error(`${action} failed: HTTP ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      if (!shouldReconcile) {
        // A request transport failure has no HTTP response and may have reached
        // Host; validation/auth 4xx above are definitive and escape directly.
        if (responseReceived) throw error;
        writeError = error;
        shouldReconcile = true;
      }
    }
    if (!shouldReconcile) throw writeError ?? new Error(`${action} acknowledgement unavailable`);

    let lastReadError: unknown = writeError;
    for (let retry = 0; retry <= TRANSIENT_REQUEST_RETRY_DELAYS_MS.length; retry++) {
      if (retry > 0) await sleepMs(TRANSIENT_REQUEST_RETRY_DELAYS_MS[retry - 1]!);
      try {
        const receipt = await fetchWithAgentTelemetry(
          `${this.baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/outcome?attempt=${attempt}`,
          { headers: this.headers(false), signal: AbortSignal.timeout(10_000), cache: 'no-store', redirect: 'error' },
        );
        if (receipt.status === 404) {
          lastReadError = new Error('Host has no receipt for this agent lease attempt');
          continue;
        }
        if (!receipt.ok) {
          lastReadError = new Error(`Host outcome read failed: HTTP ${receipt.status}`);
          if (receipt.status >= 500 || receipt.status === 408 || receipt.status === 429) continue;
          break;
        }
        const data = await receipt.json() as { attempt?: unknown; outcome?: unknown };
        if (data.attempt !== attempt) throw new Error(`Host outcome receipt attempt mismatch for job ${jobId}`);
        return readJobHostOutcome(data.outcome, jobId);
      } catch (error) {
        lastReadError = error;
      }
    }
    throw new Error(`${action} outcome unresolved for job ${jobId} attempt ${attempt}`, {
      cause: new AggregateError([writeError, lastReadError].filter((error): error is NonNullable<typeof error> => error != null)),
    });
  }

  async getJob(jobId: string) {
    const res = await fetchWithAgentTelemetry(`${this.baseUrl}/api/v1/jobs/${jobId}`, {
      signal: this.controlSignal(),
    });
    if (!res.ok) throw new Error(`getJob failed: ${res.status}`);
    return (await res.json()) as { job: JobRecord };
  }
}

/**
 * Buffers flow frames and uploads them as one sequence artifact per
 * ~FLOW_SEQUENCE_BATCH_BYTES; removes the per-frame heartbeat+POST round
 * trips that dominate remote runs on high-latency links.
 */
export function createBufferedFlowUpload(client: TaskApiClient, jobId: string) {
  let pending: (LbmDisplaySnapshot | MacFlowSnapshot)[] = [];
  let pendingBytes = 0;
  const flush = async (signal?: AbortSignal): Promise<JobResultArtifact[]> => {
    if (!pending.length) return [];
    const frames = pending;
    pending = [];
    pendingBytes = 0;
    return [await client.uploadFlowSequence(jobId, frames, signal)];
  };
  return {
    /** Buffers the frame; returns an artifact only when the batch flushed. */
    add: async (snapshot: LbmDisplaySnapshot | MacFlowSnapshot, signal?: AbortSignal): Promise<JobResultArtifact | null> => {
      pending.push(snapshot);
      pendingBytes += 'fields' in snapshot ? macFlowFrameBytes(snapshot) : quantizedFlowFrameBytes(snapshot);
      if (pendingBytes >= FLOW_SEQUENCE_BATCH_BYTES) return (await flush(signal))[0] ?? null;
      return null;
    },
    flush,
  };
}
