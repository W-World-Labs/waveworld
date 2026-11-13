import type { ApplicationProfile } from '../types'

export const app_mri: ApplicationProfile = {
    id: 'app-mri',
    name: '磁共振成像',
    nameEn: 'MRI / nuclear magnetic resonance imaging',
    icon: '🧲',
    category: 'imaging',
    blurb:
      '静磁场中核自旋共振：射频激励 → 弛豫辐射 → 线圈接收为电信号 → 重建图像。电磁谱与信号处理交汇。',
    goal: { from: 'em-radio', to: 'electric' },
    maturity: '临床商用',
    products: [
      { vendor: '1.5 T / 3 T', model: '全身超导磁共振', spec: '射频约 64–128 MHz（¹H）' },
    ],
    levels: [
      {
        id: 'mri-system',
        name: '系统层 · 扫描机架',
        summary:
          '主磁体 + 梯度线圈 + 射频收发 + 屏蔽与患者床。目标：把空间编码的射频回波变成可诊断的断层图。',
        energyNodeIds: ['em-radio', 'electromagnetic', 'electric', 'nuclear'],
        edgeIds: [
          'electric-to-radio-antenna',
          'em-radio-to-electric-rectenna',
          'em-radio-to-el-current-rectenna',
        ],
        methodIds: [
          'method-spectrum-viewer',
          'method-algo-spectrum-em',
          'method-fft',
          'method-algo-fft-periodogram',
          'method-path-efficiency',
        ],
        simPaths: ['electromagnetic', 'paths'],
        children: [
          {
            id: 'mri-spin-physics',
            name: '自旋层 · 拉莫尔与弛豫',
            summary:
              '核磁矩在 B₀ 中进动；射频匹配拉莫尔频率翻转磁化。纵向/横向弛豫 弛豫决定对比度；能量在核自旋与电磁场间交换。',
            energyNodeIds: ['nuclear', 'em-radio', 'electromagnetic', 'thermal'],
            edgeIds: [
              'nuclear-to-electromagnetic-radiation',
              'nuclear-to-radiant-emission',
              'em-radio-to-thermal-rf-heating',
            ],
            methodIds: [
              'method-algo-spectrum-em',
              'method-schrodinger',
              'method-algo-tdse-split',
              'method-runge-kutta',
              'method-algo-rk4',
              'method-spectral-method',
            ],
            simPaths: ['electromagnetic'],
            children: [
              {
                id: 'mri-rf-chain',
                name: '射频链 · 发射 / 接收',
                summary:
                  '功率放大器驱动发射线圈；接收线圈感应微弱射频电压，经低噪放与混频进入采样。天线与互感是器件原子。',
                energyNodeIds: ['electric', 'el-current', 'em-radio', 'electromagnetic'],
                edgeIds: [
                  'electric-to-radio-antenna',
                  'em-radio-to-electric-rectenna',
                  'em-radio-to-el-current-rectenna',
                  'electric-to-mechanical-emforce',
                ],
                methodIds: [
                  'method-fdtd',
                  'method-algo-yee-update',
                  'method-algo-friis-link',
                  'method-array-beamforming',
                  'method-algo-array-factor',
                  'method-lumped-circuit',
                  'method-algo-mutual',
                ],
                simPaths: ['fdtd', 'antenna3d', 'phasedarray', 'mutual'],
                children: [
                  {
                    id: 'mri-recon',
                    name: '重建层 · k 空间与滤波',
                    summary:
                      '梯度编码把位置映射到 k 空间轨迹；快速傅里叶变换反变换得图像。可用谱方法、小波去噪与卡尔曼作信号处理对照。',
                    energyNodeIds: ['electric', 'em-radio'],
                    methodIds: [
                      'method-fft',
                      'method-algo-fft-radix2',
                      'method-algo-fft-periodogram',
                      'method-algo-dft-1d',
                      'method-wavelet',
                      'method-algo-wavelet-soft-thresh',
                      'method-kalman',
                      'method-algo-kalman-1d',
                    ],
                    simPaths: ['electromagnetic'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
