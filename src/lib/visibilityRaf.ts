/**
 * 后台标签页暂停 rAF：隐藏时不调度下一帧；重新可见时由监听器拉起。
 * 页面不可见时暂停，避免重仿真在后台空转。
 */

import { dispatchRafFrame, initialRafLoopErrorState } from './hooks/rafLoopCore'

export type RafFrameContext = { disposed: () => boolean }

/** Shared scheduler for canvas, Three and async CPU/WebGPU steps. */
export function startRafLoop(
  frame: (now: number, ctx: RafFrameContext) => void | Promise<void>,
  onError?: (error: unknown) => void,
): () => void {
  let disposed = false
  let raf = 0
  let busy = false
  let state = initialRafLoopErrorState()
  const ctx = { disposed: () => disposed }
  const schedule = () => {
    if (disposed || state.failed || busy || raf) return
    raf = scheduleRafIfVisible(disposed, loop)
  }
  const loop = (now: number) => {
    raf = 0
    if (disposed || state.failed || busy) return
    dispatchRafFrame({
      frame: () => frame(now, ctx),
      getState: () => state,
      setState: (next) => { state = next },
      disposed: ctx.disposed,
      onError: (error) => { if (!disposed) onError?.(error) },
      scheduleNext: schedule,
      setBusy: (next) => { busy = next },
    })
  }
  const stopVisible = onPageVisible(schedule)
  loop(performance.now())
  return () => {
    disposed = true
    stopVisible()
    cancelAnimationFrame(raf)
  }
}

/** 帧末尾：仅在前台且未 dispose 时 schedule 下一帧。返回 raf id（0 = 未调度）。 */
export function scheduleRafIfVisible(
  disposed: boolean,
  loop: FrameRequestCallback,
): number {
  if (disposed || typeof document === 'undefined' || document.hidden) return 0
  return requestAnimationFrame(loop)
}

/**
 * 注册 visibilitychange：页签回到前台时调用 onVisible（通常用来 restart rAF loop）。
 * 返回 cleanup。
 */
export function onPageVisible(onVisible: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const handler = () => {
    if (!document.hidden) onVisible()
  }
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}
