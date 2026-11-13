import { describe, it, expect } from 'vitest'
import {
  MD_L2_BERENDSEN_METHOD_ID,
  MD_L2_PARENT,
  runBerendsenExpandSample,
  runBerendsenSample,
} from './md-l2-algos'

describe('MD 二级算法 · Berendsen 压浴', () => {
  it('方法 id 常量对齐目录', () => {
    expect(MD_L2_PARENT).toBe('method-md-lj')
    expect(MD_L2_BERENDSEN_METHOD_ID).toBe('method-algo-berendsen-barostat')
  })

  it('runBerendsenSample：NVT 后欠压 ⇒ μ<1、盒子收缩且有限', () => {
    const r = runBerendsenSample()
    expect(r.finite).toBe(true)
    expect(Number.isFinite(r.mu)).toBe(true)
    expect(r.mu).toBeLessThan(1)
    expect(r.Lafter).toBeLessThan(r.Lbefore)
    expect(r.Ptarget).toBeGreaterThan(r.Pinst)
    // 护栏内：|μ−1| 不超过默认 maxScale=0.02
    expect(r.mu).toBeGreaterThanOrEqual(1 - 0.02 - 1e-12)
  })

  it('runBerendsenExpandSample：超压 ⇒ μ>1、盒子膨胀', () => {
    const r = runBerendsenExpandSample()
    expect(r.finite).toBe(true)
    expect(r.mu).toBeGreaterThan(1)
    expect(r.Lafter).toBeGreaterThan(r.Lbefore)
    expect(r.mu).toBeLessThanOrEqual(1 + 0.02 + 1e-12)
  })
})
