/**
 * Pure helpers for useRafLoop error / dispose policy (#6).
 * No React, no DOM — unit-tested independently of the hook.
 */

export type RafLoopErrorState = {
  /** True after first failure; further errors are ignored. */
  failed: boolean
  lastError: unknown | null
  reportCount: number
}

export function initialRafLoopErrorState(): RafLoopErrorState {
  return { failed: false, lastError: null, reportCount: 0 }
}

/**
 * Report a frame error once. Invokes onError at most once per failure lifetime.
 * If onError itself throws, that is swallowed so dispose/cleanup still runs.
 */
export function reportRafLoopError(
  state: RafLoopErrorState,
  err: unknown,
  onError?: (err: unknown) => void,
): RafLoopErrorState {
  if (state.failed) return state
  try {
    onError?.(err)
  } catch {
    /* callback must not break the loop controller */
  }
  return {
    failed: true,
    lastError: err,
    reportCount: state.reportCount + 1,
  }
}

/** Whether the loop should schedule another frame after this one. */
export function shouldScheduleAfterFrame(
  state: RafLoopErrorState,
  disposed: boolean,
): boolean {
  return !disposed && !state.failed
}

/**
 * Run one frame (sync or thenable). On throw/reject, reports error and does not
 * call scheduleNext. On success, scheduleNext() if still allowed.
 */
export function dispatchRafFrame(opts: {
  frame: () => void | Promise<void>
  getState: () => RafLoopErrorState
  setState: (s: RafLoopErrorState) => void
  disposed: () => boolean
  onError?: (err: unknown) => void
  scheduleNext: () => void
  setBusy: (b: boolean) => void
}): void {
  if (opts.disposed() || opts.getState().failed) return
  opts.setBusy(true)
  let result: void | Promise<void>
  try {
    result = opts.frame()
  } catch (err) {
    opts.setState(reportRafLoopError(opts.getState(), err, opts.onError))
    opts.setBusy(false)
    return
  }
  if (result && typeof (result as Promise<void>).then === 'function') {
    ;(result as Promise<void>)
      .then(() => {
        opts.setBusy(false)
        if (shouldScheduleAfterFrame(opts.getState(), opts.disposed())) {
          opts.scheduleNext()
        }
      })
      .catch((err: unknown) => {
        opts.setState(reportRafLoopError(opts.getState(), err, opts.onError))
        opts.setBusy(false)
      })
  } else {
    opts.setBusy(false)
    if (shouldScheduleAfterFrame(opts.getState(), opts.disposed())) {
      opts.scheduleNext()
    }
  }
}
