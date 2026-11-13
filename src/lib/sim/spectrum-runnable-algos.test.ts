import { describe, expect, it } from 'vitest'
import {
  C0,
  ETA0,
  emPlaneWaveObservables,
  sampleEmPlaneWave,
  acousticPlaneWaveObservables,
  sampleAcousticPlaneWave,
  createEmPlaneWave,
  createAcousticPlaneWave,
  createEmWave3D,
  forcedOscillatorStep,
  forcedOscillatorAmplitude,
  forcedOscillatorOmega0,
  forcedOscillatorResonanceCurve,
} from './spectrum-runnable-algos'

describe('EM plane wave (#19)', () => {
  it('n=1: λ=c/f, η=η0, intensity finite; higher n slows vp', () => {
    const vac = emPlaneWaveObservables({ frequencyHz: C0, refractiveIndex: 1, ePeak: 10 })
    expect(vac.ok).toBe(true)
    expect(vac.wavelengthM).toBeCloseTo(1, 12)
    expect(vac.phaseVelocity).toBeCloseTo(C0, 3)
    expect(vac.impedance).toBeCloseTo(ETA0, 6)
    expect(vac.intensityWm2).toBeGreaterThan(0)

    const glass = emPlaneWaveObservables({ frequencyHz: C0, refractiveIndex: 1.5, ePeak: 10 })
    expect(glass.ok).toBe(true)
    expect(glass.phaseVelocity).toBeCloseTo(C0 / 1.5, 3)
    expect(glass.wavelengthM).toBeCloseTo(vac.wavelengthM / 1.5, 9)
    expect(glass.impedance).toBeCloseTo(ETA0 / 1.5, 6)
  })

  it('sample: E/B peak and phase-lock; invalid f fails explicitly', () => {
    const xs = new Float64Array([0, 0.25, 0.5])
    const { E, B, ok } = sampleEmPlaneWave(
      { frequencyHz: 1e9, refractiveIndex: 1, ePeak: 2 },
      0,
      xs,
    )
    expect(ok).toBe(true)
    expect(Math.max(...E)).toBeCloseTo(2, 6)
    // B = E/c at each sample when phase-matched
    for (let i = 0; i < xs.length; i++) {
      expect(B[i]).toBeCloseTo(E[i] / C0, 12)
    }
    expect(() => sampleEmPlaneWave({ frequencyHz: 0, refractiveIndex: 1, ePeak: 1 }, 0, xs)).toThrow()
  })
})

describe('shared plane-wave memory and failure behavior', () => {
  it('resamples all three scenes in the same WASM buffers', () => {
    const runs = [createEmPlaneWave({ frequencyHz: 2, refractiveIndex: 1, ePeak: 2 }, [0, 1]),
      createAcousticPlaneWave({ frequencyHz: 2, rho: 1.2, c: 343, pPeak: 2 }, [0, 1]),
      createEmWave3D({ waveNumber: 0.7, amplitude: 2, time: 0 })]
    for (const run of runs) {
      run.sample(0)
      const first = run.first, second = run.second, positions = run.positions, memory = first.buffer
      const before = Array.from(first)
      run.sample(0.125)
      expect(run.first).toBe(first); expect(run.second).toBe(second); expect(run.positions).toBe(positions)
      expect(run.first.buffer).toBe(memory)
      expect(Array.from(first)).not.toEqual(before)
    }
  })
  it('rejects nonfinite samples, phases and overflow instead of returning ok with NaNs', () => {
    const p = { frequencyHz: 1, refractiveIndex: 1, ePeak: 2 }
    expect(() => sampleEmPlaneWave(p, 0, [NaN, 1])).toThrow()
    expect(() => sampleEmPlaneWave({ ...p, phase0: Infinity }, 0, [0, 1])).toThrow()
    expect(() => sampleEmPlaneWave(p, Infinity, [0, 1])).toThrow()
    expect(() => acousticPlaneWaveObservables({ frequencyHz: 1, rho: 1e308, c: 1e308, pPeak: 1 })).toThrow()
  })
})

describe('acoustic plane wave (#19)', () => {
  it('air-like Z=ρc; intensity and λ=c/f', () => {
    const air = acousticPlaneWaveObservables({
      frequencyHz: 1000,
      rho: 1.2,
      c: 340,
      pPeak: 2,
    })
    expect(air.ok).toBe(true)
    expect(air.impedance).toBeCloseTo(1.2 * 340, 9)
    expect(air.wavelengthM).toBeCloseTo(0.34, 9)
    expect(air.vPeak).toBeCloseTo(2 / air.impedance, 12)
    expect(air.intensityWm2).toBeCloseTo((2 * 2) / (2 * air.impedance), 12)
  })

  it('sample pressure/velocity co-phase for +x wave', () => {
    const xs = [0, 0.1]
    const { pressure, velocity, ok } = sampleAcousticPlaneWave(
      { frequencyHz: 500, rho: 1000, c: 1500, pPeak: 100 },
      0,
      xs,
    )
    expect(ok).toBe(true)
    const Z = 1000 * 1500
    expect(pressure[0] / velocity[0]).toBeCloseTo(Z, 6)
  })
})

describe('forced damped oscillator (#19)', () => {
  it('ω0 = sqrt(k/m); resonance peak near ω0 for light damping', () => {
    const m = 1
    const k = 100
    const w0 = forcedOscillatorOmega0(m, k)
    expect(w0).toBeCloseTo(10, 9)
    const p = { mass: m, stiffness: k, damping: 0.5, driveAmp: 1, driveOmega: w0 }
    const aRes = forcedOscillatorAmplitude(p, w0)
    const aOff = forcedOscillatorAmplitude(p, w0 * 2)
    expect(aRes).toBeGreaterThan(aOff)
    const curve = forcedOscillatorResonanceCurve(p, 1, 30, 50)
    expect(curve.ok).toBe(true)
    let imax = 0
    for (let i = 1; i < curve.amp.length; i++) if (curve.amp[i] > curve.amp[imax]) imax = i
    expect(curve.omega[imax]).toBeGreaterThan(8)
    expect(curve.omega[imax]).toBeLessThan(12)
  })

  it('RK4 step advances under drive; rest with F0=0 and zero IC stays near 0', () => {
    const p = { mass: 1, stiffness: 4, damping: 0.2, driveAmp: 0, driveOmega: 1 }
    let s = { x: 0, v: 0 }
    for (let i = 0; i < 20; i++) s = forcedOscillatorStep(s, p, i * 0.01, 0.01)
    expect(Math.abs(s.x)).toBeLessThan(1e-9)

    const driven = { mass: 1, stiffness: 4, damping: 0.1, driveAmp: 2, driveOmega: 1 }
    let s2 = { x: 0, v: 0 }
    for (let i = 0; i < 200; i++) s2 = forcedOscillatorStep(s2, driven, i * 0.01, 0.01)
    expect(Math.abs(s2.x) + Math.abs(s2.v)).toBeGreaterThan(0.01)
  })
})
