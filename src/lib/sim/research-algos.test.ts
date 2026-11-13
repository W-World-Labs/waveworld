import { describe, it, expect } from 'vitest'
import {
  METHOD_BEM,
  METHOD_DFT_ELECTRONIC,
  METHOD_FEM,
  METHOD_KALMAN,
  METHOD_LBM,
  METHOD_PIC,
  METHOD_RAY_OPTICS,
  METHOD_SPECTRAL,
  RESEARCH_SKELETON_IDS,
  bemPotentialAt,
  dftReal,
  isResearchSkeleton,
  kalman1dPredict,
  kalman1dUpdate,
  peakBin,
  runBemGreenSample,
  runDftElectronicSample,
  runDftPeakSample,
  runFemHeatLinkSample,
  runFemPoisson1dSample,
  runKalman1dSample,
  runLbmD1q3Sample,
  runPicCicSample,
  runSnellSample,
  snellResidual,
  snellTheta2,
} from './research-algos'
import { methodById } from '../../data/methods/methods'
import { fresnelReflection } from './fdtd'

describe('研究骨架 CATALOG 对齐', () => {
  it('骨架 id 均在目录中且无 simPaths', () => {
    expect(RESEARCH_SKELETON_IDS.length).toBe(6)
    for (const id of RESEARCH_SKELETON_IDS) {
      const m = methodById(id)
      expect(m, id).toBeDefined()
      expect(m!.simPaths?.length ?? 0).toBe(0)
      expect(isResearchSkeleton(id)).toBe(true)
    }
    // ray-optics 已挂 optics-lab，不再是无路径骨架
    expect(isResearchSkeleton(METHOD_RAY_OPTICS)).toBe(false)
    expect((methodById(METHOD_RAY_OPTICS)?.simPaths ?? []).includes('optics-lab')).toBe(true)
  })

  it('导出常量与 catalog 字符串一致', () => {
    expect(METHOD_RAY_OPTICS).toBe('method-ray-optics')
    expect(METHOD_SPECTRAL).toBe('method-spectral-method')
    expect(METHOD_KALMAN).toBe('method-kalman')
    expect(METHOD_FEM).toBe('method-fem')
    expect(METHOD_LBM).toBe('method-lattice-boltzmann')
    expect(METHOD_BEM).toBe('method-boundary-element')
    expect(METHOD_PIC).toBe('method-particle-in-cell')
    expect(METHOD_DFT_ELECTRONIC).toBe('method-dft-electronic')
  })
})

describe('ray-optics · Snell', () => {
  it('n1 sinθ1 = n2 sinθ2 残差近 0', () => {
    const r = runSnellSample()
    expect(r.methodId).toBe(METHOD_RAY_OPTICS)
    expect(r.tir).toBe(false)
    expect(Math.abs(r.residual)).toBeLessThan(1e-12)
    // θ2 < θ1 when n2 > n1
    expect(r.theta2).toBeLessThan(r.theta1)
    expect(r.theta2).toBeCloseTo(Math.asin((1 / 1.5) * Math.sin(Math.PI / 6)), 10)
  })

  it('全反射：密→疏大角 → NaN', () => {
    const th = snellTheta2(1.5, 1.0, Math.PI / 3)
    expect(Number.isNaN(th)).toBe(true)
  })

  it('可逆：θ1→θ2→θ1', () => {
    const n1 = 1.2
    const n2 = 1.8
    const t1 = 0.4
    const t2 = snellTheta2(n1, n2, t1)
    const back = snellTheta2(n2, n1, t2)
    expect(back).toBeCloseTo(t1, 10)
    expect(Math.abs(snellResidual(n1, n2, t1, t2))).toBeLessThan(1e-12)
  })

  it('菲涅耳正入射与 n=√ε 一致（复用 fdtd）', () => {
    const r = runSnellSample()
    expect(r.fresnelR).toBeCloseTo(fresnelReflection(1, 2.25), 12)
    expect(r.fresnelR).toBeGreaterThan(0.1)
    expect(r.fresnelR).toBeLessThan(0.3)
  })
})

