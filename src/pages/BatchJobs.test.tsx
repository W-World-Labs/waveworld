import { describe, expect, it } from 'vitest'
import { nativeModuleWorkspacePath } from './BatchJobs'
import { ABAQUS_NATIVE_CASES } from '../data/abaqusCases'
import { OPTICSTUDIO_NATIVE_CASES } from '../data/opticstudioCases'
import { DYMOLA_NATIVE_CASES } from '../data/dymolaCases'
import { STAR_CCM_NATIVE_CASES } from '../data/starCcmCases'
import { CST_NATIVE_CASES } from '../data/cstCases'
import { matchesNativeSoftwareOperation } from '../components/NativeSoftwareCases'

describe('native module job return links', () => {
  it('returns Ansys and COMSOL jobs to their case catalogs', () => {
    expect(nativeModuleWorkspacePath('sw-ansys-report')).toBe('ansys')
    expect(nativeModuleWorkspacePath('sw-comsol-heat-solids')).toBe('comsol')
    expect(nativeModuleWorkspacePath('sw-lbm')).toBeNull()
    expect(nativeModuleWorkspacePath(null)).toBeNull()
  })

  it('returns only admitted Abaqus-backed sw-calculix modules to Abaqus', () => {
    expect(ABAQUS_NATIVE_CASES).toHaveLength(51)
    for (const example of ABAQUS_NATIVE_CASES) expect(nativeModuleWorkspacePath(example.module)).toBe('abaqus')
    expect(nativeModuleWorkspacePath('sw-calculix-unrelated-case')).toBeNull()
  })

  it('returns only exact OpticStudio module and selector matches to the optical case catalog', () => {
    expect(OPTICSTUDIO_NATIVE_CASES).toHaveLength(40)
    for (const example of OPTICSTUDIO_NATIVE_CASES) {
      expect(nativeModuleWorkspacePath(example.module, example.input)).toBe('opticstudio')
    }
    expect(nativeModuleWorkspacePath('laser', { module: 'laser', backend: 'host' })).toBeNull()
    expect(nativeModuleWorkspacePath('laser', { module: 'laser', backend: 'host', operation: 'unrelated' })).toBeNull()
    expect(nativeModuleWorkspacePath('lens-design', { module: 'lens-design', backend: 'host' })).toBeNull()
    expect(nativeModuleWorkspacePath('sw-optics-bvh', { module: 'sw-optics-bvh', backend: 'host', method: 'legacy-default' })).toBeNull()
  })

  it('returns only exact Dymola modules with their new operation activation checks', () => {
    expect(DYMOLA_NATIVE_CASES).toHaveLength(62)
    for (const example of DYMOLA_NATIVE_CASES) expect(nativeModuleWorkspacePath(example.module, example.input)).toBe('dymola')
    const example = DYMOLA_NATIVE_CASES[0]!
    expect(nativeModuleWorkspacePath(example.module, { ...example.input, module: 'sw-openmodelica-unlisted' })).toBeNull()
    expect(nativeModuleWorkspacePath(example.module, { ...example.input, backend: 'cuda' })).toBeNull()
    const operationCase = DYMOLA_NATIVE_CASES.find(item => item.selectorChecks.some(check => check.path === 'operation' && check.equals !== undefined))
    if (operationCase) expect(nativeModuleWorkspacePath(operationCase.module, { ...operationCase.input, operation: 'unlisted-operation' })).toBeNull()
    expect(nativeModuleWorkspacePath('sw-openmodelica-unlisted', { module: 'sw-openmodelica-unlisted', backend: 'host' })).toBeNull()
  })

  it('returns only curated STAR-CCM+ mapped modules with matching activation checks', () => {
    expect(STAR_CCM_NATIVE_CASES.length).toBeGreaterThan(0)
    for (const example of STAR_CCM_NATIVE_CASES) {
      expect(nativeModuleWorkspacePath(example.module, example.input)).toBe('star-ccm')
      expect(nativeModuleWorkspacePath(example.module, { ...example.input, backend: 'cuda' })).toBeNull()
    }
    expect(nativeModuleWorkspacePath('sw-openfoam-not-curated', { module: 'sw-openfoam-not-curated', backend: 'host', operation: 'unknown' })).toBeNull()
    expect(nativeModuleWorkspacePath('sw-su2-not-curated', { module: 'sw-su2-not-curated', backend: 'host', operation: 'unknown' })).toBeNull()
  })

  it('returns only exact CST modules with their curated selector checks', () => {
    expect(CST_NATIVE_CASES.length).toBeGreaterThan(0)
    for (const example of CST_NATIVE_CASES) {
      expect(nativeModuleWorkspacePath(example.module, example.input)).toBe('cst')
      expect(nativeModuleWorkspacePath(example.module, { ...example.input, backend: 'cuda' })).toBeNull()
    }
    const example = CST_NATIVE_CASES[0]!
    expect(nativeModuleWorkspacePath(example.module, { ...example.input, module: `${example.module}-unlisted` })).toBeNull()
    expect(nativeModuleWorkspacePath('sw-em-unlisted', { module: 'sw-em-unlisted', backend: 'host', operation: 'cst-unlisted' })).toBeNull()
    expect(example.selectorChecks.length).toBeGreaterThan(0)
    const selectedCheck = example.selectorChecks.find(check => check.equals !== undefined)
    if (selectedCheck) {
      const changed = structuredClone(example.input) as Record<string, unknown>
      const parts = selectedCheck.path.split('.')
      let cursor = changed
      for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>
      cursor[parts.at(-1)!] = `unlisted-${String(selectedCheck.equals)}`
      expect(matchesNativeSoftwareOperation(example, changed)).toBe(false)
      expect(nativeModuleWorkspacePath(example.module, changed)).toBeNull()
    }
  })
})
