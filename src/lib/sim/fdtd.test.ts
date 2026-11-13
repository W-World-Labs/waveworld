// src/lib/sim/fdtd.test.ts
// 2D FDTD（TMz）核心 TDD：CFL 稳定性、真空光速传播、菲涅耳反射、PEC 能量守恒、Mur 吸收。
import { describe, it, expect } from 'vitest'
import {
  createField,
  fdtdStep,
  injectSoftSource,
  totalEnergy,
  gaussianPulse,
  sineCW,
  fresnelReflection,
  CpuFdtd,
  FDTD_BOUNDARY_DEFAULT,
  type FdtdBoundary,
  type FdtdField,
} from './fdtd'

/** 跑 n 步，每步先用 src 注入软源（src 可选），返回过程中 max|Ez|。 */
function run(f: FdtdField, n: number, src?: (t: number) => void): number {
  let maxAbs = 0
  for (let t = 0; t < n; t++) {
    if (src) src(t)
    fdtdStep(f)
    for (let k = 0; k < f.Ez.length; k++) {
      const a = Math.abs(f.Ez[k])
      if (a > maxAbs) maxAbs = a
    }
  }
  return maxAbs
}

describe('helpers', () => {
  it('gaussianPulse 在 t=t0 取峰值 1，两侧衰减', () => {
    expect(gaussianPulse(20, 20, 6)).toBeCloseTo(1, 6)
    expect(gaussianPulse(20 + 6, 20, 6)).toBeLessThan(gaussianPulse(20, 20, 6))
    expect(gaussianPulse(40, 20, 6)).toBeLessThan(0.01)
  })

  it('sineCW 周期正确', () => {
    const omega = 0.3
    expect(sineCW(0, omega)).toBeCloseTo(0, 6)
    expect(sineCW(Math.PI / 2 / omega, omega)).toBeCloseTo(1, 5)
  })

  it('fresnelReflection(1,4) = 1/3', () => {
    expect(fresnelReflection(1, 4)).toBeCloseTo(1 / 3, 6)
    expect(fresnelReflection(1, 1)).toBeCloseTo(0, 6)
    // 对称：界面两侧反射幅相等
    expect(fresnelReflection(4, 1)).toBeCloseTo(fresnelReflection(1, 4), 6)
  })
})

describe('createField', () => {
  it('零场 + eps 缺省 1 + 默认最强吸收 cpml 边界', () => {
    const f = createField(16, 12)
    expect(f.Nx).toBe(16)
    expect(f.Ny).toBe(12)
    expect(f.Ez.length).toBe(16 * 12)
    expect(f.eps.length).toBe(16 * 12)
    expect(f.boundary).toBe(FDTD_BOUNDARY_DEFAULT)
    let sumE = 0
    for (let k = 0; k < f.Ez.length; k++) sumE += Math.abs(f.Ez[k])
    expect(sumE).toBe(0)
    expect(f.eps[0]).toBe(1)
    expect(f.eps[f.eps.length - 1]).toBe(1)
  })

  it('全部边界可选：mur/mur1/mur2/cpml/pec', () => {
    const modes: FdtdBoundary[] = ['mur', 'mur1', 'mur2', 'cpml', 'pec']
    for (const boundary of modes) {
      const f = createField(20, 16, { S: 0.5, boundary })
      expect(f.Ez.length).toBe(20 * 16)
    }
    // 'mur1' 是 'mur' 的别名：同一条 WASM 一阶 Mur 路径，读回有效模式 'mur'。
    expect(createField(20, 16, { S: 0.5, boundary: 'mur1' }).boundary).toBe('mur')
    // mur2/cpml 的边界态挂在场结构上。
    const m2 = createField(20, 16, { S: 0.5, boundary: 'mur2' }) as CpuFdtd
    expect(m2.boundary).toBe('mur2')
    expect(m2.m2Left?.length).toBe(16)
    expect(m2.m2BottomIn?.length).toBe(20)
    const cp = createField(20, 16, { S: 0.5, boundary: 'cpml' }) as CpuFdtd
    expect(cp.psiEzX?.length).toBe(20 * 16)
    expect(cp.psiHyX?.length).toBe(20 * 16)
  })
})

