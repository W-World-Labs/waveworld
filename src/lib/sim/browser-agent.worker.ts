import type { JobSpecV1 } from '@w-sim/contracts'
import { computeModule, isNativeModule, moduleComputePrecision, readModuleJobInput } from './module-compute'
import { isNativeLbmCompute, isBrowserLbmCompute, isGpuLbmJob, prepareLbmInput, runLbmWasm } from './lbm-compute'
import { runBatchLbm, type LbmTriangleMesh } from '@w-sim/solvers-lbm/d3q19'
import { encodeFlowSnapshot } from '../../../apps/lab/src/lib/cfd/flow-snapshot'
import { encodeMacFlowSnapshot } from '../../../apps/lab/src/lib/cfd/mac-flow-snapshot'
import { prepareMacInput, runMacWasm } from '@w-sim/solvers-lbm/mac3d'
import { inspectMacGrid } from './mac-inspection'

// Each job owns a Worker and isolated WASM memory or a GPU device. The UI terminates the
// Worker on cancellation, timeout, or lease loss; it owns HTTP and credentials.
self.onmessage = async ({ data }: MessageEvent<{ spec: JobSpecV1; geometry?: LbmTriangleMesh; agentId: string; action?: 'inspect-mac' }>) => {
  try {
    if (data.action === 'inspect-mac') {
      if (!data.geometry || data.spec.kind !== 'mac-3d') throw new Error('MAC grid inspection requires a MAC task and model geometry')
      self.postMessage({ type: 'inspection', inspection: inspectMacGrid(data.spec, data.geometry) })
      return
    }
    if (data.spec.kind === 'mac-3d') {
      if (!data.geometry) throw new Error('MAC model geometry is missing')
      const { mac, flags } = prepareMacInput(data.spec, data.geometry)
      const { result } = await runMacWasm({ spec: data.spec, input: mac, flags,
        onProgress: progress => { self.postMessage({ type: 'progress', progress }) },
        onFieldSnapshot: snapshot => {
          const flow = encodeMacFlowSnapshot(snapshot)
          self.postMessage({ type: 'frame', flow }, { transfer: [flow] })
        },
      })
      self.postMessage({ type: 'result', result })
      return
    }
    const sendFrame = (snapshot: Parameters<typeof encodeFlowSnapshot>[0]) => {
      const flow = encodeFlowSnapshot(snapshot)
      self.postMessage({ type: 'frame', flow }, { transfer: [flow] })
    }
    if (isBrowserLbmCompute(data.spec) && isGpuLbmJob(data.spec)) {
      if (!data.geometry) throw new Error('LBM model geometry is missing')
      const gpuTimeout = <T>(promise: Promise<T>, what: string) =>
        Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} 超时（15s）`)), 15000))])
      // 页面上 navigator.gpu 存在不代表 Worker 里能拿到适配器（无 GPU/驱动拒绝/沙箱）。
      // 拿不到就回退 WASM 路径——同一 spec，只是后端换成 CPU。
      let adapter: GPUAdapter | null = null
      let device: GPUDevice | null = null
      try {
        adapter = await gpuTimeout(navigator.gpu?.requestAdapter() ?? Promise.resolve(null), 'requestAdapter')
        if (adapter) {
          // ultra 网格（346 万格子）单缓冲 263MB，超过 WebGPU 默认 128MB 绑定上限；
          // 尽量按适配器上报的上限请求设备，失败回退默认限额（与 use-webgpu 一致）。
          const raisedLimits: Record<string, number> = {}
          try {
            const { maxStorageBufferBindingSize } = adapter.limits
            if (maxStorageBufferBindingSize > 128 * 1024 * 1024) {
              raisedLimits.maxStorageBufferBindingSize = maxStorageBufferBindingSize
            }
          } catch { /* 读取上限失败则用默认 */ }
          try {
            device = await gpuTimeout(adapter.requestDevice({ requiredLimits: raisedLimits }), 'requestDevice')
          } catch {
            device = await gpuTimeout(adapter.requestDevice(), 'requestDevice')
          }
        }
      } catch { device = null }
      // 发布的任务必须按要求的后端交付；只有本机计算才允许静默降级到 CPU。
      if (!(adapter && device) && data.agentId !== 'local-browser') {
        throw new Error('WebGPU adapter unavailable in this Worker')
      }
      if (adapter && device) {
        device.addEventListener('uncapturederror', event => self.postMessage({ type: 'error', error: event.error.message }))
        void device.lost.then(info => {
          if (info.reason !== 'destroyed') self.postMessage({ type: 'error', error: info.message || 'WebGPU device lost' })
        })
        try {
          const result = await runBatchLbm({ device, geometry: data.geometry, spec: data.spec,
            agentId: data.agentId, backendId: 'webgpu-browser',
            deviceName: [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.device, adapter.info?.description].filter(Boolean).join(' ') || 'browser-webgpu',
            onProgress: progress => { self.postMessage({ type: 'progress', progress }) },
            onDisplaySnapshot: sendFrame,
          })
          self.postMessage({ type: 'result', result })
        } finally { device.destroy() }
        return
      }
      const cpuSpec: JobSpecV1 = { ...data.spec,
        requirements: { ...data.spec.requirements, backends: ['cpu'], precision: 'mixed' } }
      const { result } = await runLbmWasm(cpuSpec, prepareLbmInput(cpuSpec, data.geometry), undefined,
        progress => { self.postMessage({ type: 'progress', progress }) }, sendFrame)
      self.postMessage({ type: 'result', result })
      return
    }
    if (isNativeLbmCompute(data.spec)) {
      if (!data.geometry) throw new Error('LBM model geometry is missing')
      const { result } = await runLbmWasm(data.spec, prepareLbmInput(data.spec, data.geometry), undefined,
        progress => { self.postMessage({ type: 'progress', progress }) }, sendFrame)
      self.postMessage({ type: 'result', result })
      return
    }
    const input = readModuleJobInput(data.spec)
    if (!isNativeModule(input.module)) throw new Error('No admitted Rust/WASM kernel for this module')
    const start = performance.now()
    const moduleResult = await computeModule(input, undefined, async progress => {
      self.postMessage({ type: 'progress', progress })
    })
    self.postMessage({ type: 'result', result: {
      schemaVersion: 1, moduleResult,
      summary: { steps: data.spec.run.maxSteps, wallTimeMs: performance.now() - start },
      backend: { id: 'cpu' }, derived: { precision: moduleComputePrecision(input), engine: 'rust-wasm', version: '0.1.0' },
    } })
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}
