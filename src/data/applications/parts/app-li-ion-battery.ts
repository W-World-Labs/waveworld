import type { ApplicationProfile } from '../types'

export const app_li_ion_battery: ApplicationProfile = {
    id: 'app-li-ion-battery',
    name: '锂离子电池',
    nameEn: 'Li-ion battery',
    icon: '🔋',
    category: 'energy',
    blurb:
      '化学能 ↔ 电能：充放电在电极–电解液界面完成氧化还原与离子输运。可从包级电池管理下钻到界面动力学。',
    goal: { from: 'chemical', to: 'electric' },
    maturity: '商用 / EV 主流',
    products: [
      { vendor: 'NMC / LFP', model: '方形 / 圆柱电芯', spec: '能量密度 ~150–250 Wh/kg' },
    ],
    levels: [
      {
        id: 'bat-pack',
        name: '系统层 · 电池包 / 电池管理',
        summary:
          '串并联成组、热管理与荷电状态估计。放电：化学→电；充电：电→化学。关注往返效率与安全边界。',
        energyNodeIds: ['chemical', 'chemical-electrochemical', 'electric', 'el-current', 'thermal'],
        edgeIds: [
          'chemical-to-electric-battery',
          'electric-to-chemical-battery-charge',
          'chemical-electrochemical-to-electric',
          'chemical-electrochemical-from-electric',
        ],
        methodIds: [
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-lumped-circuit',
          'method-algo-rc-rl-transient',
          'method-kalman',
          'method-algo-kalman-1d',
        ],
        simPaths: ['paths', 'transient', 'rlc'],
        children: [
          {
            id: 'bat-cell',
            name: '电芯层 · 正负极与电解液',
            summary:
              '嵌脱锂电位差驱动外电路电流；内阻、固态电解质界面、极化决定可用容量与发热。集总 RC 网络是工程一阶模型。',
            energyNodeIds: [
              'chemical',
              'chemical-electrochemical',
              'chemical-bond',
              'electric',
              'el-current',
              'thermal',
            ],
            edgeIds: [
              'chemical-to-electric-battery',
              'electric-to-chemical-battery-charge',
              'chemical-to-electric-redox-flow',
              'electric-to-chemical-electrolysis',
            ],
            methodIds: [
              'method-lumped-circuit',
              'method-algo-series-rlc',
              'method-algo-rc-rl-transient',
              'method-heat-ftcs',
              'method-algo-heat-ftcs-step',
            ],
            simPaths: ['rlc', 'transient', 'sim'],
            children: [
              {
                id: 'bat-interface',
                name: '界面层 · 电荷转移与扩散',
                summary:
                  '巴特勒–福尔默型电荷转移 + 固相/液相扩散：速率与过电位、浓度梯度相关。可用扩散方程与动力学蒙特卡洛作教学类比。',
                energyNodeIds: ['chemical-electrochemical', 'electric', 'thermal'],
                edgeIds: [
                  'chemical-electrochemical-to-electric',
                  'chemical-electrochemical-from-electric',
                  'el-field-to-chemical-field-electrolysis',
                ],
                methodIds: [
                  'method-heat-ftcs',
                  'method-algo-heat-erfc',
                  'method-algo-fluid-diffuse',
                  'method-kmc',
                  'method-algo-kmc-rates',
                  'method-algo-kmc-step',
                ],
                simPaths: ['sim', 'heaterfc'],
                children: [
                  {
                    id: 'bat-materials',
                    name: '材料层 · 晶体与电解液分子',
                    summary:
                      '层状氧化物 / 橄榄石骨架中的 Li 位与迁移势垒；电解液溶剂–盐配位。分子动力学与密度泛函给出微观直觉。',
                    energyNodeIds: ['chemical', 'chemical-bond', 'chemical-electrochemical'],
                    methodIds: [
                      'method-md-lj',
                      'method-algo-lj-pair',
                      'method-algo-velocity-verlet',
                      'method-dft-electronic',
                      'method-algo-ks-scf',
                      'method-phasefield',
                      'method-algo-cahn-hilliard-chem',
                    ],
                    simPaths: ['md'],
                    children: [
                      {
                        id: 'bat-thermal-safety',
                        name: '安全层 · 热失控账本',
                        summary:
                          '内阻焦耳热 + 副反应放热可级联；热扩散与路径效率帮助理解温升与热失控阈值。',
                        energyNodeIds: ['thermal', 'chemical', 'electric'],
                        edgeIds: [
                          'electric-to-thermal-joule',
                          'electric-to-thermal-resistive',
                          'chemical-to-thermal-combustion',
                        ],
                        methodIds: [
                          'method-heat-ftcs',
                          'method-algo-heat-implicit',
                          'method-algo-exergy-lost-work',
                          'method-algo-eta-product',
                        ],
                        simPaths: ['sim', 'convection'],
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
