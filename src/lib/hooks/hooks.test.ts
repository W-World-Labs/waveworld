import { describe, it, expect } from 'vitest'
import { drainSteps } from '../playback'
import { scheduleRafIfVisible } from '../visibilityRaf'

/**
 * hooks 层依赖的纯函数契约（不测 React runtime）。
 * 组装层正确性：playback + visibility 与 sim 解耦。
 */
describe('assembly layer pure contracts', () => {
  it('drainSteps 与 usePlayController 同源：慢放累积', () => {
    const acc = { v: 0 }
    expect(drainSteps(acc, 0.25, 4)).toBe(1)
    expect(drainSteps(acc, 0.25, 4)).toBe(1)
  })

  it('scheduleRafIfVisible：disposed 时不调度', () => {
    expect(scheduleRafIfVisible(true, () => {})).toBe(0)
  })
})
