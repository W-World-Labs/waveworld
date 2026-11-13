import type { ApplicationProfile } from '../types'

export const app_solar_cell: ApplicationProfile = {
    id: 'app-solar-cell',
    name: '太阳能电池 / 光伏',
    nameEn: 'Solar cell / PV',
    icon: '☀️',
    category: 'energy',
    blurb:
      '太阳辐射 → 电能：从电站系统一直下钻到 p-n 结载流子与材料能级。每一层都挂着真实转换边与可试跑方法。',
    goal: { from: 'radiant-solar', to: 'electric' },
    familyId: 'family-photovoltaic-stack',
    familyRole: '太阳辐射源 · 直接光伏',
    assemblyNote:
      '基准装配：源=太阳辐射，汇=电能。深层「带隙 / 载流子 / 肖克利–奎伊瑟极限」与热光伏共享；若把源换成热→红外再光伏，就变成热光伏。若整栈换成塞贝克结而非 p–n 光生伏，则进入热电族。',
    maturity: '商用',
    products: [
      { vendor: 'LONGi / Jinko', model: '单晶钝化发射极/隧穿氧化钝化接触组件', spec: 'η_module ~20–23%' },
      { vendor: '实验室', model: '多结 II伏安', spec: 'η_cell 记录 >40%（聚光）' },
    ],
    levels: [
      {
        id: 'pv-system',
        name: '系统层 · 电站 / 屋顶',
        nameEn: 'System: plant / rooftop',
        summary:
          '辐照 → 直流电 → 逆变器交流 → 并网。关注容量因子、朝向、阴影与数据中心式「系统账本」，而不是结物理。',
        energyNodeIds: ['radiant-solar', 'electric', 'el-current'],
        edgeIds: [
          'radiant-solar-to-electric-photovoltaic',
          'radiant-solar-to-el-current-photovoltaic',
        ],
        methodIds: [
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-pue-factor',
          'method-exergy-analysis',
        ],
        simPaths: ['paths', 'matrix', 'ai-chain'],
        children: [
          {
            id: 'pv-module',
            name: '组件层 · 封装与串并联',
            nameEn: 'Module: packaging & interconnect',
            summary:
              '多片电池串/并联：电流匹配、旁路二极管、封装损失（乙烯–醋酸乙烯酯、玻璃、电阻）。组件效率通常低于单片电池。',
            energyNodeIds: ['radiant-solar', 'el-current', 'thermal'],
            edgeIds: ['radiant-solar-to-el-current-photovoltaic'],
            methodIds: [
              'method-lumped-circuit',
              'method-algo-series-rlc',
              'method-algo-homog-series',
              'method-algo-homog-parallel',
            ],
            simPaths: ['rlc', 'transient'],
            children: [
              {
                id: 'pv-cell',
                name: '电池层 · 光伏效应',
                nameEn: 'Cell: photovoltaic effect',
                summary:
                  '光子 → 电子–空穴对 → 内建电场分离 → 外电路做功。η = 短路电流 × 开路电压 × 填充因子 / 入射功率。',
                energyNodeIds: ['radiant-solar', 'em-visible', 'em-ir', 'electric', 'thermal'],
                edgeIds: [
                  'radiant-solar-to-electric-photovoltaic',
                  'radiant-solar-to-el-current-photovoltaic',
                ],
                methodIds: [
                  'method-spectrum-viewer',
                  'method-algo-spectrum-em',
                  'method-display-opto',
                  'method-algo-led-bandgap',
                ],
                simPaths: ['electromagnetic', 'display'],
                children: [
                  {
                    id: 'pv-optics',
                    name: '光学层 · 光谱与吸收',
                    nameEn: 'Optics: spectrum & absorption',
                    summary:
                      '大气质量1.5 光谱哪些光子被吸收？减反射、光陷阱、带隙匹配。高于 Eg 的光子热化是主要损失之一。',
                    energyNodeIds: ['radiant-solar', 'em-visible', 'em-ir', 'em-uv', 'thermal'],
                    edgeIds: [
                      'radiant-solar-to-thermal-collector',
                      'radiant-solar-to-chemical-photosynthesis-primary',
                    ],
                    methodIds: [
                      'method-ray-optics',
                      'method-algo-snell',
                      'method-algo-fresnel-normal',
                      'method-spectral-method',
                      'method-algo-dft-1d',
                      'method-algo-fft-periodogram',
                    ],
                    simPaths: ['electromagnetic'],
                    children: [
                      {
                        id: 'pv-bandgap',
                        name: '材料层 · 带隙与态密度',
                        nameEn: 'Materials: bandgap',
                        summary:
                          '半导体能带：Eg 决定可吸收截止波长。肖克利–奎伊瑟极限来自详细平衡 + 光谱。',
                        energyNodeIds: ['chemical', 'radiant-solar', 'electric'],
                        methodIds: [
                          'method-shockley-queisser',
                          'method-algo-sq-limit',
                          'method-dft-electronic',
                          'method-algo-dft-well',
                          'method-algo-ks-scf',
                          'method-algo-lda-exchange',
                          'method-algo-exergy-efficiency',
                        ],
                        children: [
                          {
                            id: 'pv-carriers',
                            name: '载流子层 · 生成–复合–收集',
                            nameEn: 'Carriers: gen–recomb–collect',
                            summary:
                              '连续方程与漂移–扩散：寿命、扩散长度、表面复合决定收集效率。可用扩散/热方程作类比教学。',
                            energyNodeIds: ['electric', 'thermal'],
                            methodIds: [
                              'method-heat-ftcs',
                              'method-algo-heat-ftcs-step',
                              'method-algo-heat-erfc',
                              'method-ns-stable-fluids',
                              'method-algo-fluid-diffuse',
                            ],
                            simPaths: ['sim', 'heaterfc'],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    id: 'pv-losses',
                    name: '损失账本 · 热化 / 电阻 / 㶲',
                    nameEn: 'Loss ledger',
                    summary:
                      '未吸收、热化、复合、串联电阻、逆变器……用 η 连乘与㶲效率拆账，而不是一个黑箱百分比。',
                    energyNodeIds: ['thermal', 'electric', 'radiant-solar'],
                    methodIds: [
                      'method-algo-eta-product',
                      'method-algo-exergy-carnot',
                      'method-algo-exergy-lost-work',
                      'method-algo-exergy-efficiency',
                      'method-algo-path-mc-eta',
                    ],
                    simPaths: ['paths', 'matrix'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
