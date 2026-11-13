import type { ApplicationProfile } from '../types'

export const app_piezo_harvest: ApplicationProfile = {
    id: 'app-piezo-harvest',
    name: '压电俘能',
    nameEn: 'Piezoelectric energy harvesting',
    icon: '⚡',
    category: 'sensing',
    blurb:
      '环境振动 / 冲击机械能 → 压电应变 → 交流电 → 整流储能。微瓦到毫瓦级自供电传感的典型路径。',
    goal: { from: 'mechanical', to: 'electric' },
    maturity: '商用传感 / 研究功率级',
    products: [
      { vendor: '压电陶瓷 / 聚偏氟乙烯', model: '悬臂梁 / 路面俘能模块', spec: 'μW–mW @ 共振' },
    ],
    levels: [
      {
        id: 'ph-system',
        name: '系统层 · 俘能节点',
        summary:
          '振源耦合 → 压电换能 → 整流/电源管理芯片 → 负载或电容储能。关注匹配阻抗、占空与平均功率，而非峰值开路电压。',
        energyNodeIds: ['mechanical', 'mechanical-vibrational', 'electric', 'el-current', 'el-static'],
        edgeIds: [
          'mechanical-to-electric-piezoelectric',
          'edge-vibrational-to-electric-piezo',
          'acoustic-to-electric-piezoelectric',
        ],
        methodIds: [
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-lumped-circuit',
          'method-algo-series-rlc',
          'method-spectrum-viewer',
          'method-algo-spectrum-vibration',
        ],
        simPaths: ['paths', 'vibration', 'rlc'],
        children: [
          {
            id: 'ph-structure',
            name: '结构层 · 悬臂 / 振膜',
            summary:
              '把环境加速度变成应变：共振梁、质量块、弹性势能缓冲。机械模态决定可收获频带。',
            energyNodeIds: [
              'mechanical',
              'mechanical-vibrational',
              'mechanical-elastic-pe',
              'mechanical-kinetic',
              'acoustic',
            ],
            edgeIds: [
              'mechanical-to-acoustic-vibration',
              'edge-kinetic-to-vibrational',
              'edge-elastic-pe-to-kinetic-release',
              'edge-vibrational-to-acoustic',
            ],
            methodIds: [
              'method-algo-spectrum-vibration',
              'method-wave-fd',
              'method-algo-wave-leapfrog',
              'method-fem',
              'method-algo-fem-poisson-1d',
              'method-comsol-style-multiphysics',
              'method-algo-staggered-thermoelastic',
            ],
            simPaths: ['vibration', 'ripple'],
            children: [
              {
                id: 'ph-transduction',
                name: '换能层 · 正压电效应',
                summary:
                  '应变改变电偶极矩 → 电极间电荷分离。d₃₃/d₃₁ 系数与负载电路共同决定瞬时功率。',
                energyNodeIds: [
                  'mechanical',
                  'mechanical-elastic-pe',
                  'electric',
                  'el-static',
                  'el-current',
                ],
                edgeIds: [
                  'mechanical-to-electric-piezoelectric',
                  'edge-vibrational-to-electric-piezo',
                  'electric-to-mechanical-piezo',
                  'acoustic-to-el-static-piezo-charge',
                ],
                methodIds: [
                  'method-variant-sdt-piezo',
                  'method-lumped-circuit',
                  'method-algo-rc-rl-transient',
                  'method-algo-series-rlc',
                  'method-comsol-style-multiphysics',
                  'method-algo-partitioned-coupling',
                ],
                simPaths: ['rlc', 'transient'],
                children: [
                  {
                    id: 'ph-power-cond',
                    name: '电源层 · 整流与储能',
                    summary:
                      '交流压电源经桥式整流与电容滤波；阻抗匹配与同步开关可提高平均 η。',
                    energyNodeIds: ['electric', 'el-current', 'el-static', 'thermal'],
                    edgeIds: [
                      'el-static-to-el-current-capacitor-discharge',
                      'el-current-to-el-static-capacitor-charge',
                      'electric-to-thermal-joule',
                    ],
                    methodIds: [
                      'method-lumped-circuit',
                      'method-algo-rc-rl-transient',
                      'method-algo-rlc-euler',
                      'method-algo-eta-product',
                      'method-pid',
                      'method-algo-pid-step',
                    ],
                    simPaths: ['transient', 'rlc'],
                    children: [
                      {
                        id: 'ph-material',
                        name: '材料层 · 压电陶瓷 / 聚合物',
                        summary:
                          '压电陶瓷钙钛矿畴转向与聚偏氟乙烯分子偶极；老化、退极化与机械疲劳限制寿命。',
                        energyNodeIds: ['chemical', 'mechanical', 'electric'],
                        methodIds: [
                          'method-md-lj',
                          'method-algo-lj-pair',
                          'method-dft-electronic',
                          'method-phasefield',
                          'method-algo-allen-cahn',
                          'method-fem',
                        ],
                        simPaths: ['md'],
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
