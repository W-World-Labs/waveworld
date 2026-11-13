import { describe, expect, it } from 'vitest'
import {
  COMSOL_MATERIAL_TABLE_MAX_BYTES,
  COMSOL_MATERIAL_TABLE_MAX_ROWS,
  readComsolMaterialTable,
  serializeComsolMaterialTable,
} from './comsol-material-table'

describe('WaveWorld COMSOL material table CSV', () => {
  it('reads and writes the explicit thermal conductivity unit header', () => {
    const csv = 'temperature_K,conductivity_W_per_mK\n250,12.5\n300,14'
    const table = { property: 'conductivity' as const, rows: [[250, 12.5], [300, 14]] as [number, number][] }
    expect(readComsolMaterialTable(csv)).toEqual(table)
    expect(serializeComsolMaterialTable(table)).toBe(csv)
  })

  it('identifies specific heat capacity from its explicit SI unit header', () => {
    expect(readComsolMaterialTable('\uFEFFtemperature_K,specific_heat_J_per_kgK\r\n280,410\r\n310,425\r\n'))
      .toEqual({ property: 'specificHeat', rows: [[280, 410], [310, 425]] })
  })

  it('rejects unsupported meanings, headers, and non-two-column rows', () => {
    for (const csv of [
      'temperature_K,value\n300,1',
      'temperature_C,conductivity_W_per_mK\n300,1',
      'temperature_K,conductivity_W_per_mK,extra\n300,1,2',
      'temperature_K,conductivity_W_per_mK\n300,1,2',
      'temperature_K,conductivity_W_per_mK\n300,',
    ]) expect(() => readComsolMaterialTable(csv)).toThrow()
    expect(() => readComsolMaterialTable('temperature_K,conductivity_W_per_mK\n300,1'))
      .toThrow(/at least two data rows/)
  })

  it('requires finite positive values and strictly increasing Kelvin temperatures', () => {
    for (const values of ['0,1', '-1,1', 'NaN,1', '300,Infinity', '300,0', '300,-1', '300,1\n300,2', '300,1\n299,2']) {
      expect(() => readComsolMaterialTable(`temperature_K,conductivity_W_per_mK\n${values}`)).toThrow()
    }
  })

  it('enforces the row and UTF-8 file-size limits', () => {
    const rows = Array.from({ length: COMSOL_MATERIAL_TABLE_MAX_ROWS + 1 }, (_, i) => `${i + 1},1`).join('\n')
    expect(() => readComsolMaterialTable(`temperature_K,conductivity_W_per_mK\n${rows}`)).toThrow(/row limit/)
    expect(() => readComsolMaterialTable(`temperature_K,conductivity_W_per_mK\n300,1\n${' '.repeat(COMSOL_MATERIAL_TABLE_MAX_BYTES)}`))
      .toThrow(/file limit/)
  })

  it('validates rows before serialization and supports the full bounded row count', () => {
    expect(() => serializeComsolMaterialTable({ property: 'specificHeat', rows: [[300, 1], [290, 2]] }))
      .toThrow(/strictly increasing/)
    expect(() => serializeComsolMaterialTable({ property: 'conductivity', rows: [[300, 1]] }))
      .toThrow(/2–1,000 rows/)
    expect(() => serializeComsolMaterialTable({ property: 'conductivity', rows: [[300, Number.POSITIVE_INFINITY], [400, 1]] }))
      .toThrow(/finite and positive/)
    const largeRows = Array.from({ length: COMSOL_MATERIAL_TABLE_MAX_ROWS }, (_, i): [number, number] => [i + 1, 1e308])
    expect(serializeComsolMaterialTable({ property: 'conductivity', rows: largeRows }).split('\n')).toHaveLength(COMSOL_MATERIAL_TABLE_MAX_ROWS + 1)
  })
})