describe('① CFL 稳定性判据', () => {
  it('S=0.5 稳定（300 步有界，无 NaN），S=2 在执行前拒绝', () => {
    const N = 60
    const stable = createField(N, N, { S: 0.5, boundary: 'mur' })
    const cx = (N >> 1) + N * (N >> 1)
    const maxStable = run(stable, 300, (t) => { stable.Ez[cx] += gaussianPulse(t, 20, 6) })
    expect(Number.isFinite(maxStable)).toBe(true)
    expect(maxStable).toBeLessThan(10) // 软源峰值 ~1，稳定档不应放大到离谱

    expect(() => createField(N, N, { S: 2, boundary: 'mur' })).toThrow(/CFL/)

  })
})

describe('② 真空光速传播（c=1）', () => {
  it('波前到达固定半径的步数与 r/(S/√2·√2)=r/S 一致量级，且外传单调', () => {
    const N = 120
    const f = createField(N, N, { S: 0.5, boundary: 'mur' })
    const ic = N >> 1
    const center = ic + N * ic
    // 注入一个短脉冲（前 ~40 步），之后自由传播
    const radius = 30
    const probeI = ic + radius
    const probe = probeI + N * ic // 沿 +x 方向，距中心 radius 格
    let arrivalStep = -1
    const threshold = 1e-3
    for (let t = 0; t < 400; t++) {
      if (t < 40) f.Ez[center] += gaussianPulse(t, 15, 4)
      fdtdStep(f)
      if (arrivalStep < 0 && Math.abs(f.Ez[probe]) > threshold) arrivalStep = t
    }
    expect(arrivalStep).toBeGreaterThan(0)
    // 约化光速 c=1、Δx=1、dt=S/√2：每步波前推进 c·dt = dt 格。
    // 走 radius 格的理想步数 = radius / dt。容差留宽（数值色散 + 阈值检测延迟）。
    const ideal = radius / f.dt
    expect(arrivalStep).toBeGreaterThan(ideal * 0.4)
    expect(arrivalStep).toBeLessThan(ideal * 2.5)
  })

  it('球面对称：同半径不同方向到达步数接近', () => {
    const N = 120
    const f = createField(N, N, { S: 0.5, boundary: 'mur' })
    const ic = N >> 1
    const center = ic + N * ic
    const r = 25
    const probes = [
      (ic + r) + N * ic,        // +x
      (ic - r) + N * ic,        // -x
      ic + N * (ic + r),        // +y
      ic + N * (ic - r),        // -y
    ]
    const arr = probes.map(() => -1)
    const threshold = 1e-3
    for (let t = 0; t < 400; t++) {
      if (t < 40) f.Ez[center] += gaussianPulse(t, 15, 4)
      fdtdStep(f)
      probes.forEach((p, k) => {
        if (arr[k] < 0 && Math.abs(f.Ez[p]) > threshold) arr[k] = t
      })
    }
    arr.forEach((a) => expect(a).toBeGreaterThan(0))
    const mn = Math.min(...arr), mx = Math.max(...arr)
    expect(mx - mn).toBeLessThan(8) // 各向几乎一致（轴向对称严格相等，留色散容差）
  })
})

