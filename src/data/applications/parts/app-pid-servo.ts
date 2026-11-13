import type { ApplicationProfile } from '../types'

export const app_pid_servo: ApplicationProfile = {
    id: 'app-pid-servo',
    name: '比例积分微分伺服定位',
    nameEn: 'PID servo positioning',
    icon: '🎛️⚙️',
    category: 'device',
    blurb:
      '电能 → 电机/电磁力 → 机械位移：用比例积分微分（及齐格勒–尼科尔斯整定）把位置/速度误差压成闭环跟踪的经典机电伺服链。',
    goal: { from: 'electric', to: 'mechanical' },
    familyId: 'family-control',
    familyRole: '反馈伺服 · 比例积分微分整定',
    assemblyNote:
      '相对霍尔推力器/磁流体泵：同为 电→机械能 与 电磁力/电机边，但本档案强调闭环误差调节与极限增益整定，而非等离子体喷气。相对风机传动层挂的 比例积分微分方法：那里 比例积分微分 是辅控，这里 比例积分微分/ZN 是主透镜，汇是定位台/轴功而非发电。',
    maturity: '工业标配 / 运动控制商用',
    products: [
      { vendor: 'Siemens / Beckhoff', model: '伺服驱动 + 同步电机', spec: '位置/速度/力矩三环' },
      { vendor: 'Yaskawa / Panasonic', model: 'AC 伺服套装', spec: '脉冲/总线定位' },
      { vendor: 'Maxon / Faulhaber', model: '直流有刷/无刷 + 编码器', spec: '精密小功率伺服' },
    ],
    levels: [
      {
        id: 'ps-system',
        name: '系统层 · 伺服轴',
        nameEn: 'System: servo axis',
        summary:
          '设定值 → 比例积分微分 控制器 → 功率级 → 电机/电磁致动 → 机械负载；编码器反馈闭合。目标 电→机械能；波特/路径效率对照带宽与损耗。',
        energyNodeIds: [
          'electric',
          'el-current',
          'mechanical',
          'mechanical-rotational',
          'mechanical-kinetic',
          'thermal',
        ],
        edgeIds: [
          'electric-to-mechanical-pid-servo',
          'electric-to-mechanical-emforce',
          'electric-to-mechanical-motor',
          'electric-to-mechanical-lorentz-actuator',
          'electric-to-thermal-joule',
        ],
        methodIds: [
          'method-ziegler-nichols',
          'method-algo-zn-pid',
          'method-pid',
          'method-algo-pid-step',
          'method-bode-plot',
          'method-algo-bode-mag-db',
          'method-lumped-circuit',
          'method-path-efficiency',
          'method-algo-eta-product',
        ],
        simPaths: ['paths', 'rlc', 'faraday'],
        children: [
          {
            id: 'ps-controller',
            name: '控制层 · 比例积分微分 / 误差',
            nameEn: 'Control: PID error loop',
            summary:
              'e=sp−y；u=Kp e+Ki∫e+Kd ė。离散步进原子可试跑一阶对象跟踪；抗积分饱和与采样周期决定数值稳定。',
            energyNodeIds: ['electric', 'el-current', 'mechanical'],
            edgeIds: [
              'electric-to-thermal-joule',
              'electric-to-mechanical-emforce',
            ],
            methodIds: [
              'method-pid',
              'method-algo-pid-step',
              'method-lumped-circuit',
              'method-algo-series-rlc',
            ],
            simPaths: ['rlc', 'transient', 'paths'],
            children: [
              {
                id: 'ps-zn-tune',
                name: '整定层 · 齐格勒–尼科尔斯',
                nameEn: 'Tuning: Ziegler–Nichols',
                summary:
                  '临界增益 Ku 与振荡周期 Pu → Kp=0.6Ku、Ti=0.5Pu、Td=0.125Pu。教学整定入口；实机再靠 波特 裕度微调。',
                energyNodeIds: ['electric', 'mechanical', 'el-current'],
                edgeIds: [
                  'electric-to-mechanical-emforce',
                  'electric-to-mechanical-motor',
                ],
                methodIds: [
                  'method-ziegler-nichols',
                  'method-algo-zn-pid',
                  'method-pid',
                  'method-algo-pid-step',
                  'method-bode-plot',
                  'method-algo-bode-mag-db',
                ],
                simPaths: ['paths', 'rlc'],
                children: [
                  {
                    id: 'ps-actuator',
                    name: '执行层 · 电机 / 电磁力',
                    nameEn: 'Actuator: motor / EM force',
                    summary:
                      '功率级电流经电动机或直线电磁致动把电换成机械功/转矩。挂电机、电磁力、洛伦兹边；铜损焦耳热是主损耗。',
                    energyNodeIds: [
                      'electric',
                      'el-current',
                      'mechanical',
                      'mechanical-rotational',
                      'mechanical-kinetic',
                      'thermal',
                      'electromagnetic',
                    ],
                    edgeIds: [
                      'electric-to-mechanical-motor',
                      'electric-to-mechanical-emforce',
                      'electric-to-mechanical-lorentz-actuator',
                      'electric-to-thermal-joule',
                    ],
                    methodIds: [
                      'method-algo-faraday',
                      'method-lumped-circuit',
                      'method-algo-series-rlc',
                      'method-algo-mutual',
                      'method-path-efficiency',
                      'method-algo-eta-product',
                      'method-pid',
                      'method-algo-pid-step',
                    ],
                    simPaths: ['faraday', 'rlc', 'mutual', 'paths'],
                    children: [
                      {
                        id: 'ps-plant',
                        name: '对象层 · 负载 / 定位台',
                        nameEn: 'Plant: load / stage',
                        summary:
                          '惯量、摩擦与柔性构成被控对象；输出位置/速度反馈编码器。一阶滞后教学模型与真实二质量系统对照；闭环终态跟踪设定值。',
                        energyNodeIds: [
                          'mechanical',
                          'mechanical-rotational',
                          'mechanical-kinetic',
                          'thermal',
                        ],
                        edgeIds: [
                          'electric-to-mechanical-motor',
                          'electric-to-mechanical-emforce',
                          'mechanical-to-acoustic-vibration',
                        ],
                        methodIds: [
                          'method-algo-pid-step',
                          'method-pid',
                          'method-algo-zn-pid',
                          'method-ziegler-nichols',
                          'method-path-efficiency',
                          'method-algo-eta-product',
                          'method-exergy-analysis',
                          'method-algo-exergy-efficiency',
                        ],
                        simPaths: ['paths', 'vibration', 'rlc'],
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
