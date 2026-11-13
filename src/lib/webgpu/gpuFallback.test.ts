// src/lib/webgpu/gpuFallback.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runGpuStepWithFallback } from './gpuFallback'

describe('runGpuStepWithFallback', () => {
  it('work succeeds → ok true with value', async () => {
    const onFallback = vi.fn()
    const result = await runGpuStepWithFallback({
      backend: 'webgpu',
      work: async () => 42,
      onFallback,
    })
    expect(result).toEqual({ ok: true, value: 42 })
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('work throws with backend webgpu → onFallback called, ok false fallback true', async () => {
    const onFallback = vi.fn()
    const result = await runGpuStepWithFallback({
      backend: 'webgpu',
      work: async () => {
        throw new Error('gpu device lost')
      },
      onFallback,
    })
    expect(result).toEqual({ ok: false, fallback: true })
    expect(onFallback).toHaveBeenCalledOnce()
  })

  it('work throws with backend cpu → rethrows', async () => {
    const onFallback = vi.fn()
    const err = new Error('cpu step failed')
    await expect(
      runGpuStepWithFallback({
        backend: 'cpu',
        work: async () => {
          throw err
        },
        onFallback,
      }),
    ).rejects.toThrow(err)
    expect(onFallback).not.toHaveBeenCalled()
  })
})
