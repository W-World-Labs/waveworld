import { describe, it, expect } from 'vitest'
import { pattern2D, directivityDb, beamwidth3dB, friisLink } from './antennalink'
import { WasmAntenna } from './wasm-fields'

const DEG = Math.PI / 180

describe('天线方向图', () => {
  it('directional directivity integrates field squared over solid angle', () => {
    const n = 720, dTheta = Math.PI / n
    const run = new WasmAntenna('antenna3d')
    let integral = 0
    for (let i = 0; i < n; i++) {
      const theta = (i + 0.5) * dTheta
      integral += pattern2D('directional', theta, run) ** 2 * Math.sin(theta) * dTheta
    }
    expect(directivityDb('directional')).toBeCloseTo(10 * Math.log10(2 / integral), 3)
  })
  it('isotropic 各向恒为 1', () => {
    for (const t of [0, 30, 90, 150, 180, 270]) {
      expect(pattern2D('isotropic', t * DEG)).toBeCloseTo(1, 9)
    }
  })

  it('dipole 峰值在 θ=π/2（赤道面），轴向为零点', () => {
    // 峰值=1 在 θ=90°
    expect(pattern2D('dipole', 90 * DEG)).toBeCloseTo(1, 6)
    // 轴向 θ=0/180 为零点
    expect(pattern2D('dipole', 0)).toBeCloseTo(0, 6)
    expect(pattern2D('dipole', 180 * DEG)).toBeCloseTo(0, 6)
    // 峰值确实是全局最大：其它角度都 <= 赤道面
    for (const t of [10, 30, 45, 60, 120, 150]) {
      expect(pattern2D('dipole', t * DEG)).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(pattern2D('dipole', 45 * DEG)).toBeLessThan(pattern2D('dipole', 90 * DEG))
  })

  it('directional 主瓣朝 θ=0，后半空间无辐射', () => {
    expect(pattern2D('directional', 0)).toBeCloseTo(1, 6)
    expect(pattern2D('directional', 100 * DEG)).toBe(0)
    expect(pattern2D('directional', 180 * DEG)).toBe(0)
    // 偏离主轴衰减
    expect(pattern2D('directional', 20 * DEG)).toBeLessThan(pattern2D('directional', 0))
  })

  it('directional 主瓣比 dipole 更窄（−3dB 波束宽度更小）', () => {
    const bwDir = beamwidth3dB('directional')
    const bwDip = beamwidth3dB('dipole')
    expect(bwDir).toBeLessThan(bwDip)
    // isotropic 无主瓣 → 360°
    expect(beamwidth3dB('isotropic')).toBe(360)
  })

  it('方向性 dBi：isotropic=0 < dipole < directional', () => {
    expect(directivityDb('isotropic')).toBeCloseTo(0, 9)
    expect(directivityDb('dipole')).toBeGreaterThan(0)
    expect(directivityDb('directional')).toBeGreaterThan(directivityDb('dipole'))
    // 半波偶极子标称 ≈ 2.15 dBi
    expect(directivityDb('dipole')).toBeCloseTo(2.15, 2)
  })
})

describe('Friis 链路预算', () => {
  it('距离增大 → Pr 下降、FSPL 上升', () => {
    const a = friisLink(30, 6, 6, 2.4e9, 100)
    const b = friisLink(30, 6, 6, 2.4e9, 1000)
    expect(b.fsplDb).toBeGreaterThan(a.fsplDb)
    expect(b.prDbm).toBeLessThan(a.prDbm)
  })

  it('距离×10 → FSPL +20dB、Pr −20dB', () => {
    const a = friisLink(20, 3, 3, 1e9, 50)
    const b = friisLink(20, 3, 3, 1e9, 500)
    expect(b.fsplDb - a.fsplDb).toBeCloseTo(20, 6)
    expect(a.prDbm - b.prDbm).toBeCloseTo(20, 6)
  })

  it('黄金值：f=1GHz, d=1m 的 FSPL ≈ 32.45dB', () => {
    // FSPL(dB) = 20log10(4π·d·f/c)，1GHz/1m 标准参考 ≈ 32.45 dB
    const { fsplDb } = friisLink(0, 0, 0, 1e9, 1)
    expect(fsplDb).toBeCloseTo(32.45, 1)
  })

  it('Pr = Pt + Gt + Gr − FSPL 恒等', () => {
    const pt = 23, gt = 5, gr = 8
    const { prDbm, fsplDb } = friisLink(pt, gt, gr, 5.8e9, 300)
    expect(prDbm).toBeCloseTo(pt + gt + gr - fsplDb, 9)
  })
})
