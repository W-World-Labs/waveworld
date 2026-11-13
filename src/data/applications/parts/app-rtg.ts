import type { ApplicationProfile } from '../types'

export const app_rtg: ApplicationProfile = {
    id: 'app-rtg',
    name: '同位素热电',
    nameEn: 'Radioisotope thermoelectric generator (RTG)',
    icon: '☢️⚡',
    category: 'energy',
    blurb:
      '核能 / 质能 → 衰变热 → 电能：Pu-238 等同位素衰变热经塞贝克热电偶供电。深空无阳光时的静态电源标准答案。',
    goal: { from: 'nuclear', to: 'electric' },
    familyId: 'family-thermoelectric',
    familyRole: '核衰变源 · 同位素热电',
    assemblyNote:
      '相对温差发电(塞贝克热电应用)：热电偶层不变，源换成 核衰变 / 质量 衰变热。相对核电站：无朗肯汽轮机，直接热→电，η 低但无运动部件、寿命数十年。质能边 质量放射性衰变热 解释「质量亏损→热」账本。',
    maturity: '航天商用',
    products: [
      { vendor: 'NASA/DOE', model: '多任务同位素热电', spec: '~2000 Wth → ~110 We，好奇号/毅力号' },
      { vendor: 'NASA/DOE', model: '通用热源同位素热电', spec: '~300 We，卡西尼/新视野' },
    ],
    levels: [
      {
        id: 'rtg-system',
        name: '系统层 · 同位素电源',
        nameEn: 'System: radioisotope power',
        summary:
          '通用热源模块 + 热电偶串 + 散热片/热管。整体 η≈6%；输出随半衰期指数下降，用路径效率与热电 η 拆账。',
        energyNodeIds: ['nuclear', 'mass', 'thermal', 'electric', 'el-current'],
        edgeIds: [
          'nuclear-to-electric-rtg-thermoelectric',
          'nuclear-decay-to-electric',
          'nuclear-to-thermal-decay-heat',
          'thermal-to-electric-thermoelectric',
        ],
        methodIds: [
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-algo-exergy-carnot',
        ],
        simPaths: ['paths', 'matrix'],
        children: [
          {
            id: 'rtg-heat-source',
            name: '热源层 · 衰变热',
            nameEn: 'Heat source: decay heat',
            summary:
              'α/β 粒子在燃料与包壳内热化：核衰变 → 热能；亦可从 质量亏损边读 E=mc² 沉积功率。Pu-238 比功率 ~0.54 W/g。',
            energyNodeIds: ['nuclear', 'nuclear-decay', 'mass', 'thermal', 'thermal-internal'],
            edgeIds: [
              'nuclear-to-thermal-decay-heat',
              'nuclear-decay-to-thermal',
              'mass-radioactive-decay-thermal',
            ],
            methodIds: [
              'method-heat-ftcs',
              'method-algo-heat-ftcs-step',
              'method-algo-heat-erfc',
              'method-monte-carlo',
              'method-algo-uq-mc',
            ],
            simPaths: ['sim', 'heaterfc'],
            children: [
              {
                id: 'rtg-teg',
                name: '热电层 · 塞贝克偶',
                nameEn: 'Thermoelectric: Seebeck couples',
                summary:
                  '碲化铅 / 硅锗等热电偶把 ΔT 变成直流；与 塞贝克热电应用 器件层共享边 热→电流塞贝克。',
                energyNodeIds: ['thermal', 'electric', 'el-current'],
                edgeIds: [
                  'thermal-to-electric-thermoelectric',
                  'thermal-to-el-current-seebeck',
                  'nuclear-to-electric-rtg-thermoelectric',
                  'nuclear-decay-to-electric',
                ],
                methodIds: [
                  'method-lumped-circuit',
                  'method-algo-homog-series',
                  'method-algo-homog-parallel',
                  'method-algo-exergy-efficiency',
                  'method-algo-eta-product',
                ],
                simPaths: ['rlc', 'paths'],
                children: [
                  {
                    id: 'rtg-materials',
                    name: '材料层 · 优值与热端匹配',
                    nameEn: 'Materials: ZT & hot-side match',
                    summary:
                      '高温端材料耐温与 热电优值 曲线决定可抽取电功率；热扩散方程描述热端到冷端的稳态温差。',
                    energyNodeIds: ['thermal', 'thermal-internal', 'chemical', 'electric'],
                    edgeIds: [
                      'thermal-to-el-current-seebeck',
                      'thermal-internal-to-electric-thermoelectric',
                    ],
                    methodIds: [
                      'method-heat-ftcs',
                      'method-algo-heat-implicit',
                      'method-dft-electronic',
                      'method-algo-exergy-lost-work',
                      'method-algo-exergy-efficiency',
                    ],
                    simPaths: ['sim'],
                    children: [
                      {
                        id: 'rtg-lifetime',
                        name: '寿命层 · 衰变功率曲线',
                        nameEn: 'Lifetime: decay power curve',
                        summary:
                          'P(t)=P₀e^(−λt)：电功率随热源衰减；任务规划要把 寿命初/寿命末功率与屏蔽、质量预算一并记账。',
                        energyNodeIds: ['nuclear', 'nuclear-decay', 'mass', 'thermal', 'electric'],
                        edgeIds: [
                          'nuclear-decay-to-thermal',
                          'mass-radioactive-decay-thermal',
                          'nuclear-to-thermal-decay-heat',
                        ],
                        methodIds: [
                          'method-algo-eta-product',
                          'method-algo-path-mc-eta',
                          'method-path-efficiency',
                          'method-algo-exergy-carnot',
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
      },
    ],
  }
