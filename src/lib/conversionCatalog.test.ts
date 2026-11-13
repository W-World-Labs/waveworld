import { describe, expect, it } from 'vitest'
import { directConversionEdges, enumerateConversionPaths, topEnergyForm } from './conversionCatalog'

describe('ontology-derived engineering catalog', () => {
  it('automatically exposes every direct electromagnetic → mechanical mechanism', () => {
    const edges = directConversionEdges('electromagnetic', 'mechanical')
    expect(edges.length).toBe(17)
    expect(edges.map((edge) => edge.id)).toEqual(expect.arrayContaining([
      'radiant-to-mechanical-radiation-pressure',
      'em-visible-to-mechanical-optical-tweezers',
      'em-ir-to-mechanical-photothermal-bimorph',
      'electromagnetic-to-mechanical-magnetic-pressure',
    ]))
  })

  it('normalizes subforms to their top-level form', () => {
    expect(topEnergyForm('em-visible')).toBe('electromagnetic')
    expect(topEnergyForm('el-current')).toBe('electric')
    expect(topEnergyForm('radiant-luminescence')).toBe('electromagnetic')
  })

  it('keeps edge-distinct parallel paths and reports its bounded completeness contract', () => {
    const result = enumerateConversionPaths('electromagnetic', 'mechanical', {
      maxHops: 1, safetyCap: 10_000,
    })
    expect(result.complete).toBe(true)
    expect(result.paths.length).toBe(directConversionEdges('electromagnetic', 'mechanical').length)
    expect(new Set(result.paths.map((path) => path.edgeIds.join('|'))).size).toBe(result.paths.length)
  })

  it('never labels a safety-capped search complete', () => {
    const result = enumerateConversionPaths('electromagnetic', 'mechanical', { maxHops: 4, safetyCap: 1 })
    expect(result.complete).toBe(false)
  })
})
