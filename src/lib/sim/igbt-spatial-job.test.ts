import { describe, expect, it } from 'vitest'
import { buildIgbtSpatialJobSpec, createDefaultIgbtSpatialParameters, THERMAL_IGBT_SPATIAL_FEATURE } from './igbt-spatial-job'

describe('spatial IGBT job submission contract', () => {
  it('builds a typed native-cuda job with the required feature and saved field/KPI outputs', () => {
    const result = buildIgbtSpatialJobSpec(createDefaultIgbtSpatialParameters())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.kind).toBe('electro-thermal-igbt')
    expect(result.spec.parameters.mode).toBe('spatial-chip')
    expect(result.spec.requirements).toMatchObject({
      backends: ['native-cuda'], features: [THERMAL_IGBT_SPATIAL_FEATURE], requiredOutputs: ['fields', 'kpis'],
    })
    expect(result.spec.outputs.fields).toContain('temperature')
    expect(result.spec.outputs.kpis).toContain('tjMaxC')
    expect(result.spec.parameters.dies[0]?.lossTable.source).toBe('synthetic-example-not-vendor-data')
  })

  it('rejects an edited operating point without mutating the independent loss-table condition', () => {
    const parameters = createDefaultIgbtSpatialParameters()
    parameters.dies[0]!.operatingPoint.currentA = 2
    expect(parameters.dies[0]!.lossTable.operatingPoint.currentA).toBe(1)
    const result = buildIgbtSpatialJobSpec(parameters)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some(error => error.includes('lossTable.operatingPoint.currentA'))).toBe(true)
  })

  it('rejects invalid geometry at admission without invoking a solver', () => {
    const parameters = createDefaultIgbtSpatialParameters()
    parameters.nx = 1
    const result = buildIgbtSpatialJobSpec(parameters)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('parameters.nx')
  })
})
