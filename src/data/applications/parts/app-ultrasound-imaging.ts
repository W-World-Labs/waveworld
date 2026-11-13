import type { ApplicationProfile } from '../types'

export const app_ultrasound_imaging: ApplicationProfile = {
    id: 'app-ultrasound-imaging',
    name: '超声 B 超成像',
    nameEn: 'B-mode ultrasound imaging',
    icon: '🩻',
    category: 'imaging',
    blurb: '电脉冲 → 压电声发射 → 组织反射 → 接收成像。传感链与波动方法交汇。',
    goal: { from: 'electric', to: 'acoustic' },
    maturity: '临床商用',
    levels: [
      {
        id: 'us-system',
        name: '系统层 · 探头与扫描',
        summary: '激励–发射–反射–接收–波束形成–B 超帧。',
        energyNodeIds: ['electric', 'acoustic', 'mechanical'],
        methodIds: [
          'method-b-mode-ultrasound',
          'method-algo-us-reflection',
          'method-algo-us-aline',
          'method-algo-us-bmode-compose',
        ],
        simPaths: ['ultrasound'],
        children: [
          {
            id: 'us-piezo',
            name: '换能层 · 压电',
            summary: '电应变 / 正压电：机械形变与电场互转的器件原子。',
            energyNodeIds: ['electric', 'mechanical', 'acoustic', 'acoustic-ultrasound'],
            edgeIds: [
              'electric-to-acoustic-piezo',
              'electric-to-mechanical-piezo',
              'el-current-to-acoustic-ultrasound-piezo',
              'acoustic-to-electric-piezoelectric',
            ],
            methodIds: [
              'method-array-beamforming',
              'method-algo-array-factor',
              'method-variant-sdt-piezo',
              'method-lumped-circuit',
            ],
            simPaths: ['phasedarray', 'ultrasound'],
            children: [
              {
                id: 'us-propagation',
                name: '传播层 · 组织反射与衰减',
                summary:
                  '声阻抗失配产生回波；衰减随频率升高。A 线时深轴 = 时间 × c/2，是 B 超几何的基础。',
                energyNodeIds: ['acoustic', 'acoustic-ultrasound', 'thermal'],
                edgeIds: [
                  'acoustic-to-thermal-absorption',
                  'acoustic-to-mechanical-radiation-pressure',
                ],
                methodIds: [
                  'method-algo-us-reflection',
                  'method-algo-us-aline',
                  'method-wave-fd',
                  'method-algo-wave-leapfrog',
                  'method-algo-spectrum-sound',
                ],
                simPaths: ['ultrasound', 'sound', 'ripple'],
                children: [
                  {
                    id: 'us-beamform-image',
                    name: '成像层 · 波束形成与 B 帧',
                    summary:
                      '多阵元延时求和 / 动态聚焦合成扫描线，再包络检波拼成灰度 B 超帧。',
                    energyNodeIds: ['electric', 'acoustic'],
                    methodIds: [
                      'method-array-beamforming',
                      'method-algo-array-factor',
                      'method-algo-us-bmode-compose',
                      'method-algo-mvdr-weights',
                      'method-fft',
                      'method-algo-fft-periodogram',
                    ],
                    simPaths: ['ultrasound', 'phasedarray'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
