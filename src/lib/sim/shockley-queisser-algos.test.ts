import { describe, it, expect } from 'vitest'
import {
  METHOD_SQ,
  METHOD_ALGO_SQ_LIMIT,
  SQ_PARENT,
  SQ_METHOD_IDS,
  AM15_STEP_BINS,
  incidentPower,
  photonFluxAbove,
  sqEtaBlackbody_eV,
  jscFromSpectrum,
  j0Radiative,
  vocIdeal,
  fillFactor,
  sqEtaStepwise,
  sqEta,
  sweepSqEta,
  runSqLimitSample,
  QE,
  TS_DEFAULT,
  TC_DEFAULT,
} from './shockley-queisser-algos'

describe('SQ · Shockley–Queisser limit toy', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SQ).toBe('method-shockley-queisser')
    expect(METHOD_ALGO_SQ_LIMIT).toBe('method-algo-sq-limit')
    expect(SQ_PARENT).toBe(METHOD_SQ)
    expect(SQ_METHOD_IDS).toContain(METHOD_ALGO_SQ_LIMIT)
  })

  it('photonFluxAbove decreases with Eg', () => {
    const nLo = photonFluxAbove(0.8 * QE, TS_DEFAULT)
    const nHi = photonFluxAbove(1.8 * QE, TS_DEFAULT)
    expect(nLo).toBeGreaterThan(nHi)
    expect(nHi).toBeGreaterThan(0)
  })

  it('blackbody sqEta unimodal: mid Eg beats low and high', () => {
    const lo = sqEtaBlackbody_eV(0.7)
    const mid = sqEtaBlackbody_eV(1.2)
    const hi = sqEtaBlackbody_eV(2.0)
    expect(mid).toBeGreaterThan(lo)
    expect(mid).toBeGreaterThan(hi)
    expect(mid).toBeGreaterThan(0.25)
  })

  it('sweepSqEta blackbody: max η around 1.1–1.4 eV loosely', () => {
    const sw = sweepSqEta({ egMin: 0.6, egMax: 2.2, n: 33, mode: 'blackbody' })
    expect(sw.etaMax).toBeGreaterThan(0.30)
    expect(sw.etaMax).toBeLessThan(0.50)
    // undiluted blackbody SQ peak is classically ~1.1 eV (loose 1.0–1.5)
    expect(sw.egOpt).toBeGreaterThanOrEqual(1.0)
    expect(sw.egOpt).toBeLessThanOrEqual(1.5)
    expect(sw.eg.length).toBe(33)
    expect(sw.eta[sw.iMax]).toBeCloseTo(sw.etaMax, 12)
  })

  it('stepwise spectrum helpers: Jsc falls with Eg; Voc/FF finite', () => {
    expect(incidentPower(AM15_STEP_BINS)).toBeGreaterThan(500)
    const jLo = jscFromSpectrum(0.8)
    const jHi = jscFromSpectrum(2.0)
    expect(jLo).toBeGreaterThan(jHi)
    const Voc = vocIdeal(jLo, j0Radiative(1.1), 1.1, TC_DEFAULT)
    expect(Voc).toBeGreaterThan(0.4)
    expect(fillFactor(Voc)).toBeGreaterThan(0.5)
    expect(sqEtaStepwise(1.2)).toBeGreaterThan(0)
    expect(sqEta(1.2, 'stepwise')).toBe(sqEtaStepwise(1.2))
  })

  it('runSqLimitSample: ok, familyId, max η near 1.1–1.4 eV', () => {
    const r = runSqLimitSample()
    expect(r.methodId).toBe(METHOD_ALGO_SQ_LIMIT)
    expect(r.familyId).toBe(METHOD_SQ)
    expect(r.familyId).toBe('method-shockley-queisser')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.unimodal).toBe(true)
    expect(r.egInWindow).toBe(true)
    expect(r.etaPlausible).toBe(true)
    expect(r.egOpt).toBeGreaterThanOrEqual(1.0)
    expect(r.egOpt).toBeLessThanOrEqual(1.5)
    expect(r.etaMax).toBeGreaterThan(0.30)
    expect(r.etaMid).toBeGreaterThan(r.etaLo)
    expect(r.etaMid).toBeGreaterThan(r.etaHi)
  })
})