describe('③ 介质菲涅耳反射 eps 阶跃 1→4', () => {
  it('反射幅/入射幅 ≈ 1/3（容差宽）', () => {
    // 高条（y 方向均匀）沿 +x 平面波正入射，eps 阶跃 1→4。
    // 标准 FDTD 反射量测法：跑两遍——
    //   (A) 全 eps=1 参考场（无界面、无反射）→ 探针处纯入射波形；
    //   (B) eps 阶跃 1→4。探针处 (B)−(A) 即隔离出反射波（探针在界面左侧真空区）。
    // 探针贴近界面以减小反射波多走路径累积的数值色散误差。
    const Nx = 400, Ny = 60
    const iface = 200
    const srcI = 40
    const jc = Ny >> 1
    const probeI = 180 // 界面左侧、贴近界面的真空探针
    const probe = probeI + Nx * jc

    const buildEps = (stepUp: boolean): Float32Array => {
      const e = new Float32Array(Nx * Ny)
      for (let i = 0; i < Nx; i++) {
        const val = stepUp && i >= iface ? 4 : 1
        for (let j = 0; j < Ny; j++) e[i + Nx * j] = val
      }
      return e
    }
    const STEPS = 1200

    // 平面波：整列同相注入软源（y 方向无梯度 → 平面波），有限时长（前 80 步）。
    const recordProbe = (stepUp: boolean): Float32Array => {
      const f = createField(Nx, Ny, { S: 0.5, boundary: 'mur', eps: buildEps(stepUp) })
      const rec = new Float32Array(STEPS)
      for (let t = 0; t < STEPS; t++) {
        if (t < 80) {
          const s = gaussianPulse(t, 40, 8)
          for (let j = 0; j < Ny; j++) f.Ez[srcI + Nx * j] += s
        }
        fdtdStep(f)
        rec[t] = f.Ez[probe]
      }
      return rec
    }

    const ref = recordProbe(false) // 纯入射
    const stp = recordProbe(true)  // 入射 + 反射

    let incPeak = 0
    let refPeak = 0
    for (let t = 0; t < STEPS; t++) {
      incPeak = Math.max(incPeak, Math.abs(ref[t]))
      refPeak = Math.max(refPeak, Math.abs(stp[t] - ref[t])) // 隔离反射
    }

    expect(incPeak).toBeGreaterThan(1e-2)
    const ratio = refPeak / incPeak
    const expected = fresnelReflection(1, 4) // 1/3
    // FDTD 数值色散 + 近场驻波，容差留宽 ±50%。
    expect(ratio).toBeGreaterThan(expected * 0.5)
    expect(ratio).toBeLessThan(expected * 1.5)
  })
})

describe('④ PEC 封闭腔能量守恒', () => {
  it('无源初始场，跑多步 totalEnergy 漂移 < 5%', () => {
    const N = 50
    const f = createField(N, N, { S: 0.5, boundary: 'pec' })
    // 给定平滑初始 Ez（避免高频数值色散过强），中心高斯包
    const ic = N / 2
    for (let i = 1; i < N - 1; i++) {
      for (let j = 1; j < N - 1; j++) {
        const dx = i - ic, dy = j - ic
        f.Ez[i + N * j] = Math.exp(-(dx * dx + dy * dy) / 50)
      }
    }
    const e0 = totalEnergy(f)
    expect(e0).toBeGreaterThan(0)
    let emin = e0, emax = e0
    for (let t = 0; t < 400; t++) {
      fdtdStep(f)
      const e = totalEnergy(f)
      emin = Math.min(emin, e)
      emax = Math.max(emax, e)
    }
    const drift = (emax - emin) / e0
    expect(drift).toBeLessThan(0.05)
  })
})

describe('⑤ Mur 吸收 vs PEC 留存', () => {
  it('mur 开域脉冲传出后腔内能量趋近 0；pec 能量留存', () => {
    const N = 80
    const for_ = (boundary: 'mur' | 'pec') => {
      const f = createField(N, N, { S: 0.5, boundary })
      const c = (N >> 1) + N * (N >> 1)
      let peak = 0
      for (let t = 0; t < 30; t++) {
        injectSoftSource(f, N >> 1, N >> 1, gaussianPulse(t, 12, 4))
        fdtdStep(f)
        peak = Math.max(peak, totalEnergy(f))
      }
      void c
      // 让波传到边界外
      for (let t = 0; t < 400; t++) fdtdStep(f)
      return { residual: totalEnergy(f), peak }
    }
    const mur = for_('mur')
    const pec = for_('pec')
    // Mur：残余 < 初始峰值能量的 20%
    expect(mur.residual).toBeLessThan(mur.peak * 0.2)
    // PEC：能量基本留存（远大于 mur 残余）
    expect(pec.residual).toBeGreaterThan(mur.residual * 5)
    expect(pec.residual).toBeGreaterThan(pec.peak * 0.3)
  })
})

