import { describe, it, expect } from 'vitest'
import { diodeResponse, harmonics, harmonicAmplitudes, classify, junctionCoefficients, nljdResult } from './nljd'

// NOTE: these exercise the Rust/WASM kernel. After a kernel change they pass
// only once the embedded wasm artifact is rebuilt (scripts/build-wasm-kernels).

describe('diodeResponse — Shockley 结 i = Is·(e^{v/nVt} − 1)', () => {
  it('零偏置零电流；v = nVt·ln2 时 i = Is（解析黄金值）', () => {
    expect(diodeResponse(0, 1e-8, 0.0336)).toBe(0)
    expect(diodeResponse(0.25 * Math.LN2, 0.5, 0.25)).toBeCloseTo(0.5, 12)
  })

  it('单向整流：正偏远大于反偏幅度', () => {
    const fwd = diodeResponse(0.45, 1e-8, 0.0336)
    const rev = diodeResponse(-0.45, 1e-8, 0.0336)
    expect(fwd).toBeGreaterThan(-rev * 1e5)
  })

  it('无结（Is=0）无电流；nVt≤0 非物理被拒', () => {
    expect(diodeResponse(0.4, 0, 0.0336)).toBe(0)
    expect(() => diodeResponse(0.4, 1e-8, 0)).toThrow()
    expect(() => diodeResponse(0.4, -1e-8, 0.0336)).toThrow()
  })
})

describe('harmonicAmplitudes — 对算出的电流波形做真实 DFT', () => {
  it('注入已知单向非线性：2f/3f 均由测量给出，且 2f 占优', () => {
    const h = harmonicAmplitudes(1e-8, 0.0336)
    expect(h.f1).toBeGreaterThan(0)
    expect(h.f2).toBeGreaterThan(0)
    expect(h.f2).toBeGreaterThan(h.f3)
    // 强驱动指数结：实测 2f 约为基波同量级
    expect(h.f2 / h.f1).toBeGreaterThan(0.1)
  })

  it('谐波电平随器件参数变化，而非查表', () => {
    // nVt 越大指数越缓 → 非线性越弱 → 2f/1f 实测比值越小
    const hard = harmonicAmplitudes(1e-8, 0.0336)
    const soft = harmonicAmplitudes(1e-8, 0.15)
    expect(hard.f2 / hard.f1).toBeGreaterThan(soft.f2 / soft.f1)
    expect(hard.f2).not.toBeCloseTo(soft.f2, 10)
  })
})

describe('harmonics — 三类目标的实测谐波指纹', () => {
  it('半导体（单向结）：f2 > f3 且均显著', () => {
    const h = harmonics('semiconductor')
    expect(h.f2).toBeGreaterThan(h.f3)
    expect(h.f2 / h.f1).toBeGreaterThan(0.1)
  })

  it('锈蚀 MOM 假结（近对称反并联）：f3 > f2', () => {
    const h = harmonics('corrosion')
    expect(h.f3).toBeGreaterThan(h.f2)
    expect(h.f3 / h.f1).toBeGreaterThan(0.02)
  })

  it('纯金属（线性电阻）：谐波 ≈ 0，仅基波', () => {
    const h = harmonics('metal')
    expect(h.f2 / h.f1).toBeLessThan(1e-6)
    expect(h.f3 / h.f1).toBeLessThan(1e-6)
    expect(h.f1).toBeGreaterThan(0)
  })
})

describe('classify — 按实测谐波比阈值判读', () => {
  it('三类目标各自被正确判读', () => {
    expect(classify(harmonics('semiconductor'))).toBe('semiconductor')
    expect(classify(harmonics('corrosion'))).toBe('corrosion')
    expect(classify(harmonics('metal'))).toBe('metal')
  })

  it('阈值是 f2/f1 与 f3/f1 的测量比，不是查找表', () => {
    // 2f ≥ 3f 且高于 1% → 半导体；3f 占优 → 锈蚀；都低于阈值 → 金属
    expect(classify({ f1: 1, f2: 0.5, f3: 0.2 })).toBe('semiconductor')
    expect(classify({ f1: 1, f2: 0.02, f3: 0.3 })).toBe('corrosion')
    expect(classify({ f1: 1, f2: 0.005, f3: 0.005 })).toBe('metal')
    expect(classify({ f1: 0, f2: 0, f3: 0 })).toBe('metal')
  })
})

describe('nljdResult — 场景读出', () => {
  it('器件参数来自真实结参数（Is, nVt），金属无结', () => {
    expect(junctionCoefficients('semiconductor').a2).toBeCloseTo(1e-8, 12)
    expect(junctionCoefficients('corrosion').a2).toBeGreaterThan(0)
    const m = junctionCoefficients('metal')
    expect(m.a2).toBe(0)
    expect(m.a3).toBe(0)
  })

  it('verdict 来自计算谐波；transfer 为归一化静态 I–V', () => {
    for (const kind of ['semiconductor', 'corrosion', 'metal'] as const) {
      const r = nljdResult(kind)
      expect(r.verdict).toBe(kind)
      expect(r.transfer).toHaveLength(81)
      expect(r.relative.f1 + r.relative.f2 + r.relative.f3).toBeCloseTo(1, 12)
      expect(r.transfer[40]).toBeCloseTo(0, 12) // i(0) = 0
    }
    // 半导体：正峰归一为 1，反偏 ≈ 0（整流特性曲线）
    const s = nljdResult('semiconductor')
    expect(s.transfer[80]).toBeCloseTo(1, 12)
    expect(Math.abs(s.transfer[0])).toBeLessThan(1e-6)
    // 锈蚀近对称：反峰 ≈ −镜像比，幅度显著
    const c = nljdResult('corrosion')
    expect(c.transfer[0]).toBeLessThan(-0.5)
    // 金属：线性 I–V，端点 ±1
    const m = nljdResult('metal')
    expect(m.transfer[0]).toBeCloseTo(-1, 12)
    expect(m.transfer[80]).toBeCloseTo(1, 12)
  })
})
