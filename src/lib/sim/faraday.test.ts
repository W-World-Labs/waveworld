import { describe, it, expect } from 'vitest'
import { WasmFaraday } from './wasm-fields'
import {
  inducedEMF,
  motionalEMF,
  rotatingCoilFlux,
  rotatingCoilEMF,
  emfFromFluxSeries,
  faradayResult,
} from './faraday'

describe('法拉第电磁感应核心', () => {
  it('复用缓冲仍保留两周期曲线、正交关系与 SI 读数', () => {
    const owner = new WasmFaraday(1000)
    const scene = { omega: 4 * Math.PI, B: 0.3, N: 200, A: 0.01, vBar: 2, bMot: 0.5, lBar: 0.2 }
    const result = faradayResult(scene, owner)
    expect(result.flux).toHaveLength(361); expect(result.emf).toHaveLength(361)
    expect(result.linkage).toBeCloseTo(0.6, 12)
    expect(result.peak).toBeCloseTo(2.4 * Math.PI, 12)
    expect(result.frequency).toBe(2); expect(result.period).toBe(0.5)
    expect(result.motionalEmf).toBeCloseTo(0.2, 12)
    expect(result.flux[45]).toBeCloseTo(0, 12)
    expect(result.emf[45]).toBeCloseTo(result.peak, 12)
    expect(emfFromFluxSeries([], 1, 1, owner)).toEqual([])
    expect(Object.is(emfFromFluxSeries([1], 1, 1, owner)[0], -0)).toBe(true)
    faradayResult({ ...scene, N: 10 }, owner)
    expect(faradayResult(scene, owner)).toEqual(result)
  })
  // ① 恒定磁通 dΦ/dt=0 ⇒ ε=0
  it('恒定磁通：dΦ/dt=0 时感应 EMF 为零', () => {
    expect(inducedEMF(0, 1)).toBeCloseTo(0, 12)
    expect(inducedEMF(0, 500)).toBeCloseTo(0, 12)
  })

  // ② 线性磁通 Φ=kt ⇒ ε=−N·k 恒定
  it('线性磁通 Φ=kt：ε=−N·k 为常数', () => {
    const k = 2.5 // dΦ/dt
    const N = 12
    expect(inducedEMF(k, N)).toBeCloseTo(-N * k, 12)
    // 与离散序列差分对拍：Φ=k·t
    const dt = 0.01
    const ts = Array.from({ length: 50 }, (_, i) => i * dt)
    const flux = ts.map((t) => k * t)
    const emf = emfFromFluxSeries(flux, dt, N)
    // 内部点应恒等于 −N·k
    for (let i = 1; i < emf.length - 1; i++) {
      expect(emf[i]).toBeCloseTo(-N * k, 6)
    }
  })

  // ④ 楞次符号：磁通增大时 ε 取反向（符号为负）
  it('楞次定律：磁通增大(dΦ/dt>0)时 ε<0，减小时 ε>0', () => {
    expect(inducedEMF(3, 1)).toBeLessThan(0)
    expect(inducedEMF(-3, 1)).toBeGreaterThan(0)
  })

  // ⑤ 动生 ε=B·L·v 线性于 v
  it('动生 EMF：ε=B·L·v，对 v 线性', () => {
    const B = 0.5
    const L = 0.2
    expect(motionalEMF(B, L, 0)).toBeCloseTo(0, 12)
    expect(motionalEMF(B, L, 3)).toBeCloseTo(B * L * 3, 12)
    // 线性：v 翻倍则 ε 翻倍
    const e1 = motionalEMF(B, L, 2)
    const e2 = motionalEMF(B, L, 4)
    expect(e2).toBeCloseTo(2 * e1, 12)
  })

  // ③ 旋转线圈 EMF 为正弦、幅值=N·B·A·ω、与磁通相差 90°
  describe('旋转线圈', () => {
    const owner = new WasmFaraday(1000)
    const N = 200
    const B = 0.3
    const A = 0.01
    const omega = 2 * Math.PI * 50 // 50 Hz

    it('磁通 Φ(t)=N·B·A·cos(ωt)', () => {
      expect(rotatingCoilFlux(0, N, B, A, omega, owner)).toBeCloseTo(N * B * A, 12)
      const tQuarter = (Math.PI / 2) / omega
      expect(rotatingCoilFlux(tQuarter, N, B, A, omega, owner)).toBeCloseTo(0, 9)
    })

    it('EMF ε(t)=N·B·A·ω·sin(ωt)，峰值=N·B·A·ω', () => {
      const peak = N * B * A * omega
      // t=0 时 sin=0 ⇒ ε=0（此时磁通最大）
      expect(rotatingCoilEMF(0, N, B, A, omega, owner)).toBeCloseTo(0, 9)
      // 四分之一周期 sin=1 ⇒ ε=峰值
      const tQuarter = (Math.PI / 2) / omega
      expect(rotatingCoilEMF(tQuarter, N, B, A, omega, owner)).toBeCloseTo(peak, 6)
    })

    it('ε = −dΦ/dt：解析 EMF 与磁通数值差分一致', () => {
      const dt = 1e-6
      const N0 = 1000
      const ts = Array.from({ length: N0 }, (_, i) => i * dt)
      const flux = ts.map((t) => rotatingCoilFlux(t, N, B, A, omega, owner))
      const emfNum = emfFromFluxSeries(flux, dt, 1, owner) // 磁通已含 N，故此处 N=1
      const peak = N * B * A * omega
      for (let i = 1; i < emfNum.length - 1; i++) {
        const analytic = rotatingCoilEMF(ts[i], N, B, A, omega, owner)
        // 容许中心差分误差，用峰值归一化比较
        expect(Math.abs(emfNum[i] - analytic) / peak).toBeLessThan(1e-3)
      }
    })

    it('磁通与 EMF 相差 90°（磁通为 cos、EMF 为 sin）', () => {
      // 磁通过零(相位 π/2)处 EMF 取极值；磁通极值(相位 0)处 EMF 过零
      const tFluxMax = 0
      const tFluxZero = (Math.PI / 2) / omega
      expect(Math.abs(rotatingCoilFlux(tFluxMax, N, B, A, omega, owner))).toBeGreaterThan(0)
      expect(rotatingCoilEMF(tFluxMax, N, B, A, omega, owner)).toBeCloseTo(0, 9)
      expect(rotatingCoilFlux(tFluxZero, N, B, A, omega, owner)).toBeCloseTo(0, 9)
      expect(Math.abs(rotatingCoilEMF(tFluxZero, N, B, A, omega, owner))).toBeGreaterThan(0)
    })
  })
})