describe('⑥ mur2 / cpml 吸收边界', () => {
  it('CpuFdtd 的 mur 与 WASM 内核逐步位级一致（镜像校验）', () => {
    const a = createField(48, 48, { S: 0.5, boundary: 'mur' }) // WASM 内核
    const b = new CpuFdtd(48, 48, 0.5 / Math.SQRT2, 1, 'mur') // JS 镜像
    for (let t = 0; t < 200; t++) {
      const s = gaussianPulse(t, 20, 5)
      injectSoftSource(a, 12, 24, s)
      b.inject(12, 24, s)
      fdtdStep(a)
      b.step()
    }
    expect(Array.from(b.Ez)).toEqual(Array.from(a.Ez))
    expect(Array.from(b.Hx)).toEqual(Array.from(a.Hx))
    expect(Array.from(b.Hy)).toEqual(Array.from(a.Hy))
    expect(b.energy()).toBeCloseTo(a.energy(), 10)
  })

  it('近法向反射：mur2 比 mur 低约一个数量级，cpml 低约两个数量级', () => {
    // 参考域扣除法（与 Rust 端测试一致）：测试域 160 宽、参考域 480 宽，
    // 源/左/上下壁相同 → 探针差值只含测试域右墙反射。窄带脉冲 σ=24；
    // NY 较高、线源两端留边，使源端绕射晚于直达回波窗口才到达探针。
    const NX_T = 160, NX_R = 480, NY = 160, STEPS = 560
    const PROBE_I = 140, PROBE_J = NY >> 1
    const record = (nx: number, boundary: FdtdBoundary): Float64Array => {
      const f = createField(nx, NY, { S: 0.5, boundary })
      const rec = new Float64Array(STEPS)
      for (let t = 0; t < STEPS; t++) {
        if (t < 400) {
          const s = gaussianPulse(t, 100, 24)
          for (let j = 12; j < NY - 12; j++) f.Ez[40 + nx * j] += s
        }
        fdtdStep(f)
        rec[t] = f.Ez[PROBE_J * nx + PROBE_I]
      }
      return rec
    }
    const ratio = (boundary: FdtdBoundary): number => {
      const test = record(NX_T, boundary)
      const ref = record(NX_R, boundary)
      let inc = 0, refp = 0
      for (let t = 0; t < STEPS; t++) {
        inc = Math.max(inc, Math.abs(ref[t]))
        // 直达回波 ~t∈[450,560]；源端绕射更晚到达，窗口外。
        if (t >= 440 && t < 560) refp = Math.max(refp, Math.abs(test[t] - ref[t]))
      }
      return refp / inc
    }
    const mur = ratio('mur'), mur2 = ratio('mur2'), cpml = ratio('cpml')
    expect(mur).toBeGreaterThan(0.005) // mur1 确实反射，作分母有效
    expect(mur2).toBeLessThan(mur * 0.1)
    expect(cpml).toBeLessThan(mur * 0.01)
  }, 20000)

  it('开域残余能量：mur2、cpml 都低于 mur', () => {
    // CPML 层内仍存留缓慢衰减的场，残余只在层外内区量测（同 Rust 端做法）。
    const N = 120, MARGIN = 14
    const interiorEnergy = (f: FdtdField): number => {
      let sum = 0
      for (let j = MARGIN; j < N - MARGIN; j++)
        for (let i = MARGIN; i < N - MARGIN; i++) {
          const k = j * N + i
          sum += f.eps[k] * f.Ez[k] * f.Ez[k] + f.mu * (f.Hx[k] * f.Hx[k] + f.Hy[k] * f.Hy[k])
        }
      return 0.5 * sum
    }
    const for_ = (boundary: FdtdBoundary) => {
      const f = createField(N, N, { S: 0.5, boundary })
      let peak = 0
      for (let t = 0; t < 600; t++) {
        if (t < 40) {
          injectSoftSource(f, N >> 1, N >> 1, gaussianPulse(t, 18, 6))
          fdtdStep(f)
          peak = Math.max(peak, interiorEnergy(f))
        } else fdtdStep(f)
      }
      return { residual: interiorEnergy(f), peak }
    }
    const mur = for_('mur'), mur2 = for_('mur2'), cpml = for_('cpml')
    // 点源残差含掠入射/角点成分，增益收窄；量级断言在上一测试。
    expect(mur2.residual).toBeLessThan(mur.residual)
    expect(cpml.residual).toBeLessThan(mur.residual * 0.2)
  }, 20000)
})
