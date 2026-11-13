/**
 * Browser / Lab settlement client implementing `@w-sim/kit` SettlementClient.
 * Posts to WaveWorld Host using the shared JobSpecV1 wire format.
 */

import type { JobSpecV1, JobResultV1, JobProgress, JobResultArtifact } from '@w-sim/contracts'
import { readJobHostOutcome, type JobHostOutcome } from '@w-sim/runtime'
import type { SettlementClient } from '@w-sim/kit'
import { resolveHostApiBase } from '../../../../../src/lib/labEntry'
import type { ModelGeometry } from '../../types/model'
import { encodeModelGeometry, MODEL_GEOMETRY_ARTIFACT_KIND, MODEL_GEOMETRY_CONTENT_TYPE } from '../models/geometry-contract'
import { decodeFlowSnapshot, decodeFlowSequence, decompressSequenceBlob, encodeFlowSequence, compressSequenceBlob, FLOW_SNAPSHOT_KIND, FLOW_SEQUENCE_KIND, FLOW_SEQUENCE_CONTENT_TYPE, flowSnapshotContentType, isFlowSnapshotContentType, MAX_FLOW_SNAPSHOT_BYTES, type LbmDisplaySnapshot } from '../cfd/flow-snapshot'
import { decodeMacFlowSnapshot, decodeMacFlowSequence, encodeMacFlowSequence, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SEQUENCE_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE, MAC_FLOW_SEQUENCE_CONTENT_TYPE, type MacFlowSnapshot } from '../cfd/mac-flow-snapshot'

export type CreateSettlementClientOptions = {
  /** Override Host base URL; browser default stays on same-origin ingress. */
  baseUrl?: string
  /** Path prefix, default `/api/v1/jobs` */
  jobsPath?: string
  fetchImpl?: typeof fetch
}

export class TaskLoginRequiredError extends Error {
  constructor() { super('发布计算任务需要登录；本机模拟可直接使用。') }
}

export type BrowserJobUpdate = { jobId: string; status: 'running' } | JobHostOutcome

/**
 * Build a SettlementClient for Lab UI → Host jobs plane.
 * Both browser preview submit and future high-precision batch use JobSpecV1.
 */
