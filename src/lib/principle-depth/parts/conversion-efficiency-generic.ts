import type { CalculationMethod } from '../types'

export const CALCULATION_CONVERSION_EFFICIENCY_GENERIC: CalculationMethod = {
    id: 'conversion-efficiency-generic',
    titleZh: '转换效率 η',
    titleEn: 'Conversion efficiency η',
    layer: 'method',
    summaryZh: '能量转换边的效率定义：有用输出 / 输入（η≤1 类过程的第一定律闸门）。',
    summaryEn: 'Efficiency as useful out / in (first-law style gate for η≤1 processes).',
    explainRoot: {
      id: 'eta-root',
      layer: 'method',
      titleZh: '方法：效率 η',
      titleEn: 'Method: efficiency η',
      bodyZh: '顶层 KPI：用输出与输入功率（或能量）定义效率。',
      bodyEn: 'Top KPI: efficiency from useful output and input.',
      children: [
        {
          id: 'eta-principle-1st',
          layer: 'principle',
          titleZh: '原理：能量守恒边界',
          titleEn: 'Principle: energy conservation bound',
          bodyZh: '对被动耗散型转换，η 不应超过 1；COP 类可大于 1 但不叫 η。',
          bodyEn: 'Passive dissipative conversions: η ≰ 1; COP may exceed 1.',
          children: [
            {
              id: 'eta-foundation-def',
              layer: 'foundation',
              titleZh: '基础定义：η = P_out / P_in',
              titleEn: 'Definition: η = P_out / P_in',
              bodyZh: '需标明输出/输入的物理口径（电、光、热…）。',
              bodyEn: 'Declare which powers count as out/in.',
              formula: {
                expr: 'eta = P_out / P_in',
                vars: {
                  eta: '效率 1',
                  P_out: '有用输出功率 W',
                  P_in: '输入功率 W',
                },
                sample: { P_out: 40, P_in: 100 },
                expected: 0.4,
                plainZh: '效率等于有用输出功率除以输入功率',
                plainEn: 'Efficiency is useful output power over input power',
              },
            },
          ],
        },
        {
          id: 'eta-knowledge',
          layer: 'principle',
          titleZh: '知识层：conversion.efficiency claim',
          titleEn: 'Knowledge: conversion.efficiency claim',
          bodyZh:
            'Knowledge DB claim kind `conversion.efficiency` 承载点值/区间与条件；Controversies 可挂多解释。',
          bodyEn:
            'Claim kind conversion.efficiency holds point/range + conditions; Controversies holds multi-explain.',
          claimKinds: ['conversion.efficiency'],
        },
      ],
    },
  }
