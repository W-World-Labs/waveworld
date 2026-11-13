import { describe, it, expect } from 'vitest'
import {
  METHOD_ZN,
  METHOD_ALGO_ZN_PID,
  ZN_PARENT,
  ZN_METHOD_IDS,
  DEFAULT_KU,
  DEFAULT_PU,
  znPid,
  runZnPidSample,
} from './ziegler-nichols-algos'

describe('Ziegler–Nichols · classic PID from Ku, Pu', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ZN).toBe('method-ziegler-nichols')
    expect(METHOD_ALGO_ZN_PID).toBe('method-algo-zn-pid')
    expect(ZN_PARENT).toBe(METHOD_ZN)
    expect(ZN_METHOD_IDS).toContain(METHOD_ALGO_ZN_PID)
  })

  it('znPid: Kp=0.6 Ku, Ti=0.5 Pu, Td=0.125 Pu', () => {
    const g = znPid(DEFAULT_KU, DEFAULT_PU)
    expect(g.Kp).toBeCloseTo(0.6 * DEFAULT_KU, 12)
    expect(g.Ti).toBeCloseTo(0.5 * DEFAULT_PU, 12)
    expect(g.Td).toBeCloseTo(0.125 * DEFAULT_PU, 12)
    expect(g.Td / g.Ti).toBeCloseTo(0.25, 12)
  })

  it('scales with Ku, Pu; bad → NaN', () => {
    const g = znPid(4, 2)
    expect(g.Kp).toBeCloseTo(2.4, 12)
    expect(g.Ti).toBeCloseTo(1, 12)
    expect(g.Td).toBeCloseTo(0.25, 12)
    expect(Number.isNaN(znPid(0, 1).Kp)).toBe(true)
    expect(Number.isNaN(znPid(1, -1).Ti)).toBe(true)
    expect(Number.isNaN(znPid(NaN, 1).Td)).toBe(true)
  })

  it('runZnPidSample: ok, formula, methodId/familyId', () => {
    const r = runZnPidSample()
    expect(r.methodId).toBe(METHOD_ALGO_ZN_PID)
    expect(r.familyId).toBe(METHOD_ZN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Kp).toBeCloseTo(0.6 * r.Ku, 12)
    expect(r.Ti).toBeCloseTo(0.5 * r.Pu, 12)
    expect(r.Td).toBeCloseTo(0.125 * r.Pu, 12)
  })

  it('custom params still ok', () => {
    expect(runZnPidSample({ Ku: 3.5, Pu: 0.8 }).ok).toBe(true)
  })
})
