import type { ApplicationProfile } from '../types'

export const app_tpv: ApplicationProfile = {
    id: 'app-tpv',
    name: '热光伏',
    nameEn: 'Thermophotovoltaic',
    icon: '🔥☀️',
    category: 'energy',
    blurb:
      '热能 / 红外辐射 → 电能：同一「光伏结」栈，源不再是太阳，而是黑体/燃烧器/余热发出的热辐射。',
    goal: { from: 'thermal', to: 'electric' },
    familyId: 'family-photovoltaic-stack',
    familyRole: '热辐射源 · 热光伏',
    assemblyNote:
      '相对太阳能电池：源从 太阳辐射 换成热能（经 红外电磁 辐射）。仍用 p–n / 多结吸收光子；中间多一跳「热→红外」。深层肖克利–奎伊瑟/带隙/载流子方法可复用。',
    maturity: '示范/商用边缘',
    products: [
      { vendor: '实验室 / MIT-NREL 类', model: '高效率热光伏单元', spec: '辐射→电记录区 >40%（窄带）' },
    ],
    levels: [
      {
        id: 'tpv-system',
        name: '系统层 · 热源 + 发射体 + 电池',
        summary:
          '热库加热选择性发射体 → 红外光子 → 热光伏电池 → 电。可挂余热、燃料、核衰变热。',
        energyNodeIds: ['thermal', 'em-ir', 'electric'],
        edgeIds: [
          'thermal-to-electric-thermophotovoltaic',
          'em-ir-to-electric-thermophotovoltaic',
        ],
        methodIds: [
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-shockley-queisser',
          'method-algo-sq-limit',
        ],
        simPaths: ['paths', 'matrix'],
        children: [
          {
            id: 'tpv-emitter',
            name: '发射体层 · 热→红外',
            summary: '黑体/选择发射体把热能变成匹配电池带隙的红外谱；维恩位移定峰值波长。',
            energyNodeIds: ['thermal', 'em-ir'],
            edgeIds: ['thermal-to-electric-thermophotovoltaic'],
            methodIds: [
              'method-spectrum-viewer',
              'method-algo-spectrum-em',
              'method-algo-exergy-carnot',
            ],
            simPaths: ['electromagnetic'],
            children: [
              {
                id: 'tpv-cell',
                name: '电池层 · 红外光伏',
                summary:
                  '与太阳电池同一光伏效应，只是光谱更红：低 Eg 材料或光谱过滤。深层带隙/肖克利–奎伊瑟 与太阳能族共享。',
                energyNodeIds: ['em-ir', 'electric', 'thermal'],
                edgeIds: ['em-ir-to-electric-thermophotovoltaic'],
                methodIds: [
                  'method-shockley-queisser',
                  'method-algo-sq-limit',
                  'method-algo-led-bandgap',
                  'method-dft-electronic',
                ],
                simPaths: ['electromagnetic', 'display'],
                children: [
                  {
                    id: 'tpv-shared-physics',
                    name: '共享深层 · 载流子与损失',
                    summary:
                      '生成–复合–收集、热化、㶲账本与太阳能 PV 同构——换的是入射谱，不是另一套量子力学。',
                    methodIds: [
                      'method-heat-ftcs',
                      'method-algo-heat-erfc',
                      'method-algo-exergy-lost-work',
                      'method-algo-exergy-efficiency',
                    ],
                    simPaths: ['sim', 'paths'],
                    children: [
                      {
                        id: 'tpv-bandgap-sq',
                        name: '材料层 · 低带隙 / 极限与太阳族共享',
                        nameEn: 'Materials: low-Eg SQ shared with solar PV',
                        summary:
                          '红外光子需要更低带隙；肖克利–奎伊瑟 / 详细平衡与 太阳能电池应用 深层同一套方法，只是光谱换成发射体黑体/滤波谱。',
                        energyNodeIds: ['em-ir', 'chemical', 'electric', 'thermal'],
                        edgeIds: ['em-ir-to-electric-thermophotovoltaic'],
                        methodIds: [
                          'method-shockley-queisser',
                          'method-algo-sq-limit',
                          'method-algo-led-bandgap',
                          'method-dft-electronic',
                          'method-algo-ks-scf',
                          'method-algo-exergy-efficiency',
                        ],
                        simPaths: ['electromagnetic', 'display'],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
