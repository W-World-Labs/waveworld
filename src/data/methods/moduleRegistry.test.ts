import { describe, it, expect } from 'vitest'
import {
  MODULE_BINDINGS,
  runnerFor,
  bindingsForFamily,
  allBoundMethodIds,
} from './moduleRegistry'
import { METHODS, methodById } from './methods'

describe('moduleRegistry', () => {
  it('has at least 162 bindings (100% METHODS coverage floor)', () => {
    expect(MODULE_BINDINGS.length).toBeGreaterThanOrEqual(162)
  })

  it('covers every method in METHODS (unbound=0)', () => {
    const bound = new Set(allBoundMethodIds())
    const unbound = METHODS.filter((m) => !bound.has(m.id)).map((m) => m.id)
    expect(unbound, `unbound methodIds: ${unbound.join(', ')}`).toEqual([])
    expect(MODULE_BINDINGS.length).toBe(METHODS.length)
  })

  it('every family root is itself bound', () => {
    const bound = new Set(allBoundMethodIds())
    for (const b of MODULE_BINDINGS) {
      expect(bound.has(b.family), `unbound family root ${b.family}`).toBe(true)
    }
  })

  it('every binding.methodId resolves in METHODS', () => {
    expect(MODULE_BINDINGS.length).toBeGreaterThan(0)
    for (const b of MODULE_BINDINGS) {
      const m = methodById(b.methodId)
      expect(m, `missing method ${b.methodId}`).toBeDefined()
      expect(m!.id).toBe(b.methodId)
    }
  })

  it('every family id resolves in METHODS', () => {
    for (const b of MODULE_BINDINGS) {
      expect(methodById(b.family), `missing family ${b.family}`).toBeDefined()
    }
  })

  it('methodIds are unique', () => {
    const ids = allBoundMethodIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('run() returns a truthy object for every binding', () => {
    for (const b of MODULE_BINDINGS) {
      const out = b.run()
      expect(out, `${b.methodId} run()`).toBeTruthy()
      expect(typeof out, `${b.methodId} type`).toBe('object')
    }
  })

  it('runnerFor / bindingsForFamily', () => {
    const first = MODULE_BINDINGS[0]!
    expect(runnerFor(first.methodId)?.methodId).toBe(first.methodId)
    expect(runnerFor('method-does-not-exist')).toBeUndefined()

    const fam = bindingsForFamily(first.family)
    expect(fam.length).toBeGreaterThanOrEqual(1)
    expect(fam.every((b) => b.family === first.family)).toBe(true)
    expect(bindingsForFamily('method-does-not-exist')).toEqual([])
  })
})
