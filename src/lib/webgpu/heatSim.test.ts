import { describe, expect, it } from 'vitest'
import { createHeatSim } from './heatSim'

describe('heatSim preferCpu contract (#7)', () => {
  it('createHeatSim({preferCpu:true}) seeds, steps, reads finite field, dispose is safe', async () => {
    const sim = await createHeatSim(24, 24, { preferCpu: true })
    expect(sim.backend).toBe('cpu')
    expect(sim.W).toBe(24)
    expect(sim.H).toBe(24)
    sim.seed(12, 12, 2, 5)
    await sim.step(0.1, 8)
    const field = await sim.field()
    expect(field.length).toBe(24 * 24)
    expect(field.every((v) => Number.isFinite(v))).toBe(true)
    // heat should have diffused — max still > 0 after seed
    let max = 0
    for (const v of field) if (v > max) max = v
    expect(max).toBeGreaterThan(0)
    sim.dispose()
    sim.dispose() // idempotent
  })

  it('zero seed amount leaves finite zeros', async () => {
    const sim = await createHeatSim(8, 8, { preferCpu: true })
    sim.seed(4, 4, 1, 0)
    await sim.step(0.05, 3)
    const field = await sim.field()
    expect(field.every((v) => v === 0)).toBe(true)
    sim.dispose()
  })
})
