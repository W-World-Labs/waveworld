import type { ApplicationProfile } from '../types'

export const app_wind_turbine: ApplicationProfile = {
    id: 'app-wind-turbine',
    name: '风力发电',
    nameEn: 'Wind turbine power',
    icon: '🌬️⚡',
    category: 'energy',
    blurb:
      '风平动动能 → 转子转动 → 电能：叶片捕获气流动能（贝茨 极限），再经发电机电磁感应并网。',
    goal: { from: 'mechanical', to: 'electric' },
    maturity: '商用主力',
    products: [
      { vendor: 'Vestas', model: 'V164 / V236', spec: '海上 15 MW 级，转子直径 ~236 m' },
      { vendor: 'Siemens Gamesa', model: 'SG 14-236 DD', spec: '直驱永磁机组' },
    ],
    levels: [
      {
        id: 'wt-farm',
        name: '系统层 · 风电场 / 单机并网',
        nameEn: 'System: farm / grid-tied unit',
        summary:
          '风速资源 → 机组出力 → 集电与并网。容量因子与尾流损失是场级账本；单机路径是 动能→转动→电能。',
        energyNodeIds: [
          'mechanical',
          'mechanical-kinetic',
          'mechanical-rotational',
          'electric',
          'el-current',
        ],
        edgeIds: [
          'edge-kinetic-to-rotational-wind',
          'mechanical-to-electric-generator',
          'mechanical-to-electric-electromagnetic-induction',
          'mechanical-rotational-to-el-current-turbo-generator',
        ],
        methodIds: [
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-ns-stable-fluids',
        ],
        simPaths: ['paths', 'matrix', 'fluid', 'windtunnel'],
        children: [
          {
            id: 'wt-rotor',
            name: '气动层 · 叶片捕获',
            nameEn: 'Rotor: aerodynamic capture',
            summary:
              'P = 功率系数·½ρAv³，功率系数≤贝茨 0.593。翼型升阻、叶尖速比与偏航决定实际 功率系数≈0.35–0.45。',
            energyNodeIds: ['mechanical-kinetic', 'mechanical-rotational', 'mechanical', 'acoustic'],
            edgeIds: [
              'edge-kinetic-to-rotational-wind',
              'mechanical-to-acoustic-vibration',
            ],
            methodIds: [
              'method-ns-stable-fluids',
              'method-algo-fluid-advect',
              'method-algo-fluid-project',
              'method-algo-fluid-pipeline',
              'method-algo-fluid-obstacle',
              'method-algo-exergy-efficiency',
            ],
            simPaths: ['fluid', 'windtunnel', 'convection'],
            children: [
              {
                id: 'wt-drive',
                name: '传动层 · 齿轮箱 / 直驱',
                nameEn: 'Drivetrain: gearbox or direct drive',
                summary:
                  '低速高转矩转子匹配发电机：多级齿轮升速，或永磁直驱省齿轮。机械传动效率与疲劳是工程核心。',
                energyNodeIds: [
                  'mechanical',
                  'mechanical-rotational',
                  'mechanical-kinetic',
                ],
                edgeIds: [
                  'mechanical-to-mechanical-transmission',
                  'edge-kinetic-to-rotational-wind',
                ],
                methodIds: [
                  'method-algo-homog-series',
                  'method-algo-eta-product',
                  'method-lumped-circuit',
                  'method-pid',
                  'method-algo-pid-step',
                ],
                simPaths: ['paths', 'rlc'],
                children: [
                  {
                    id: 'wt-generator',
                    name: '机电层 · 发电机',
                    nameEn: 'Generator: electromagnetic',
                    summary:
                      '旋转轴功 → 电磁感应 → 工频/变频电能。法拉第定律与集总电路是可动手原子；直驱永磁与双馈是主流拓扑。',
                    energyNodeIds: [
                      'mechanical-rotational',
                      'mechanical',
                      'electric',
                      'el-current',
                    ],
                    edgeIds: [
                      'mechanical-to-electric-generator',
                      'mechanical-to-electric-electromagnetic-induction',
                      'mechanical-rotational-to-el-current-turbo-generator',
                      'edge-rotational-to-electric-flywheel',
                    ],
                    methodIds: [
                      'method-algo-faraday',
                      'method-lumped-circuit',
                      'method-algo-series-rlc',
                      'method-algo-mutual',
                    ],
                    simPaths: ['faraday', 'rlc', 'mutual'],
                    children: [
                      {
                        id: 'wt-loss-ledger',
                        name: '损失账本 · 贝茨 / 尾流 / 电损',
                        nameEn: 'Loss ledger',
                        summary:
                          '未提取气流动能、尾流干涉、铜铁耗与变流器损失……用 η 连乘把「名牌 功率系数」拆成可解释项。',
                        energyNodeIds: [
                          'mechanical-kinetic',
                          'mechanical-rotational',
                          'electric',
                          'thermal',
                        ],
                        edgeIds: [
                          'edge-kinetic-to-rotational-wind',
                          'edge-kinetic-to-thermal-friction',
                          'electric-to-thermal-joule',
                          'mechanical-to-electric-generator',
                        ],
                        methodIds: [
                          'method-algo-eta-product',
                          'method-algo-exergy-lost-work',
                          'method-algo-exergy-efficiency',
                          'method-path-efficiency',
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
      },
    ],
  }
