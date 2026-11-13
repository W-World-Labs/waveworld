import { describe, expect, it, vi } from 'vitest'
import {
  dispatchRafFrame,
  initialRafLoopErrorState,
  reportRafLoopError,
  shouldScheduleAfterFrame,
} from './rafLoopCore'

describe('rafLoopCore (#6)', () => {
  it('reportRafLoopError reports once and swallows onError throw', () => {
    let calls = 0
    const onError = () => {
      calls++
      throw new Error('callback boom')
    }
    let s = initialRafLoopErrorState()
    s = reportRafLoopError(s, new Error('frame'), onError)
    expect(s.failed).toBe(true)
    expect(s.reportCount).toBe(1)
    s = reportRafLoopError(s, new Error('again'), onError)
    expect(s.reportCount).toBe(1)
    expect(calls).toBe(1)
  })

  it('shouldScheduleAfterFrame false when disposed or failed', () => {
    const ok = initialRafLoopErrorState()
    expect(shouldScheduleAfterFrame(ok, false)).toBe(true)
    expect(shouldScheduleAfterFrame(ok, true)).toBe(false)
    const bad = reportRafLoopError(ok, 'x')
    expect(shouldScheduleAfterFrame(bad, false)).toBe(false)
  })

  it('dispatchRafFrame: sync throw stops reschedule and reports once', () => {
    const scheduleNext = vi.fn()
    const onError = vi.fn()
    let state = initialRafLoopErrorState()
    dispatchRafFrame({
      frame: () => {
        throw new Error('sync fail')
      },
      getState: () => state,
      setState: (s) => {
        state = s
      },
      disposed: () => false,
      onError,
      scheduleNext,
      setBusy: () => {},
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(state.failed).toBe(true)
    expect(scheduleNext).not.toHaveBeenCalled()
  })

  it('dispatchRafFrame: async reject stops reschedule', async () => {
    const scheduleNext = vi.fn()
    const onError = vi.fn()
    let state = initialRafLoopErrorState()
    dispatchRafFrame({
      frame: () => Promise.reject(new Error('async fail')),
      getState: () => state,
      setState: (s) => {
        state = s
      },
      disposed: () => false,
      onError,
      scheduleNext,
      setBusy: () => {},
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(state.failed).toBe(true)
    expect(scheduleNext).not.toHaveBeenCalled()
  })

  it('dispatchRafFrame: success schedules next when not disposed', () => {
    const scheduleNext = vi.fn()
    let state = initialRafLoopErrorState()
    dispatchRafFrame({
      frame: () => {},
      getState: () => state,
      setState: (s) => {
        state = s
      },
      disposed: () => false,
      scheduleNext,
      setBusy: () => {},
    })
    expect(scheduleNext).toHaveBeenCalledTimes(1)
    expect(state.failed).toBe(false)
  })

  it('dispatchRafFrame: disposed after async resolve does not schedule', async () => {
    const scheduleNext = vi.fn()
    let disposed = false
    let state = initialRafLoopErrorState()
    dispatchRafFrame({
      frame: () =>
        new Promise<void>((resolve) => {
          disposed = true
          resolve()
        }),
      getState: () => state,
      setState: (s) => {
        state = s
      },
      disposed: () => disposed,
      scheduleNext,
      setBusy: () => {},
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(scheduleNext).not.toHaveBeenCalled()
  })
})