export function createSettlementClient(
  opts: CreateSettlementClientOptions = {},
): Required<SettlementClient> & {
  requireUser(signal: AbortSignal): Promise<void>
  uploadModel(geometry: ModelGeometry, signal: AbortSignal): Promise<string>
  downloadFlowSnapshot(artifact: JobResultArtifact, signal: AbortSignal): Promise<LbmDisplaySnapshot | MacFlowSnapshot>
  /** Single-frame or batched sequence artifact → decoded frames in order. */
  downloadFlowFrames(artifact: JobResultArtifact, signal: AbortSignal): Promise<(LbmDisplaySnapshot | MacFlowSnapshot)[]>
  submitBrowser(spec: JobSpecV1): Promise<{ id: string; agentId: string; attempt: number }>
  uploadBrowserFlow(jobId: string, agentId: string, data: ArrayBuffer, signal: AbortSignal,
    kind?: typeof FLOW_SNAPSHOT_KIND | typeof MAC_FLOW_SNAPSHOT_KIND): Promise<JobResultArtifact>
  /** One artifact carrying a batch of render-quantized frames (WVS1/WVZ1). */
  uploadBrowserFlowSequence(jobId: string, agentId: string, frames: (LbmDisplaySnapshot | MacFlowSnapshot)[], signal: AbortSignal): Promise<JobResultArtifact>
  updateBrowser(jobId: string, agentId: string, action: 'heartbeat' | 'complete' | 'fail', body: unknown): Promise<BrowserJobUpdate>
} {
  const base = (opts.baseUrl ?? (typeof window === 'undefined' ? '' : resolveHostApiBase(window.location))).replace(/\/$/, '')
  const jobsPath = opts.jobsPath ?? '/api/v1/jobs'
  const fetchImpl = opts.fetchImpl ?? fetch
  const f: typeof fetch = (url, init) => fetchImpl(url, { credentials: 'include', ...init })

  async function downloadArtifactBytes(artifact: JobResultArtifact, contentType: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const res = await f(`${base}/api/v1/artifacts/${encodeURIComponent(artifact.artifactId)}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    if (!res.ok) throw new Error(`流场下载失败 HTTP ${res.status}`)
    if (res.headers.get('content-type')?.split(';')[0] !== contentType) throw new Error('流场文件类型无效')
    const reader = res.body?.getReader()
    if (!reader) throw new Error('流场文件内容缺失')
    const buffer = new ArrayBuffer(artifact.bytes)
    const bytes = new Uint8Array(buffer)
    let offset = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (offset + value.byteLength > bytes.length) throw new Error('流场文件超出声明大小')
        bytes.set(value, offset); offset += value.byteLength
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    if (offset !== bytes.length) throw new Error('流场文件不完整')
    const hash = await crypto.subtle.digest('SHA-256', buffer)
    const hex = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('')
    if (hex !== res.headers.get('x-artifact-sha256')) throw new Error('流场文件校验失败')
    return buffer
  }

  return {
    async requireUser(signal) {
      const res = await f(`${base}/api/v1/me`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: 'no-store', redirect: 'error' })
      if (res.status === 401) throw new TaskLoginRequiredError()
      if (!res.ok) throw new Error(`登录状态检查失败 HTTP ${res.status}`)
    },
    async uploadBrowserFlow(jobId, agentId, data, signal, kind = FLOW_SNAPSHOT_KIND) {
      signal.throwIfAborted()
      const mac = kind === MAC_FLOW_SNAPSHOT_KIND
      const snapshot = mac ? decodeMacFlowSnapshot(data) : decodeFlowSnapshot(data)
      const contentType = 'fields' in snapshot ? MAC_FLOW_SNAPSHOT_CONTENT_TYPE : flowSnapshotContentType(snapshot)
      const res = await f(`${base}/api/v1/artifacts`, {
        method: 'POST', headers: { 'Content-Type': contentType, 'x-artifact-kind': kind,
          'x-job-id': jobId, 'x-browser-agent': agentId }, body: data,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: 'error', cache: 'no-store',
      })
      if (!res.ok) throw new Error(`flow upload failed HTTP ${res.status}`)
      const { artifact } = await res.json() as { artifact: { id: string; bytes: number; kind: string; contentType: string } }
      if (!artifact?.id || artifact.bytes !== data.byteLength || artifact.kind !== kind || artifact.contentType !== contentType) throw new Error('Invalid saved flow artifact')
      return { artifactId: artifact.id, bytes: artifact.bytes, kind: artifact.kind, contentType: artifact.contentType, step: snapshot.step }
    },
    async uploadBrowserFlowSequence(jobId, agentId, frames, signal) {
      signal.throwIfAborted()
      if (!frames.length) throw new Error('flow sequence requires at least one frame')
      const mac = 'fields' in frames[0]!
      const kind = mac ? MAC_FLOW_SEQUENCE_KIND : FLOW_SEQUENCE_KIND
      const contentType = mac ? MAC_FLOW_SEQUENCE_CONTENT_TYPE : FLOW_SEQUENCE_CONTENT_TYPE
      const data = await compressSequenceBlob(mac ? encodeMacFlowSequence(frames as MacFlowSnapshot[]) : encodeFlowSequence(frames as LbmDisplaySnapshot[]))
      const res = await f(`${base}/api/v1/artifacts`, {
        method: 'POST', headers: { 'Content-Type': contentType, 'x-artifact-kind': kind,
          'x-job-id': jobId, 'x-browser-agent': agentId }, body: data,
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), redirect: 'error', cache: 'no-store',
      })
      if (!res.ok) throw new Error(`flow sequence upload failed HTTP ${res.status}`)
      const { artifact } = await res.json() as { artifact: { id: string; bytes: number; kind: string; contentType: string } }
      if (!artifact?.id || artifact.bytes !== data.byteLength || artifact.kind !== kind || artifact.contentType !== contentType) throw new Error('Invalid saved flow sequence artifact')
      return { artifactId: artifact.id, bytes: artifact.bytes, kind: artifact.kind, contentType: artifact.contentType }
    },
    async submitBrowser(spec) {
      const res = await f(`${base}${jobsPath}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, execution: 'browser' }),
        signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store',
      })
      if (res.status === 401) throw new TaskLoginRequiredError()
      if (!res.ok) throw new Error(`browser submit failed HTTP ${res.status}`)
      const { job } = await res.json() as { job: { id: string; agentId: string; status: string; attempt: number } }
      if (!job?.id || !job.agentId?.startsWith('browser-') || job.status !== 'leased' ||
          !Number.isSafeInteger(job.attempt) || job.attempt < 0) throw new Error('Invalid browser job lease')
      return job
    },
    async updateBrowser(jobId, agentId, action, body) {
      const url = `${base}${jobsPath}/${encodeURIComponent(jobId)}/${action}`
      let response: Response | undefined
      let writeError: unknown
      try {
        response = await f(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-browser-agent': agentId },
          body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store',
        })
      } catch (error) {
        if (action === 'heartbeat') throw error
        writeError = error
      }
      if (response && !response.ok) {
        if (action === 'heartbeat' || ![408, 409, 429].includes(response.status) && response.status < 500) {
          throw new Error(`browser ${action} failed HTTP ${response.status}`)
        }
        writeError = new Error(`browser ${action} failed HTTP ${response.status}`)
      }
      if (response?.ok) {
        let data: unknown
        try { data = await response.json() }
        catch (error) { writeError = error }
        if (data !== undefined) {
      if (!data || typeof data !== 'object' || !('job' in data) || !data.job || typeof data.job !== 'object') {
            if (action === 'heartbeat') throw new Error(`Invalid Host acknowledgement for job ${jobId}`)
            writeError = new Error(`Invalid Host acknowledgement for job ${jobId}`)
          } else {
            const job = data.job as Record<string, unknown>
            if (job.id !== jobId) {
              if (action === 'heartbeat') throw new Error(`Invalid Host acknowledgement for job ${jobId}`)
              writeError = new Error(`Invalid Host acknowledgement for job ${jobId}`)
            } else {
              if (action === 'heartbeat') {
                if (job.status !== 'running') throw new Error(`Invalid Host heartbeat state for job ${jobId}`)
                return { jobId, status: 'running' }
              }
              try {
                const outcome = readJobHostOutcome({ ...job, jobId }, jobId)
                if (outcome.status === 'succeeded') return { jobId, status: 'succeeded', result: outcome.result }
                if (outcome.status === 'failed') return { jobId, status: 'failed', error: outcome.error }
                return { jobId, status: outcome.status }
              } catch (error) { writeError = error }
            }
          }
        }
      }
      // A browser user may read the owner-visible current job record, unlike
      // an Agent-only per-attempt receipt. Never repeat the terminal write.
      const expectedAttempt = (body as { attempt?: unknown }).attempt
      if (action === 'heartbeat' || !Number.isSafeInteger(expectedAttempt) || (expectedAttempt as number) < 0) {
        throw new Error(`browser ${action} outcome unresolved for job ${jobId}: ${String(writeError)}`)
      }
      let lastError: unknown = writeError
      for (let retry = 0; retry <= 2; retry++) {
        if (retry) await new Promise(resolve => setTimeout(resolve, retry === 1 ? 250 : 1500))
        try {
          const receipt = await f(`${base}${jobsPath}/${encodeURIComponent(jobId)}`, {
            signal: AbortSignal.timeout(10_000), redirect: 'error', cache: 'no-store',
          })
          if (!receipt.ok) { lastError = new Error(`job reconciliation HTTP ${receipt.status}`); continue }
          const data: unknown = await receipt.json()
          if (!data || typeof data !== 'object' || !('job' in data) || !data.job || typeof data.job !== 'object') throw new Error('invalid Host job record')
          const job = data.job as Record<string, unknown>
          if (job.id !== jobId || job.attempt !== expectedAttempt) throw new Error('Host job identity or attempt mismatch')
          const outcome = readJobHostOutcome({ ...job, jobId }, jobId)
          if (outcome.status === 'succeeded') return { jobId, status: 'succeeded', result: outcome.result }
          if (outcome.status === 'failed') return { jobId, status: 'failed', error: outcome.error }
          return { jobId, status: outcome.status }
        } catch (error) { lastError = error }
      }
      throw new Error(`browser ${action} outcome unresolved for job ${jobId} attempt ${expectedAttempt}: ${String(lastError)}`)
    },
    async downloadFlowSnapshot(artifact, signal) {
      const frames = await this.downloadFlowFrames(artifact, signal)
      if (frames.length !== 1) throw new Error('流场文件应为单帧')
      return frames[0]!
    },
    async downloadFlowFrames(artifact, signal) {
      signal.throwIfAborted()
      const mac = artifact.kind === MAC_FLOW_SNAPSHOT_KIND || artifact.kind === MAC_FLOW_SEQUENCE_KIND
      const seq = artifact.kind === FLOW_SEQUENCE_KIND || artifact.kind === MAC_FLOW_SEQUENCE_KIND
      const contentType = artifact.contentType
      if ((mac ? (seq ? contentType !== MAC_FLOW_SEQUENCE_CONTENT_TYPE : contentType !== MAC_FLOW_SNAPSHOT_CONTENT_TYPE)
               : (seq ? artifact.kind !== FLOW_SEQUENCE_KIND || contentType !== FLOW_SEQUENCE_CONTENT_TYPE
                      : artifact.kind !== FLOW_SNAPSHOT_KIND || !isFlowSnapshotContentType(contentType))) ||
          (mac && !seq && (!Number.isSafeInteger(artifact.step) || artifact.step! < 1)) ||
          !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 32 || artifact.bytes > MAX_FLOW_SNAPSHOT_BYTES) throw new Error('流场文件信息无效')
      const buffer = await downloadArtifactBytes(artifact, contentType, signal)
      signal.throwIfAborted()
      if (seq) {
        const raw = await decompressSequenceBlob(buffer)
        return mac ? decodeMacFlowSequence(raw) : decodeFlowSequence(raw)
      }
      const snapshot = mac ? decodeMacFlowSnapshot(buffer) : decodeFlowSnapshot(buffer, contentType)
      if (artifact.step !== undefined && artifact.step !== snapshot.step) throw new Error('流场帧时刻与文件不一致')
      return [snapshot]
    },
    async uploadModel(geometry, signal) {
      signal.throwIfAborted()
      const res = await f(`${base}/api/v1/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': MODEL_GEOMETRY_CONTENT_TYPE, 'X-Artifact-Kind': MODEL_GEOMETRY_ARTIFACT_KIND },
        body: encodeModelGeometry(geometry),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      })
      if (res.status === 401) throw new TaskLoginRequiredError()
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `model upload failed HTTP ${res.status}`)
      }
      const data = await res.json() as { artifact?: { id?: string } }
      if (!data.artifact?.id) throw new Error('模型上传未返回 artifact id')
      return data.artifact.id
    },
    async submit(spec: JobSpecV1) {
      const res = await f(`${base}${jobsPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 401) throw new TaskLoginRequiredError()
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `submit failed HTTP ${res.status}`)
      }
      const data = (await res.json()) as { job: { id: string } }
      return { jobId: data.job.id }
    },

    async getStatus(jobId: string) {
      const res = await f(`${base}${jobsPath}/${encodeURIComponent(jobId)}`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`getStatus failed HTTP ${res.status}`)
      const data = (await res.json()) as {
        job: { status: string; progress?: JobProgress | null }
      }
      return {
        status: data.job.status,
        progress: data.job.progress ?? undefined,
      }
    },

    async getResult(jobId: string) {
      // Job detail carries the result on both Host and Lab's existing API surface.
      const res = await f(`${base}${jobsPath}/${encodeURIComponent(jobId)}`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`getResult failed HTTP ${res.status}`)
      const data = (await res.json()) as { job: { status: string; result?: JobResultV1 | null } }
      return data.job.status === 'succeeded' ? data.job.result ?? null : null
    },

    async cancel(jobId: string) {
      const res = await f(`${base}${jobsPath}/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST', signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`cancel failed HTTP ${res.status}`)
    },
  }
}

/** Run one submitted job, polling serially; abort cancels the acknowledged job. */
export class RemoteJobCancelError extends Error {
  constructor(readonly jobId: string, cause: unknown) {
    super(`未能确认任务 ${jobId} 已停止：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export async function runRemoteJob(
  client: Required<SettlementClient>,
  spec: JobSpecV1,
  options: {
    signal: AbortSignal
    onStatus?: (jobId: string, status: string, progress?: JobProgress) => void
    pollIntervalMs?: number
  },
): Promise<JobResultV1> {
  options.signal.throwIfAborted()
  // Keep submission alive until its id is known so a stop during submit can cancel it.
  const { jobId } = await client.submit(spec)
  let terminal = false
  try {
    options.onStatus?.(jobId, 'queued')
    options.signal.throwIfAborted()
    while (true) {
      options.signal.throwIfAborted()
      const { status, progress } = await client.getStatus(jobId)
      options.signal.throwIfAborted()
      options.onStatus?.(jobId, status, progress)
      if (status === 'succeeded') {
        terminal = true
        const result = await client.getResult(jobId)
        options.signal.throwIfAborted()
        if (!result) throw new Error(`任务 ${jobId} 已完成，但结果不可用`)
        if (result.error) throw new Error(result.error)
        return result
      }
      if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
        terminal = true
        throw new Error(`后端任务 ${jobId} ${status === 'failed' ? '计算失败' : '已取消'}`)
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(options.signal.reason) }
        const timer = setTimeout(() => {
          options.signal.removeEventListener('abort', abort)
          resolve()
        }, options.pollIntervalMs ?? 1000)
        options.signal.addEventListener('abort', abort, { once: true })
        if (options.signal.aborted) abort()
      })
    }
  } catch (error) {
    if (!terminal) {
      try { await client.cancel(jobId) }
      catch (cancelError) {
        throw new RemoteJobCancelError(jobId, cancelError)
      }
    }
    throw error
  }
}
