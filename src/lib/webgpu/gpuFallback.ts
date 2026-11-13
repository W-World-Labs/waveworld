/**
 * 页面 rAF loop 中 WebGPU 中途失败 → 销毁 GPU sim、用 preferCpu 重建、更新 backend 徽标。
 * 状态从晶格/场重新初始化（不尝试从损坏 GPU 缓冲恢复）。
 */

export type GpuBackend = 'webgpu' | 'cpu'

/** 在 backend==='webgpu' 时，step/read 抛错一律尝试 CPU 热切换。 */
export function isRecoverableGpuError(_err: unknown): boolean {
  return true
}

/**
 * 包装一步 async 工作：若 throw 且当前为 webgpu，则调用 recreateCpu 并返回 'fallback'。
 * recreate 成功后调用方应 continue 下一帧（不 rethrow）。
 */
export async function runGpuStepWithFallback<T>(opts: {
  backend: GpuBackend
  work: () => Promise<T>
  onFallback: () => Promise<void> | void
}): Promise<{ ok: true; value: T } | { ok: false; fallback: true }> {
  try {
    const value = await opts.work()
    return { ok: true, value }
  } catch (err) {
    if (opts.backend !== 'webgpu' || !isRecoverableGpuError(err)) throw err
    await opts.onFallback()
    return { ok: false, fallback: true }
  }
}
