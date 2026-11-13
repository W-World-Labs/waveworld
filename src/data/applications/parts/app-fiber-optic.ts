import type { ApplicationProfile } from '../types'

export const app_fiber_optic: ApplicationProfile = {
    id: 'app-fiber-optic',
    name: '光纤通信',
    nameEn: 'Fiber-optic communications',
    icon: '📡',
    category: 'compute',
    blurb:
      '电信号 → 激光/调制光 → 光纤导波 → 光电检测还原电信号。链路预算与色散/非线性是核心账本。',
    goal: { from: 'electric', to: 'electric' },
    familyId: 'family-fiber-optic',
    familyRole: '通信链路 · 色散/误码预算',
    assemblyNote:
      '相对光纤数值孔径耦合链路(光纤链路应用)：同为电→光→电闭环与纤芯导模，但本档案强调调制、色散与 数字信号处理 误码，而非数值孔径耦合与比尔–朗伯衰减账本。',
    maturity: '骨干网商用',
    products: [
      { vendor: '单模 G.652', model: 'EDFA 中继链路', spec: 'C 波段 ~1550 nm' },
    ],
    levels: [
      {
        id: 'fo-link',
        name: '系统层 · 光链路',
        summary:
          '发射机–光纤–放大器–接收机。用电–光–电完整闭环评估误码与功率预算；弗里斯/路径效率可作抽象对照。',
        energyNodeIds: ['electric', 'el-current', 'radiant-laser', 'em-visible', 'em-ir'],
        edgeIds: [
          'el-current-to-radiant-laser-diode',
          'electric-to-visible-laser',
          'edge-electric-to-laser',
          'radiant-laser-to-electric-photovoltaic',
          'radiant-luminescence-to-electric-photodiode',
        ],
        methodIds: [
          'method-algo-friis-link',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-laser-rate',
          'method-algo-laser-threshold',
        ],
        simPaths: ['paths', 'laser', 'matrix'],
        children: [
          {
            id: 'fo-tx',
            name: '发射层 · 激光与调制',
            summary:
              '半导体激光阈值与速率方程决定边模与啁啾；电注入→受激辐射光子流。',
            energyNodeIds: ['electric', 'el-current', 'radiant-laser', 'em-ir', 'thermal'],
            edgeIds: [
              'el-current-to-radiant-laser-diode',
              'electric-to-visible-laser',
              'edge-electric-to-laser',
              'electric-to-thermal-joule',
            ],
            methodIds: [
              'method-laser-rate',
              'method-algo-laser-threshold',
              'method-algo-laser-step',
              'method-algo-laser-steady',
              'method-lumped-circuit',
            ],
            simPaths: ['laser', 'rlc'],
            children: [
              {
                id: 'fo-fiber-guide',
                name: '光纤层 · 导模与色散',
                summary:
                  '纤芯–包层全反射束缚模式；折射率剖面决定色散与损耗。光束传播 / 传输矩阵 / 射线光学是可动手工具。',
                energyNodeIds: ['radiant-laser', 'em-ir', 'em-visible', 'electromagnetic'],
                edgeIds: [
                  'radiant-laser-to-thermal-absorption',
                  'edge-laser-to-thermal',
                ],
                methodIds: [
                  'method-bpm',
                  'method-algo-bpm-split-step',
                  'method-algo-bpm-kerr',
                  'method-tmm',
                  'method-algo-tmm-layer',
                  'method-algo-tmm-stack',
                  'method-ray-optics',
                  'method-algo-snell',
                  'method-algo-critical-angle',
                  'method-algo-fresnel-normal',
                ],
                simPaths: ['electromagnetic', 'fdtd'],
                children: [
                  {
                    id: 'fo-rx-dsp',
                    name: '接收层 · 光电检测与数字处理',
                    summary:
                      '光电二极管把光功率变为电流；均衡、快速傅里叶频谱与滤波对抗色散与噪声。',
                    energyNodeIds: ['radiant-laser', 'em-ir', 'electric', 'el-current'],
                    edgeIds: [
                      'radiant-laser-to-electric-photovoltaic',
                      'radiant-luminescence-to-electric-photodiode',
                      'em-ir-to-el-current-photodiode',
                      'radiant-to-electric-photoconductive',
                    ],
                    methodIds: [
                      'method-fft',
                      'method-algo-fft-periodogram',
                      'method-algo-dsp-remove-dc',
                      'method-algo-dsp-moving-avg',
                      'method-kalman',
                      'method-algo-kalman-1d',
                      'method-lumped-circuit',
                    ],
                    simPaths: ['transient', 'electromagnetic'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
