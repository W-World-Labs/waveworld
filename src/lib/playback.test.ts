
import { describe, it, expect } from 'vitest'
import { drainSteps, type StepAccumulator } from './playback'

describe('drainSteps', () => {
  it('speed=1 base=4 → 4 步，余量 0', () => {
    const acc: StepAccumulator = { v: 0 }
    expect(drainSteps(acc, 1, 4)).toBe(4)
    expect(acc.v).toBeCloseTo(0, 12)
  })
  it('慢放 0.25 累积到整步', () => {
    const acc: StepAccumulator = { v: 0 }
    expect(drainSteps(acc, 0.25, 4)).toBe(1)
    expect(drainSteps(acc, 0.25, 4)).toBe(1)
  })
  it('非法 speed/base 不返回负步', () => {
    const acc: StepAccumulator = { v: 0 }
    expect(drainSteps(acc, NaN, 4)).toBe(0)
    expect(drainSteps(acc, -1, 4)).toBe(0)
    expect(drainSteps(acc, 1, NaN)).toBe(0)
  })
})