describe('spectral · DFT peak', () => {
  it('正弦峰 bin 命中 k0', () => {
    const r = runDftPeakSample()
    expect(r.methodId).toBe(METHOD_SPECTRAL)
    expect(r.peakK === r.k0 || r.peakK === r.N - r.k0).toBe(true)
    expect(r.peakMag).toBeGreaterThan(r.mag0 * 10)
    // 单频功率应远大于直流（零均值正弦）
    expect(r.powerTone).toBeGreaterThan(r.powerDc * 50)
    expect(r.mag0).toBeLessThan(1e-8)
  })

  it('Parseval：Σ|x|² ≈ (1/N) Σ|X|²', () => {
    const x = new Float64Array(32)
    for (let n = 0; n < 32; n++) x[n] = Math.cos((2 * Math.PI * 3 * n) / 32)
    const { mag } = dftReal(x)
    let tx = 0
    let tX = 0
    for (let i = 0; i < 32; i++) {
      tx += x[i] * x[i]
      tX += mag[i] * mag[i]
    }
    expect(tX / 32).toBeCloseTo(tx, 8)
    const pk = peakBin(mag)
    expect(pk.k === 3 || pk.k === 29).toBe(true)
  })
})

describe('kalman · 1D predict-update', () => {
  it('常值估计逼近真值，P 下降', () => {
    const r = runKalman1dSample(30)
    expect(r.methodId).toBe(METHOD_KALMAN)
    expect(r.err).toBeLessThan(0.05)
    expect(r.P).toBeLessThan(r.P0)
    expect(r.estimate).toBeCloseTo(r.trueX, 1)
  })

  it('单步：增益与后验协方差公式', () => {
    const s0 = { x: 0, P: 1 }
    const pred = kalman1dPredict(s0, 1, 0.1)
    expect(pred.x).toBe(0)
    expect(pred.P).toBeCloseTo(1.1, 12)
    const up = kalman1dUpdate(pred, 2, 1, 0.5)
    // K = 1.1/(1.1+0.5)=1.1/1.6
    const K = 1.1 / 1.6
    expect(up.x).toBeCloseTo(0 + K * 2, 10)
    expect(up.P).toBeCloseTo((1 - K) * 1.1, 10)
  })
})

describe('FEM · 1D Poisson', () => {
  it('中点解逼近 x(1−x)/2', () => {
    const r = runFemPoisson1dSample(32)
    expect(r.methodId).toBe(METHOD_FEM)
    expect(r.errMid).toBeLessThan(1e-3)
    expect(r.maxU).toBeGreaterThan(0.1)
    expect(r.midU).toBeCloseTo(0.125, 2)
  })

  it('连续介质 heat 链：总热量守恒', () => {
    const r = runFemHeatLinkSample()
    expect(Math.abs(r.sumF - r.sum0) / r.sum0).toBeLessThan(1e-6)
  })
})

describe('LBM · D1Q3 BGK', () => {
  it('质量守恒，尖峰摊平', () => {
    const r = runLbmD1q3Sample(50, 1)
    expect(r.methodId).toBe(METHOD_LBM)
    expect(Math.abs(r.massF - r.mass0) / r.mass0).toBeLessThan(1e-10)
    expect(r.rhoMidF).toBeLessThan(r.rhoMid0)
    expect(r.rhoMidF).toBeGreaterThan(1)
  })
})

describe('BEM · Green 核', () => {
  it('u(0.5)≈1/8', () => {
    const r = runBemGreenSample()
    expect(r.methodId).toBe(METHOD_BEM)
    expect(r.errMid).toBeLessThan(1e-3)
    expect(r.uMid).toBeCloseTo(0.125, 2)
    // 边界应近 0
    expect(bemPotentialAt(0, 200)).toBeLessThan(1e-3)
    expect(bemPotentialAt(1, 200)).toBeLessThan(1e-3)
  })
})

describe('PIC · CIC 沉积', () => {
  it('粒子电荷 = 网格电荷总和', () => {
    const r = runPicCicSample()
    expect(r.methodId).toBe(METHOD_PIC)
    expect(r.chargeErr).toBeLessThan(1e-12)
    expect(r.Qparticles).toBeCloseTo(1, 12)
    expect(Number.isFinite(r.eFieldNorm)).toBe(true)
  })
})

describe('DFT electronic · 势阱基态', () => {
  it('密度归一且动能逼近 π²/2', () => {
    const r = runDftElectronicSample(500)
    expect(r.methodId).toBe(METHOD_DFT_ELECTRONIC)
    expect(r.densityNorm).toBeCloseTo(1, 3)
    expect(r.errT).toBeLessThan(1e-3)
    expect(r.analyticT).toBeCloseTo((Math.PI * Math.PI) / 2, 10)
    // 中点 ρ=|√2 sin(π/2)|² = 2
    expect(r.rhoMid).toBeCloseTo(2, 2)
  })
})
