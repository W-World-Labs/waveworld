import type { JobProgress, JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import { RemoteJobCancelError, type BrowserJobUpdate, type createSettlementClient } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { isNativeModule, readModuleJobInput, readModuleResult } from './module-compute'
import { isBrowserLbmCompute, isBrowserLbmJob, isGpuLbmJob } from './lbm-compute'
import type { LbmTriangleMesh } from '@w-sim/solvers-lbm/d3q19'
import { decodeFlowSnapshot, assertFlowFrames, quantizedFlowFrameBytes, FLOW_SEQUENCE_BATCH_BYTES, MAX_FLOW_SNAPSHOT_BYTES, type LbmDisplaySnapshot } from '../../../apps/lab/src/lib/cfd/flow-snapshot'
import { decodeMacFlowSnapshot, assertMacFlowFrames, macFlowFrameBytes, type MacFlowSnapshot } from '../../../apps/lab/src/lib/cfd/mac-flow-snapshot'
import { validateMacJobSpec } from '@w-sim/contracts'
import { readJobHostOutcome, type JobHostOutcome } from '@w-sim/runtime'
import type { MacGridInspection } from './mac-inspection'

function checkBrowserCompute(spec: JobSpecV1, geometry?: LbmTriangleMesh) {
  const lbm = isBrowserLbmCompute(spec)
  const mac = spec.kind === 'mac-3d'
  if (mac) {
    const check = validateMacJobSpec(spec)
    if (!check.ok) throw new Error(check.message)
  }
  const input = lbm || mac ? undefined : readModuleJobInput(spec)
  if (lbm || mac ? !geometry : !isNativeModule(input?.module)) throw new Error('No admitted browser solver or model for this computation')
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') throw new Error('此环境不支持 WASM 计算，请使用后端计算')
  if (isGpuLbmJob(spec) && !navigator.gpu) throw new Error('此环境不支持 WebGPU 计算，请选择 CPU 或后端计算')
  return input
}

type BrowserWorkerReply = { type: 'progress'; progress: JobProgress } | { type: 'frame'; flow: ArrayBuffer } |
  { type: 'result'; result: JobResultV1 } | { type: 'inspection'; inspection: MacGridInspection } | { type: 'error'; error: string }

export class HostOutcomeReconciliationError extends Error {
  constructor(jobId: string, cause: unknown) {
    super(`Host outcome could not be confirmed for job ${jobId}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'HostOutcomeReconciliationError'
  }
}

function requireTerminalOutcome(update: BrowserJobUpdate, jobId: string): JobHostOutcome {
  if (update.status === 'running') throw new Error('Host returned a running state for a terminal update')
  return readJobHostOutcome(update, jobId)
}

/** Each run owns an isolated, cancellable Worker. Flow solves finish their requested steps. */
async function runBrowserWorker<T>(
  message: { spec: JobSpecV1; geometry?: LbmTriangleMesh; agentId: string; action?: 'inspect-mac' },
  signal: AbortSignal, onMessage: (data: BrowserWorkerReply) => T | undefined,
): Promise<T> {
  signal.throwIfAborted()
  const worker = new Worker(new URL('./browser-agent.worker.ts', import.meta.url), { type: 'module' })
  let deadline: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    const computed = await new Promise<T>((resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      worker.onerror = () => reject(new Error('Compute Worker failed'))
      worker.onmessageerror = () => reject(new Error('Invalid compute Worker message'))
      worker.onmessage = ({ data }: MessageEvent<BrowserWorkerReply>) => {
        if (signal.aborted) return
        try {
          if (data.type === 'error') {
            const invalidSolid = /^Mesh (?:solid boundary |voxelization failed:).*\(code 11\)$/.test(data.error)
            throw new Error(invalidSolid
              ? '模型为空或没有有效表面，或表面有开口、共享边异常、面方向不一致。请在建模软件中修复，或更换为闭合实体后重新检查；系统不会自动补洞或修改模型。（code 11）'
              : data.error)
          }
          const result = onMessage(data)
          if (result !== undefined) resolve(result)
        } catch (error) { reject(error) }
      }
      if (message.action === 'inspect-mac' || (message.spec.kind !== 'lbm-d3q19' && message.spec.kind !== 'mac-3d')) {
        deadline = setTimeout(() => reject(new Error('本机计算超过 120 秒，请使用后端计算')), 120000)
      }
      worker.postMessage(message)
    })
    signal.throwIfAborted()
    return computed
  } finally {
    worker.terminate()
    if (abort) signal.removeEventListener('abort', abort)
    if (deadline) clearTimeout(deadline)
  }
}

/** Runs entirely on this device: no account, upload, job record or HTTP lifecycle. */
export async function runBrowserCompute(
  spec: JobSpecV1,
  options: { signal: AbortSignal; geometry?: LbmTriangleMesh; agentId?: string; onProgress?: (progress: JobProgress) => void; onFrame?: (flow: ArrayBuffer) => void },
): Promise<{ result: JobResultV1; flows: ArrayBuffer[] }> {
  options.signal.throwIfAborted()
  const input = checkBrowserCompute(spec, options.geometry)
  const flows: ArrayBuffer[] = []
  let frameBytes = 0
  const result = await runBrowserWorker({ spec, geometry: options.geometry, agentId: options.agentId ?? 'local-browser' }, options.signal, data => {
    if (data.type === 'progress') options.onProgress?.(data.progress)
    else if (data.type === 'frame') {
      if (!(data.flow instanceof ArrayBuffer) || data.flow.byteLength > MAX_FLOW_SNAPSHOT_BYTES || flows.length >= 4096 ||
          frameBytes + data.flow.byteLength > 256 * 1024 * 1024) throw new Error('流场序列超出大小限制')
      frameBytes += data.flow.byteLength; flows.push(data.flow)
      try { options.onFrame?.(data.flow) } catch { /* 导出失败不影响求解 */ }
    } else if (data.type === 'result') return data.result
  })
  if (input) readModuleResult(result, input)
  else if (spec.outputs.fields?.length) {
    if (spec.kind === 'mac-3d') assertMacFlowFrames(flows.map(decodeMacFlowSnapshot), spec, result.summary.steps)
    else assertFlowFrames(flows.map(flow => decodeFlowSnapshot(flow)), spec, result.summary.steps, result.derived)
  }
  return { result, flows }
}

/** Zero-step local discretization check. No results, artifacts or simulation state are changed. */
export async function inspectBrowserMacGrid(spec: JobSpecV1, geometry: LbmTriangleMesh, signal: AbortSignal): Promise<MacGridInspection> {
  signal.throwIfAborted()
  if (spec.kind !== 'mac-3d') throw new Error('网格检查目前支持 MAC 风扇驱动流动')
  checkBrowserCompute(spec, geometry)
  return runBrowserWorker({ spec, geometry, agentId: 'local-browser', action: 'inspect-mac' }, signal, data => {
    if (data.type === 'inspection') return data.inspection
    if (data.type === 'frame' || data.type === 'result' || data.type === 'progress') throw new Error('网格检查意外进入了求解流程')
  })
}

/** Explicitly published browser task; shares the local solver and adds the Host lifecycle. */
export async function runBrowserJob(
  client: ReturnType<typeof createSettlementClient>, spec: JobSpecV1,
  options: { signal: AbortSignal; geometry?: LbmTriangleMesh; onStatus?: (jobId: string, status: string, progress?: JobProgress) => void; onFrame?: (flow: ArrayBuffer) => void },
): Promise<JobResultV1> {
  options.signal.throwIfAborted()
  checkBrowserCompute(spec, options.geometry)
  if (spec.kind === 'lbm-d3q19' && !isBrowserLbmJob(spec)) throw new Error('Published browser tasks require an uploaded model')
  if (spec.kind === 'mac-3d' && spec.model?.source !== 'artifact') throw new Error('Published MAC tasks require an uploaded model')
  let job: { id: string; agentId: string; attempt: number } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: Promise<void> | undefined
  let progress: JobProgress = { step: 0, total: spec.run.maxSteps }
  let terminal = false, terminalWriteStarted = false, finished = false
  const lease = new AbortController()
  const signal = AbortSignal.any([options.signal, lease.signal])
  try {
    // Obtain the ID even if stopped during submission, then cancel that record.
    job = await client.submitBrowser(spec)
    options.onStatus?.(job.id, 'leased', progress)
    signal.throwIfAborted()
    const renew = async () => {
      try {
        const state = await client.updateBrowser(job!.id, job!.agentId, 'heartbeat', { progress })
        if (state.status !== 'running') throw new Error('Browser job lease lost')
        if (!finished && !signal.aborted) timer = setTimeout(() => { heartbeat = renew() }, 5000)
      } catch (error) { lease.abort(error) }
    }
    heartbeat = renew()
    const { result: raw, flows } = await runBrowserCompute(spec, {
      signal, geometry: options.geometry, agentId: job.agentId,
      onProgress: next => { progress = next; options.onStatus?.(job!.id, 'running', progress) },
      onFrame: options.onFrame,
    })
    signal.throwIfAborted()
    if (flows.length) {
      raw.artifacts = []
      // 渲染帧按 ~FLOW_SEQUENCE_BATCH_BYTES 打包成序列上传，避免逐帧请求和全精度字节。
      let batch: (LbmDisplaySnapshot | MacFlowSnapshot)[] = []
      let batchBytes = 0
      const flush = async () => {
        if (!batch.length) return
        raw.artifacts!.push(await client.uploadBrowserFlowSequence(job!.id, job!.agentId, batch, signal))
        batch = []; batchBytes = 0
      }
      for (const flow of flows) {
        const frame = spec.kind === 'mac-3d' ? decodeMacFlowSnapshot(flow) : decodeFlowSnapshot(flow)
        batch.push(frame)
        batchBytes += 'fields' in frame ? macFlowFrameBytes(frame) : quantizedFlowFrameBytes(frame)
        if (batchBytes >= FLOW_SEQUENCE_BATCH_BYTES) await flush()
      }
      await flush()
    }
    finished = true
    if (timer) clearTimeout(timer)
    await heartbeat
    signal.throwIfAborted()
    // The authoritative complete rejects a cancelled or expired/reassigned lease.
    terminalWriteStarted = true
    let acknowledged: JobHostOutcome
    try {
      acknowledged = requireTerminalOutcome(await client.updateBrowser(job.id, job.agentId, 'complete', { result: raw, attempt: job.attempt }), job.id)
    } catch (cause) {
      throw new HostOutcomeReconciliationError(job.id, cause)
    }
    if (acknowledged.status === 'succeeded') {
      terminal = true
      options.onStatus?.(job.id, 'succeeded')
      return acknowledged.result
    }
    terminal = true
    if (acknowledged.status === 'failed') {
      options.onStatus?.(job.id, 'failed')
      throw new Error(acknowledged.error)
    }
    if (acknowledged.status === 'cancelled') {
      options.onStatus?.(job.id, 'cancelled')
      throw new Error(`Host cancelled browser job ${job.id} before completion`)
    }
    options.onStatus?.(job.id, 'queued')
    throw new Error(`Host requeued browser job ${job.id}; outcome requires reconciliation`)
  } catch (error) {
    finished = true
    if (timer) clearTimeout(timer)
    await heartbeat
    if (job && !terminal && !terminalWriteStarted) {
      if (options.signal.aborted) {
        try { await client.cancel(job.id) }
        catch (cancelError) {
          const state = await client.getStatus(job.id).catch(() => null)
          if (state?.status !== 'cancelled' && state?.status !== 'succeeded' && state?.status !== 'failed') {
            throw new RemoteJobCancelError(job.id, cancelError)
          }
        }
      } else {
        terminalWriteStarted = true
        let acknowledged: JobHostOutcome
        try {
          acknowledged = requireTerminalOutcome(await client.updateBrowser(job.id, job.agentId, 'fail', {
            error: error instanceof Error ? error.message : String(error), retryable: false, attempt: job.attempt,
          }), job.id)
        } catch (cause) {
          throw new HostOutcomeReconciliationError(job.id, cause)
        }
        terminal = true
        if (acknowledged.status === 'succeeded') {
          options.onStatus?.(job.id, 'succeeded')
          return acknowledged.result
        }
        if (acknowledged.status === 'failed') {
          options.onStatus?.(job.id, 'failed')
          throw new Error(acknowledged.error)
        } else if (acknowledged.status === 'cancelled') options.onStatus?.(job.id, 'cancelled')
        else options.onStatus?.(job.id, 'queued')
        throw new Error(`Host ${acknowledged.status === 'queued' ? 'requeued' : 'cancelled'} browser job ${job.id}`)
      }
    }
    throw error
  } finally {
    finished = true
    if (timer) clearTimeout(timer)
  }
}
