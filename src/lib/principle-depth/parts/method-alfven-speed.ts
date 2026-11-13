import type { CalculationMethod } from '../types'
import {
  METHOD_ALFVEN,
  METHOD_ALGO_ALFVEN_V,
  MU0,
  DEFAULT_B,
  DEFAULT_RHO,
  alfvenSpeed,
} from '../../sim/alfven-algos'

const alfvenExpected = alfvenSpeed(DEFAULT_B, DEFAULT_RHO, MU0)

export const CALCULATION_METHOD_ALFVEN_SPEED: CalculationMethod = {
    id: 'method-alfven-speed',
    titleZh: '阿尔芬波速',
    titleEn: 'Alfvén speed',
    layer: 'L0',
    summaryZh: '理想 MHD 中磁张力与惯性平衡给出的特征波速 vA = B/√(μ0 ρ)。',
    summaryEn: 'Ideal-MHD characteristic speed from magnetic tension vs inertia.',
    simMethodIds: [METHOD_ALFVEN, METHOD_ALGO_ALFVEN_V],
    explainRoot: {
      id: 'alfven-root',
      layer: 'method',
      titleZh: '方法：阿尔芬波速',
      titleEn: 'Method: Alfvén speed',
      bodyZh:
        '顶层计算方法：给定 B 与质量密度 ρ，输出特征波速 vA。教学 L0 路径可本地求值；工程侧可挂到 MHD/等离子体相关 kind。',
      bodyEn:
        'Top method: given B and mass density ρ, output characteristic speed vA.',
      simMethodIds: [METHOD_ALGO_ALFVEN_V],
      children: [
        {
          id: 'alfven-principle-mhd',
          layer: 'principle',
          titleZh: '原理：磁张力与惯性',
          titleEn: 'Principle: magnetic tension vs inertia',
          bodyZh:
            '扰动在磁化等离子体中传播时，磁张力提供恢复力，惯性由质量密度承担。量级上波速 ~ 力/惯性 的开方。',
          bodyEn:
            'Magnetic tension restores; mass density supplies inertia. Wave speed scales as sqrt(tension/inertia).',
          children: [
            {
              id: 'alfven-foundation-formula',
              layer: 'foundation',
              titleZh: '基础式：vA = B / √(μ0 ρ)',
              titleEn: 'Foundation: vA = B / √(μ0 ρ)',
              bodyZh: 'SI 单位：B 特斯拉，ρ kg/m³，μ0 H/m，vA m/s。要求 ρ>0、μ0>0。',
              bodyEn: 'SI units; require ρ>0, μ0>0.',
              formula: {
                expr: 'vA = B / sqrt(mu0 * rho)',
                vars: {
                  vA: '阿尔芬波速 m/s',
                  B: '磁感应强度 T',
                  mu0: '真空磁导率 H/m',
                  rho: '质量密度 kg/m³',
                },
                sample: { B: DEFAULT_B, mu0: MU0, rho: DEFAULT_RHO },
                expected: alfvenExpected,
                plainZh: '由磁感应强度与质量密度计算阿尔芬波速',
                plainEn: 'Alfvén speed from magnetic field and mass density',
              },
            },
            {
              id: 'alfven-foundation-mu0',
              layer: 'foundation',
              titleZh: '基础常数：μ0',
              titleEn: 'Constant: μ0',
              bodyZh: `真空磁导率 μ0 ≈ ${MU0} H/m（CODATA 量级约定）。教学路径固定该常数。`,
              bodyEn: `Vacuum permeability μ0 ≈ ${MU0} H/m.`,
            },
            {
              id: 'alfven-foundation-assumptions',
              layer: 'foundation',
              titleZh: '假设与有效域',
              titleEn: 'Assumptions & domain',
              bodyZh:
                '理想 MHD、忽略电阻与热压主导的情形；ρ 过小或非有限输入返回 NaN。教学玩具默认 B、ρ 取实验室等离子体量级。',
              bodyEn:
                'Ideal MHD toy; non-finite or non-positive ρ → NaN. Default B,ρ are lab-plasma class.',
            },
          ],
        },
        {
          id: 'alfven-L0-teaching',
          layer: 'L0',
          titleZh: 'L0 教学叶子',
          titleEn: 'L0 teaching leaf',
          bodyZh:
            '实现：`src/lib/sim/alfven-algos.ts` 的 alfvenSpeed / runAlfvenVSample。不计入 engineering DoD。',
          bodyEn: 'Implemented in alfven-algos.ts; not engineering DoD credit.',
          simMethodIds: [METHOD_ALGO_ALFVEN_V],
        },
      ],
    },
  }
