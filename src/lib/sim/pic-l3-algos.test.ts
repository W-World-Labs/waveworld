import { describe, it, expect } from 'vitest'
import {
  PIC_L3_PARENT,
  METHOD_ALGO_PIC_BORIS,
  PIC_L3_METHOD_IDS,
  borisPush2dMagnetic,
  borisStep2d,
  estimateCyclotronOmega,
  runBorisPushSample,
  speed2,
} from './pic-l3-algos'
import { PIC_L2_PARENT } from './pic-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('PIC L3 · Boris 2D 常 B 推进', () => {
  it('方法 id 常量（boris 为未入库新 id）', () => {
    expect(PIC_L3_PARENT).toBe('method-particle-in-cell')
    expect(PIC_L3_PARENT).toBe(PIC_L2_PARENT)
    expect(METHOD_ALGO_PIC_BORIS).toBe('method-algo-pic-boris')
    expect(PIC_L3_METHOD_IDS).toContain(METHOD_ALGO_PIC_BORIS)
    expect(methodById(PIC_L3_PARENT)).toBeDefined()
  })

  it('borisPush2dMagnetic：单步 |v| 不变', () => {
    const vx = 0.8
    const vy = -0.4
    const s0 = Math.hypot(vx, vy)
    const out = borisPush2dMagnetic(vx, vy, 1.5, 3, 0.05)
    expect(speed2(out)).toBeCloseTo(s0, 12)
  })

  it('B=0：速度不变', () => {
    const out = borisPush2dMagnetic(1, 2, 1, 0, 0.1)
    expect(out.x).toBeCloseTo(1, 14)
    expect(out.y).toBeCloseTo(2, 14)
  })

  it('borisStep2d 纯 B：多步 |v| 守恒', () => {
    let pos = { x: 0, y: 0 }
    let vel = { x: 1, y: 0 }
    const s0 = speed2(vel)
    for (let i = 0; i < 100; i++) {
      const r = borisStep2d(pos, vel, 1, 0, 0, 2, 0.03)
      pos = r.pos
      vel = r.vel
    }
    expect(speed2(vel)).toBeCloseTo(s0, 10)
  })

  it('estimateCyclotronOmega 逼近 qB/m', () => {
    const qom = 1
    const Bz = 2
    const dt = 0.01
    const hist = [{ x: 1, y: 0 }]
    let vel = { x: 1, y: 0 }
    let pos = { x: 0, y: 0 }
    for (let i = 0; i < 300; i++) {
      const r = borisStep2d(pos, vel, qom, 0, 0, Bz, dt)
      pos = r.pos
      vel = r.vel
      hist.push({ x: vel.x, y: vel.y })
    }
    const w = Math.abs(estimateCyclotronOmega(hist, dt))
    expect(Math.abs(w - Math.abs(qom * Bz)) / Math.abs(qom * Bz)).toBeLessThan(
      0.02,
    )
  })

  it('runBorisPushSample：|v| 守恒且 ω ~ qB/m', () => {
    const r = runBorisPushSample()
    expect(r.methodId).toBe(METHOD_ALGO_PIC_BORIS)
    expect(r.familyId).toBe(PIC_L3_PARENT)
    expect(r.maxRelSpeedErr).toBeLessThan(1e-10)
    expect(r.speedF).toBeCloseTo(r.speed0, 10)
    expect(r.omegaRelErr).toBeLessThan(0.05)
    expect(r.omegaExact).toBeCloseTo(2.5, 12)
  })
})
